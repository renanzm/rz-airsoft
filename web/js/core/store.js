/* Dados do app em memória, com gravação otimista no servidor.
 *
 * - save()/remove() mudam o estado na hora e agendam a gravação.
 * - Gravações pendentes ficam no localStorage até o servidor confirmar,
 *   então nada se perde se a internet cair ou a aba fechar.
 * - A cada poucos segundos o app busca alterações feitas em outros
 *   dispositivos. Se o mesmo documento mudou nos dois lados, os campos são
 *   combinados (merge de três vias); em choque direto, vale o deste aparelho.
 */
import { api, ApiError, describeError } from "./api.js";
import { clone, equal, isPlainObject, sleep, storageGet, storageSet, uid } from "./util.js";

export const COLLECTIONS = ["orders", "clients", "catalog", "settings", "files"];
const PENDING_KEY = "rz3:pending";
const POLL_MS = 12000;
const SERVER_FIELDS = new Set(["rev", "seq", "updatedAt", "createdAt", "id"]);

const docs = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
const base = new Map(); // "coll/id" → última versão confirmada pelo servidor
const pending = new Map(); // "coll/id" → { coll, id, deleted, version, timer, inflight, attempts }
const listeners = new Set();
const statusListeners = new Set();

let seq = 0;
let user = null;
let pollTimer = 0;
let polling = false;
let status = { state: "idle", error: null };
let backoff = 0;

const keyOf = (coll, id) => `${coll}/${id}`;

/* ------------------------------------------------------------ eventos */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(syncStatus());
  return () => statusListeners.delete(fn);
}

function emit(change) {
  for (const fn of listeners) {
    try {
      fn(change);
    } catch (error) {
      console.error(error);
    }
  }
}

let emitQueued = null;
function emitSoon(change) {
  // Agrupa várias mudanças seguidas (ex.: sincronização) em uma renderização.
  if (emitQueued) {
    emitQueued.push(change);
    return;
  }
  emitQueued = [change];
  queueMicrotask(() => {
    const batch = emitQueued;
    emitQueued = null;
    emit(batch.length === 1 ? batch[0] : { type: "batch", changes: batch, colls: [...new Set(batch.map((c) => c.coll))] });
  });
}

export function syncStatus() {
  return { ...status, pending: pending.size };
}

function setStatus(state, error = null) {
  status = { state, error };
  const snapshot = syncStatus();
  for (const fn of statusListeners) fn(snapshot);
}

function refreshStatus() {
  const anyInflight = [...pending.values()].some((p) => p.inflight);
  if (status.state === "offline" || status.state === "error") {
    if (!pending.size) setStatus("idle");
    else setStatus(status.state, status.error);
    return;
  }
  setStatus(anyInflight || pending.size ? "saving" : "idle");
}

/* ------------------------------------------------------------ leitura */
export function list(coll) {
  return Array.from(docs[coll].values());
}

export function get(coll, id) {
  return docs[coll].get(id) || null;
}

export function currentUser() {
  return user;
}

export function hasPending(coll, id) {
  return pending.has(keyOf(coll, id));
}

/* ------------------------------------------------------------- carga */
export async function load() {
  const data = await api("GET", "/data");
  seq = Number(data.seq) || 0;
  user = data.user || null;
  for (const coll of COLLECTIONS) {
    docs[coll].clear();
    for (const doc of data.collections?.[coll] || []) {
      docs[coll].set(doc.id, doc);
      base.set(keyOf(coll, doc.id), doc);
    }
  }
  restorePending();
  startPolling();
  return data;
}

async function reloadAll() {
  const data = await api("GET", "/data");
  seq = Number(data.seq) || 0;
  for (const coll of COLLECTIONS) {
    const incoming = new Map((data.collections?.[coll] || []).map((doc) => [doc.id, doc]));
    for (const id of [...docs[coll].keys()]) {
      if (!incoming.has(id) && !pending.has(keyOf(coll, id))) {
        docs[coll].delete(id);
        base.delete(keyOf(coll, id));
      }
    }
    for (const doc of incoming.values()) {
      base.set(keyOf(coll, doc.id), doc);
      if (!pending.has(keyOf(coll, doc.id))) docs[coll].set(doc.id, doc);
    }
  }
  emit({ type: "reload" });
}

