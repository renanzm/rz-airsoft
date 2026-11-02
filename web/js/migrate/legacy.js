/* Importa os dados da versão 2 (controle, relatórios, clientes, serviços, status).
 *
 * Fontes: as chaves rz-*.json gravadas pelo servidor antigo em dados/cloud e o
 * localStorage deste navegador (as telas antigas de Relatório, Controle e
 * Serviços gravavam só no navegador). Nada antigo é apagado. Roda uma vez:
 * o resultado fica registrado em settings.migration.
 */
import { api } from "../core/api.js";
import * as store from "../core/store.js";
import * as data from "../core/data.js";
import { parseBrDate, parseMoney, parseNumber, todayISO, plural } from "../core/format.js";
import { uid, fold } from "../core/util.js";
import { emptyReport, newClient, newOrder, nextOrderNumber, normalizeOrder, settingsWithDefaults, STATUS } from "../core/model.js";
import { dataUrlToBlob } from "../views/images.js";

const KEYS = {
  controle: "rz-controle-manutencao",
  archive: "rz-relatorios-arquivo-v2",
  draft: "rz-relatorio-tecnico",
  catalog: "rz-servicos-precos",
  clients: "rz-clientes-v1",
  status: "rz-os-status-v1",
  theme: "rz-ui-theme-v1",
};

const SEED_CATALOG = {
  meta: {
    title: "Serviços e preços",
    subtitle: "Catálogo de serviços",
    intro: "Manutenção, diagnóstico e melhorias para seu equipamento de airsoft.",
    contact: "(48) 99669-8376",
    note: "Valores e condições podem ser ajustados conforme o serviço.",
    footer: "Precisão • Desempenho • Confiança",
  },
  categories: [
    { name: "Manutenção e revisão", items: [["Revisão completa", "Sistema interno e externo, hop-up e cano"], ["Manutenção em AEG", ""]] },
    { name: "Peças, conectores e upgrades", items: [["Troca de peças", ""], ["Consultoria", "Sobre peças e upgrades", "Consulta"], ["Troca de conector XT60", ""], ["Troca de conector T-Deans", ""]] },
    { name: "Carregadores GBB", items: [["Resolução de vazamentos em carregadores GBB", ""]] },
  ],
};

/* ------------------------------------------------------------ leitura */
function parse(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function localValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function cleanProblem(value) {
  const t = text(value);
  return /^nenhum\w?$/i.test(t) ? "" : t;
}

function idOk(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "";
}

function unionById(lists, prefer) {
  const map = new Map();
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item !== "object") continue;
      const id = text(item.id) || `noid-${map.size}`;
      const existing = map.get(id);
      map.set(id, existing ? prefer(existing, item) : item);
    }
  }
  return [...map.values()];
}

const newer = (a, b) => (String(b.updatedAt || b.savedAt || "") > String(a.updatedAt || a.savedAt || "") ? b : a);

const LOCAL_FLAG = "rz3:legacy-imported";

function hasLocalLegacy() {
  return Object.values(KEYS).some((key) => key !== KEYS.theme && localValue(key) != null);
}

