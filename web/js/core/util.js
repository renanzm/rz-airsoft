/* Utilitários sem dependência de DOM. */
import { tr } from "./i18n.js";

export function uid(prefix = "") {
  const raw = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return (prefix ? prefix + "_" : "") + raw.slice(0, 20);
}

export function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function equal(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!equal(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) if (!Object.prototype.hasOwnProperty.call(b, key) || !equal(a[key], b[key])) return false;
  return true;
}

export function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function debounce(fn, wait) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Texto sem acento, minúsculo, espaços normalizados: usado em buscas. */
export function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Busca por termos: todos os termos precisam aparecer no texto. */
export function matches(haystack, query) {
  const terms = fold(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const text = fold(haystack);
  return terms.every((term) => text.includes(term));
}

/** Pontuação simples para a paleta de comandos (subsequência, com bônus no início de palavras). */
export function fuzzyScore(text, query) {
  const t = fold(text);
  const q = fold(query);
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q) + (t.startsWith(q) ? 50 : 0);
  let score = 0;
  let ti = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += found === ti ? 3 : 1;
    if (found === 0 || t[found - 1] === " ") score += 4;
    ti = found + 1;
  }
  return score;
}

export function sum(list, fn = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);
}

export function groupBy(list, fn) {
  const map = new Map();
  for (const item of list) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFileName(value, fallback = "arquivo") {
  const clean = String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return clean || fallback;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function storageGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadScript(src) {
  const existing = document.querySelector(`script[data-src="${src}"]`);
  if (existing) return existing._promise;
  const script = document.createElement("script");
  script.src = src;
  script.dataset.src = src;
  script._promise = new Promise((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(tr("Não foi possível carregar {src}", { src })));
  });
  document.head.appendChild(script);
  return script._promise;
}