/* ------------------------------------------------------------ escrita */
function stamp(coll, doc) {
  const prev = docs[coll].get(doc.id);
  const now = new Date().toISOString();
  return { ...doc, rev: prev?.rev ?? doc.rev ?? 0, createdAt: prev?.createdAt || doc.createdAt || now, updatedAt: now };
}

/**
 * Grava um documento. `debounce` agrupa digitação (autosave).
 * Devolve o documento como ficou no estado local.
 */
export function save(coll, doc, { debounce = 0, silent = false } = {}) {
  if (!doc.id) doc = { ...doc, id: uid(coll.slice(0, 1)) };
  const next = stamp(coll, doc);
  docs[coll].set(next.id, next);
  schedule(coll, next.id, false, debounce);
  if (!silent) emitSoon({ type: "put", coll, id: next.id, doc: next, local: true });
  return next;
}

/** Atualiza alguns campos (merge raso) e grava. */
export function patch(coll, id, changes, options) {
  const current = docs[coll].get(id);
  if (!current) return null;
  return save(coll, { ...current, ...changes }, options);
}

export function remove(coll, id) {
  const current = docs[coll].get(id);
  docs[coll].delete(id);
  schedule(coll, id, true, 0);
  emitSoon({ type: "delete", coll, id, doc: current, local: true });
  return current;
}

/** Desfaz uma exclusão recente (antes ou depois de chegar ao servidor). */
export function restore(coll, doc) {
  const { rev, seq: _seq, updatedAt, ...rest } = doc;
  return save(coll, rest);
}

function schedule(coll, id, deleted, debounce) {
  const key = keyOf(coll, id);
  const entry = pending.get(key) || { coll, id, version: 0, attempts: 0 };
  entry.deleted = deleted;
  entry.version += 1;
  clearTimeout(entry.timer);
  pending.set(key, entry);
  persistPending();
  refreshStatus();
  if (!entry.inflight) entry.timer = setTimeout(() => flush(key), debounce);
}

/** Grava já tudo o que estiver pendente (ex.: antes de gerar PDF). */
export async function flushAll() {
  const keys = [...pending.keys()];
  await Promise.all(keys.map((key) => flush(key)));
}

function payload(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) if (!SERVER_FIELDS.has(k)) out[k] = v;
  out.createdAt = doc.createdAt;
  return out;
}

async function write(entry, version) {
  const { coll, id } = entry;
  const key = keyOf(coll, id);
  const known = base.get(key);
  const baseRev = known ? known.rev : 0;
  if (entry.deleted) {
    if (known) await api("DELETE", `/c/${coll}/${encodeURIComponent(id)}?baseRev=${baseRev}`);
    base.delete(key);
    return;
  }
  const local = docs[coll].get(id);
  if (!local) return;
  const res = await api("PUT", `/c/${coll}/${encodeURIComponent(id)}`, { json: { doc: payload(local), baseRev } });
  base.set(key, res.doc);
  const now = docs[coll].get(id);
  if (!now) return;
  if (entry.version === version) docs[coll].set(id, res.doc);
  else docs[coll].set(id, { ...now, rev: res.doc.rev, seq: res.doc.seq, createdAt: res.doc.createdAt });
}

async function flush(key) {
  const entry = pending.get(key);
  if (!entry || entry.inflight) return;
  clearTimeout(entry.timer);
  entry.timer = 0;
  entry.inflight = true;
  refreshStatus();
  const version = entry.version;
  let again = false;
  try {
    await write(entry, version);
    backoff = 0;
    entry.attempts = 0;
    if (status.state === "offline" || status.state === "error") setStatus("saving");
    if (entry.version === version) pending.delete(key);
  } catch (error) {
    if (await resolveConflict(entry, error)) again = true;
    else handleWriteError(entry, error);
  } finally {
    entry.inflight = false;
  }
  persistPending();
  refreshStatus();
  if (!pending.has(key) || pending.get(key) !== entry) return;
  if (again) {
    await flush(key);
    return;
  }
  // Houve edição durante a gravação: grava de novo em seguida.
  if (entry.version !== version && !entry.timer) entry.timer = setTimeout(() => flush(key), 250);
}