export async function collectSources({ includeServer = true } = {}) {
  let server = {};
  if (includeServer) {
    try {
      server = (await api("GET", "/legacy")).keys || {};
    } catch {
      server = {};
    }
  }
  const pick = (key) => ({ server: parse(server[key]), local: parse(localValue(key)) });
  const controle = pick(KEYS.controle);
  const archive = pick(KEYS.archive);
  const draft = pick(KEYS.draft);
  const catalog = pick(KEYS.catalog);
  const clients = pick(KEYS.clients);
  const status = pick(KEYS.status);
  const themeValue = server[KEYS.theme] || localValue(KEYS.theme);

  const hasControle = Array.isArray(controle.server) || Array.isArray(controle.local);
  // Controle antigo só gravava no navegador: em conflito, vale a versão local.
  const records = unionById([controle.server, controle.local], (a, b) => b);
  const reports = unionById([archive.server, archive.local], newer);
  for (const d of [draft.server, draft.local]) {
    if (d && typeof d === "object" && d.id && !reports.some((r) => r.id === d.id)) reports.push({ id: d.id, os: d.fields?.os, createdAt: d.savedAt, updatedAt: d.savedAt, data: d });
  }
  const clientList = unionById([clients.server?.clients, clients.local?.clients], newer);
  const statusById = { ...(status.local?.byId || {}), ...(status.server?.byId || {}) };
  const catalogDoc = [catalog.server, catalog.local].filter((c) => c && Array.isArray(c.categories)).reduce((best, c) => (!best || String(c.savedAt || "") > String(best.savedAt || "") ? c : best), null);

  return {
    records,
    hasControle,
    reports,
    clients: clientList,
    statusById,
    catalog: catalogDoc,
    theme: themeValue === "light" || themeValue === "dark" ? themeValue : null,
    sources: { server: Object.keys(server).length, local: Object.values(KEYS).filter((k) => localValue(k) != null).length },
  };
}

/* ------------------------------------------------------- conversões */
function reportFrom(entryData) {
  const d = entryData && typeof entryData === "object" ? entryData : {};
  const f = d.fields || {};
  const lists = d.lists || {};
  const nonEmpty = (list) => (Array.isArray(list) ? list.map(text).filter(Boolean) : []);
  return {
    ...emptyReport(),
    date: parseBrDate(f.data),
    technician: text(f.armeiro),
    gearbox: text(f.gearbox),
    nozzle: text(f.nozzle),
    motor: text(f.motor),
    mola: text(f.mola),
    cilindro: text(f.cilindro),
    cano: text(f.cano),
    bb: text(f.bb),
    fpsBeforeNote: text(f.fpsAntesNota),
    fpsAfterNote: text(f.fpsDepoisNota),
    gainNote: text(f.ganhoNota),
    observation: /^Valor do serviço:/i.test(text(f.observacao)) ? "" : text(f.observacao),
    diagnosis: nonEmpty(lists.diag),
    services: nonEmpty(lists.serv),
    opinion: text(f.parecer),
    _photos: Array.isArray(d.photos) ? d.photos.filter((p) => typeof p === "string" && p.startsWith("data:image/")) : [],
  };
}

function meaningful(report) {
  return ["gearbox", "nozzle", "motor", "mola", "cilindro", "cano", "bb", "observation", "opinion", "technician"].some((k) => report[k]) || report.diagnosis.length || report.services.length || report._photos.length;
}

function splitModel(value) {
  const parts = text(value).split(/\s+·\s+|\s{2,}·\s{2,}/).map((p) => p.trim()).filter(Boolean);
  return { model: parts[0] || "", brand: parts.slice(1).join(" ") };
}

function orderFromRecord(record, statusById, settings) {
  const id = idOk(record.id) || uid("o");
  const price = parseMoney(record.valor) || 0;
  const explicit = STATUS[statusById[record.id]] ? statusById[record.id] : null;
  const status = explicit || (text(record.fps20s) || price ? "entregue" : "fila");
  const received = parseBrDate(record.data) || "";
  const description = text(record.pecas) || (price ? "Serviço" : "");
  return normalizeOrder(
    newOrder(settings, {
      id,
      number: text(record.os),
      status,
      receivedAt: received,
      deliveredAt: status === "entregue" ? received : "",
      client: { id: "", name: text(record.dono), phone: "" },
      equipment: { type: "AEG", model: text(record.modelo), brand: text(record.fabricante), serial: "" },
      problem: cleanProblem(record.problema),
      items: description ? [{ id: uid("i"), kind: "servico", description, qty: 1, price }] : [],
      payment: status === "entregue" && price ? { status: "pago", method: "", paidAt: received } : { status: "pendente", method: "", paidAt: "" },
      fps: {
        before: { g20: parseNumber(record.fps20e), g28: parseNumber(record.fps28e), g32: parseNumber(record.fps32e) },
        after: { g20: parseNumber(record.fps20s), g28: parseNumber(record.fps28s), g32: parseNumber(record.fps32s) },
      },
      events: [{ at: new Date().toISOString(), type: "imported" }],
    })
  );
}

function orderFromReport(entry, settings) {
  const d = entry.data || {};
  const f = d.fields || {};
  const { model, brand } = splitModel(f.modelo);
  const received = parseBrDate(f.data) || String(entry.createdAt || d.savedAt || "").slice(0, 10) || todayISO();
  return normalizeOrder(
    newOrder(settings, {
      id: idOk(entry.id) || idOk(d.id) || uid("o"),
      number: text(entry.os || f.os),
      status: "entregue",
      receivedAt: received,
      deliveredAt: received,
      client: { id: "", name: text(f.cliente), phone: "" },
      equipment: { type: "AEG", model, brand, serial: "" },
      fps: { before: { g20: parseNumber(f.fpsAntes), g28: null, g32: null }, after: { g20: parseNumber(f.fpsDepois), g28: null, g32: null } },
      technician: text(f.armeiro),
      events: [{ at: new Date().toISOString(), type: "imported" }],
    })
  );
}

function clientFromLegacy(c) {
  return newClient({
    id: idOk(c.id) || uid("c"),
    name: text(c.nome),
    phone: text(c.telefone).replace(/\D/g, ""),
    notes: text(c.notas),
    equipment: (Array.isArray(c.equipamentos) ? c.equipamentos : [])
      .map((e) => ({ id: uid("e"), type: "AEG", model: text(e?.modelo), brand: text(e?.fabricante), serial: "", notes: "" }))
      .filter((e) => e.model || e.brand),
    createdAt: c.createdAt || undefined,
  });
}

function catalogFromLegacy(source) {
  const meta = source.meta || {};
  return {
    id: "main",
    meta: {
      title: text(meta.title) || "Serviços e preços",
      subtitle: text(meta.subtitle),
      intro: text(meta.intro),
      contact: text(meta.contact),
      note: text(meta.note),
      footer: text(meta.footer),
    },
    categories: (source.categories || []).map((cat) => ({
      id: idOk(cat.id) || uid("cat"),
      name: text(cat.name),
      items: (cat.items || []).map((item) => ({
        id: idOk(item.id) || uid("svc"),
        name: text(item.name),
        description: text(item.description),
        unit: text(item.unit) || "Serviço",
        price: typeof item.price === "number" ? item.price : parseMoney(item.price) || 0,
      })),
    })),
  };
}

function seedCatalog() {
  return {
    id: "main",
    meta: { ...SEED_CATALOG.meta },
    categories: SEED_CATALOG.categories.map((cat) => ({
      id: uid("cat"),
      name: cat.name,
      items: cat.items.map(([name, description, unit]) => ({ id: uid("svc"), name, description, unit: unit || "Serviço", price: 0 })),
    })),
  };
}

/* ----------------------------------------------------------- gravação */
async function uploadPhotos(report, counters) {
  const ids = [];
  for (const url of report._photos.slice(0, 6)) {
    try {
      const doc = await store.uploadFile(dataUrlToBlob(url), "foto-importada.jpg");
      ids.push(doc.id);
      counters.photos += 1;
    } catch (error) {
      console.warn("Foto antiga não importada", error);
      counters.photoErrors += 1;
    }
  }
  const { _photos, ...clean } = report;
  return { ...clean, photos: ids };
}