async function resolveConflict(entry, error) {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const key = keyOf(entry.coll, entry.id);
  const remote = error.body?.current || null;
  if (entry.attempts > 4) return false;
  entry.attempts += 1;
  if (entry.deleted) {
    if (remote) base.set(key, remote);
    else base.delete(key);
    return true;
  }
  const local = docs[entry.coll].get(entry.id);
  if (!remote) {
    base.delete(key);
    return Boolean(local);
  }
  const merged = merge3(base.get(key), local, remote);
  base.set(key, remote);
  docs[entry.coll].set(entry.id, { ...merged, id: entry.id, rev: remote.rev, seq: remote.seq, createdAt: remote.createdAt });
  emitSoon({ type: "put", coll: entry.coll, id: entry.id, doc: docs[entry.coll].get(entry.id), merged: true });
  return true;
}

function handleWriteError(entry, error) {
  if (error instanceof ApiError && error.status === 401) return;
  const transient = !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  if (transient) {
    setStatus("offline", describeError(error));
    backoff = Math.min(30000, backoff ? backoff * 2 : 2000);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(keyOf(entry.coll, entry.id)), backoff);
    return;
  }
  // Erro permanente (validação, tamanho): não adianta repetir.
  setStatus("error", describeError(error));
  pending.delete(keyOf(entry.coll, entry.id));
  emit({ type: "error", coll: entry.coll, id: entry.id, error });
}

/** Merge de três vias, campo a campo. Em conflito direto, vale `local`. */
export function merge3(baseDoc, local, remote) {
  if (!isPlainObject(local) || !isPlainObject(remote)) return clone(local ?? remote);
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const l = local[key];
    const r = remote[key];
    const b = isPlainObject(baseDoc) ? baseDoc[key] : undefined;
    if (equal(l, r)) out[key] = clone(l);
    else if (equal(l, b)) out[key] = clone(r);
    else if (equal(r, b)) out[key] = clone(l);
    else if (isPlainObject(l) && isPlainObject(r)) out[key] = merge3(b, l, r);
    else out[key] = clone(l !== undefined ? l : r);
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/* ------------------------------------------------- pendentes no disco */
function persistPending() {
  const items = [];
  for (const entry of pending.values()) {
    const doc = entry.deleted ? null : docs[entry.coll].get(entry.id);
    items.push({ coll: entry.coll, id: entry.id, deleted: entry.deleted, doc, baseRev: base.get(keyOf(entry.coll, entry.id))?.rev ?? 0 });
  }
  if (!storageSet(PENDING_KEY, items.length ? items : undefined) && items.length) {
    // Cota do navegador cheia: guarda só as exclusões e os ids.
    storageSet(PENDING_KEY, items.map((item) => ({ ...item, doc: null, lost: !item.deleted })));
  }
}

function restorePending() {
  const items = storageGet(PENDING_KEY, []);
  if (!Array.isArray(items) || !items.length) return;
  for (const item of items) {
    if (!item || !COLLECTIONS.includes(item.coll) || !item.id) continue;
    const key = keyOf(item.coll, item.id);
    if (item.deleted) {
      docs[item.coll].delete(item.id);
    } else if (item.doc) {
      const server = docs[item.coll].get(item.id);
      const merged = server && server.rev !== item.baseRev ? merge3(null, item.doc, server) : item.doc;
      docs[item.coll].set(item.id, { ...merged, rev: server?.rev ?? 0 });
    } else {
      continue;
    }
    pending.set(key, { coll: item.coll, id: item.id, deleted: Boolean(item.deleted), version: 1, attempts: 0 });
  }
  for (const key of pending.keys()) {
    const entry = pending.get(key);
    entry.timer = setTimeout(() => flush(key), 50);
  }
  refreshStatus();
}

/* ------------------------------------------------------ sincronização */
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") poll();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
    else flushOnHide();
  });
  window.addEventListener("focus", () => poll());
  window.addEventListener("online", () => {
    poll();
    for (const key of pending.keys()) flush(key);
  });
  window.addEventListener("pagehide", flushOnHide);
}