/** Converte e grava. `src` vem de collectSources() ou de arquivos .json. */
async function apply(src, { useSeeds }) {
  const settings = data.settings();
  const existingOrders = data.orders();
  const existingIds = new Set(existingOrders.map((o) => o.id));
  // Mesma manutenção já importada por outro navegador (ids diferentes): compara o conteúdo.
  // Só contra o que já existia antes desta importação: dois serviços iguais no mesmo dia continuam dois.
  const signature = (o) => [fold(o.client?.name), fold(o.equipment?.model), o.receivedAt || "", fold(o.items?.[0]?.description || o.problem)].join("|");
  const existingSigs = new Set(existingOrders.map(signature));
  const counters = { orders: 0, reports: 0, clients: 0, photos: 0, photoErrors: 0, catalog: false };

  // clientes (por id ou nome)
  let clients = data.clients();
  const byKey = new Map(clients.map((c) => [fold(c.name), c]));
  const ensureClient = (name, equipment) => {
    const key = fold(name);
    if (!key) return null;
    let client = byKey.get(key);
    if (!client) {
      client = newClient({ name: text(name) });
      byKey.set(key, client);
      counters.clients += 1;
    }
    if (equipment && (equipment.model || equipment.brand)) {
      const known = client.equipment.some((e) => fold(e.model) === fold(equipment.model) && fold(e.brand) === fold(equipment.brand));
      if (!known) client = { ...client, equipment: [...client.equipment, { id: uid("e"), type: equipment.type || "AEG", model: equipment.model, brand: equipment.brand, serial: "", notes: "" }] };
      byKey.set(key, client);
    }
    return client;
  };
  for (const legacy of src.clients || []) {
    const c = clientFromLegacy(legacy);
    if (!c.name) continue;
    const key = fold(c.name);
    const current = byKey.get(key);
    if (current) {
      byKey.set(key, { ...current, phone: current.phone || c.phone, notes: current.notes || c.notes, equipment: current.equipment.length ? current.equipment : c.equipment });
    } else {
      byKey.set(key, c);
      counters.clients += 1;
    }
  }

  // ordens a partir do controle
  const records = src.records || [];
  const orders = [];
  const ordersById = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (!text(record.dono) && !text(record.modelo) && !text(record.pecas) && !text(record.os)) continue;
    const order = orderFromRecord(record, src.statusById || {}, settings);
    if (existingIds.has(order.id) || ordersById.has(order.id) || existingSigs.has(signature(order))) continue;
    orders.push(order);
    ordersById.set(order.id, order);
  }

  // relatórios: anexados à OS de mesmo id ou viram OS próprias
  for (const entry of src.reports || []) {
    const report = reportFrom(entry?.data);
    const target = ordersById.get(entry?.id) || ordersById.get(entry?.data?.id);
    if (target) {
      if (!meaningful(report)) continue;
      target.report = await uploadPhotos(report, counters);
      if (report.technician) target.technician = report.technician;
      counters.reports += 1;
      continue;
    }
    const id = idOk(entry?.id) || idOk(entry?.data?.id);
    if (id && existingIds.has(id)) continue;
    const f = entry?.data?.fields || {};
    if (!meaningful(report) && !text(f.cliente) && !text(f.os) && !text(f.modelo)) continue;
    const order = orderFromReport(entry, settings);
    if (ordersById.has(order.id) || existingSigs.has(signature(order))) continue;
    order.report = await uploadPhotos(report, counters);
    orders.push(order);
    ordersById.set(order.id, order);
    counters.reports += 1;
  }

  // números para quem não tinha OS, em ordem de data
  const used = [...existingOrders, ...orders];
  const missing = orders.filter((o) => !o.number).sort((a, b) => String(a.receivedAt || "9999").localeCompare(String(b.receivedAt || "9999")));
  for (const order of missing) {
    order.number = nextOrderNumber(used.filter((o) => o.number), settings);
  }

  // liga cada OS a um cliente
  for (const order of orders) {
    const client = ensureClient(order.client.name, order.equipment);
    if (client) order.client = { id: client.id, name: client.name, phone: client.phone };
    if (!order.receivedAt) order.receivedAt = String(order.createdAt || new Date().toISOString()).slice(0, 10);
  }

  // grava
  const touched = new Set([...byKey.values()].filter((c) => !clients.some((x) => x.id === c.id && JSON.stringify(x) === JSON.stringify(c))));
  for (const client of touched) data.saveClient(client);
  for (const order of orders) store.save("orders", order);
  counters.orders = orders.length;

  // catálogo
  const currentCatalog = store.get("catalog", "main");
  if (!currentCatalog || !(currentCatalog.categories || []).length) {
    if (src.catalog) {
      data.saveCatalog(catalogFromLegacy(src.catalog));
      counters.catalog = true;
    } else if (useSeeds) {
      data.saveCatalog(seedCatalog());
      counters.catalog = true;
    }
  }

  // telefone da oficina vindo do catálogo antigo
  const fresh = settingsWithDefaults(store.get("settings", "main"));
  const contact = (src.catalog?.meta?.contact || (useSeeds && counters.catalog ? SEED_CATALOG.meta.contact : "")).replace(/\D/g, "");
  if (!fresh.business.phone && contact.length >= 10) {
    data.saveSettings({ ...fresh, business: { ...fresh.business, phone: contact } });
  }

  await store.flushAll();
  return counters;
}

function summarize(c) {
  const parts = [];
  if (c.orders) parts.push(plural(c.orders, "OS", "OS"));
  if (c.reports) parts.push(plural(c.reports, "relatório", "relatórios"));
  if (c.clients) parts.push(plural(c.clients, "cliente", "clientes"));
  if (c.photos) parts.push(plural(c.photos, "foto", "fotos"));
  if (c.catalog) parts.push("catálogo de serviços");
  let text = parts.join(" · ");
  if (c.photoErrors) text += ` · ${c.photoErrors} foto(s) não puderam ser convertidas`;
  return text;
}

/**
 * Primeira abertura: importa as chaves antigas do servidor (e, sem nada antigo,
 * o catálogo inicial). Em cada navegador, importa uma vez o que a versão
 * anterior deixou só nele — o PC da oficina pode abrir depois de outro aparelho.
 */
export async function runLegacyMigration() {
  const settingsDoc = store.get("settings", "main");
  const globalDone = Boolean(settingsDoc?.migration);
  const localDone = localValue(LOCAL_FLAG) != null;
  if (globalDone && (localDone || !hasLocalLegacy())) return null;
  const src = await collectSources({ includeServer: !globalDone });
  const counters = await apply(src, { useSeeds: !globalDone });
  const summary = summarize(counters);
  if (src.theme && !localValue("rz3:theme")) {
    try {
      localStorage.setItem("rz3:theme", src.theme);
      document.documentElement.dataset.theme = src.theme;
    } catch {
      /* ignora */
    }
  }
  if (!globalDone) {
    const latest = settingsWithDefaults(store.get("settings", "main"));
    data.saveSettings({ ...latest, migration: { version: 1, at: new Date().toISOString(), summary, counts: counters, sources: src.sources } });
  }
  try {
    localStorage.setItem(LOCAL_FLAG, new Date().toISOString());
  } catch {
    /* sem storage: tenta de novo na próxima abertura, sem duplicar */
  }
  await store.flushAll();
  const imported = counters.orders + counters.clients + counters.reports > 0 || counters.catalog;
  return { imported, summary };
}

/* ------------------------------------------------- arquivos .json antigos */
export async function importLegacyFiles(files) {
  const src = { records: [], reports: [], clients: [], statusById: {}, catalog: null, hasControle: true };
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} não é um JSON válido.`);
    }
    if (Array.isArray(json) && json.some((r) => r && ("dono" in r || "pecas" in r || "fps20e" in r))) src.records.push(...json);
    else if (Array.isArray(json) && json.some((r) => r && r.data && (r.data.fields || r.data.lists))) src.reports.push(...json);
    else if (json && Array.isArray(json.reports)) src.reports.push(...json.reports);
    else if (json && json.fields && json.lists) src.reports.push({ id: json.id, os: json.fields.os, createdAt: json.savedAt, updatedAt: json.savedAt, data: json });
    else if (json && Array.isArray(json.categories)) src.catalog = json;
    else if (json && Array.isArray(json.clients)) src.clients.push(...json.clients);
    else throw new Error(`Não reconheci o formato de ${file.name}.`);
  }
  const counters = await apply(src, { useSeeds: false });
  const summary = summarize(counters) || "Tudo já estava no sistema.";
  return { imported: counters.orders + counters.clients + counters.reports > 0 || counters.catalog, summary };
}