export async function poll() {
  if (polling) return;
  polling = true;
  try {
    const res = await api("GET", `/changes?since=${seq}`, { timeout: 15000 });
    if (res.reset) {
      await reloadAll();
      return;
    }
    for (const change of res.changes || []) applyRemote(change);
    seq = Math.max(seq, Number(res.seq) || 0);
    if (status.state === "offline" && !pending.size) setStatus("idle");
    if (status.state === "offline" && pending.size) {
      setStatus("saving");
      for (const key of pending.keys()) flush(key);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) setStatus("offline", describeError(error));
  } finally {
    polling = false;
  }
}

function applyRemote(change) {
  const coll = change.collection;
  if (!COLLECTIONS.includes(coll)) return;
  const id = change.deleted ? change.id : change.doc?.id;
  if (!id) return;
  const key = keyOf(coll, id);
  if (change.deleted) {
    const mine = pending.get(key);
    base.delete(key);
    if (mine && !mine.deleted) return; // editado aqui: a gravação recria o documento
    if (docs[coll].has(id)) {
      const before = docs[coll].get(id);
      docs[coll].delete(id);
      emitSoon({ type: "delete", coll, id, doc: before, remote: true });
    }
    return;
  }
  const doc = change.doc;
  const known = base.get(key);
  if (known && known.rev >= doc.rev) return;
  if (pending.has(key)) {
    const merged = merge3(known, docs[coll].get(id), doc);
    base.set(key, doc);
    docs[coll].set(id, { ...merged, id, rev: doc.rev, seq: doc.seq, createdAt: doc.createdAt });
  } else {
    base.set(key, doc);
    docs[coll].set(id, doc);
  }
  emitSoon({ type: "put", coll, id, doc: docs[coll].get(id), remote: true });
}

function flushOnHide() {
  for (const [key, entry] of pending) {
    if (entry.inflight) continue;
    const known = base.get(key);
    const baseRev = known ? known.rev : 0;
    try {
      if (entry.deleted) {
        if (known) fetch(`/api/v1/c/${entry.coll}/${encodeURIComponent(entry.id)}?baseRev=${baseRev}`, { method: "DELETE", credentials: "same-origin", keepalive: true });
        continue;
      }
      const local = docs[entry.coll].get(entry.id);
      if (!local) continue;
      const body = JSON.stringify({ doc: payload(local), baseRev });
      if (body.length > 60000) continue;
      fetch(`/api/v1/c/${entry.coll}/${encodeURIComponent(entry.id)}`, {
        method: "PUT",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch {
      /* fica no localStorage e vai na próxima abertura */
    }
  }
}

/* -------------------------------------------------------------- fotos */
export async function uploadFile(blob, name = "foto.jpg") {
  const res = await api("POST", "/files", {
    body: blob,
    headers: { "Content-Type": blob.type || "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
    timeout: 120000,
  });
  const doc = res.file;
  docs.files.set(doc.id, doc);
  base.set(keyOf("files", doc.id), doc);
  return doc;
}

export async function deleteFile(id) {
  if (!id) return;
  docs.files.delete(id);
  try {
    await api("DELETE", `/files/${encodeURIComponent(id)}`, { json: {} });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) console.warn("Foto não removida do servidor", error);
  }
}

/** Repete uma ação de rede algumas vezes antes de desistir. */
export async function retry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!(error instanceof ApiError) || (error.status !== 0 && error.status < 500)) throw error;
      await sleep(600 * (i + 1));
    }
  }
  throw last;
}
