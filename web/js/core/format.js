/* Formatação no idioma da interface: dinheiro em centavos (sempre em reais), datas ISO, telefone, FPS. */
import { tr, locale } from "./i18n.js";

const LOCALE = locale();
const BRL = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "BRL" });
const BRL_COMPACT = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const NUM = new Intl.NumberFormat(LOCALE);
const NUM1 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const NUM2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
const DATE_SHORT = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short" });
const DATE_LONG = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" });
const DATETIME = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" });
const MONTH = new Intl.DateTimeFormat(LOCALE, { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
const REL = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** Centavos → "R$ 1.234,56". */
export function money(cents) {
  return BRL.format((Number(cents) || 0) / 100);
}

export function moneyCompact(cents) {
  const value = (Number(cents) || 0) / 100;
  return Math.abs(value) < 10000 ? BRL.format(value).replace(/[,.]00$/, "") : BRL_COMPACT.format(value);
}

/** "R$ 1.234,56", "75", "75,5", "1234.5" → centavos (ou null). */
export function parseMoney(input) {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  let text = String(input).replace(/[^\d,.-]/g, "");
  if (!text || !/\d/.test(text)) return null;
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{3}(\D|$)/.test(text) && !/\.\d{1,2}$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Máscara de digitação: os dígitos representam centavos. */
export function maskMoney(input) {
  const digits = String(input ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return BRL.format(Number.parseInt(digits, 10) / 100);
}

export function number(value) {
  return NUM.format(Number(value) || 0);
}

export function decimal(value) {
  return NUM1.format(Number(value) || 0);
}

export function decimal2(value) {
  return NUM2.format(Number(value) || 0);
}

export function percent(value) {
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 }).format(value || 0);
}

/* ------------------------------------------------------------- datas */
export function todayISO() {
  const now = new Date();
  return toISODate(now);
}

export function toISODate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DD" → Date local (meio-dia, para não virar o dia no fuso). */
export function fromISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return fromISODate(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function date(value, fallback = "—") {
  const d = asDate(value);
  return d ? DATE.format(d) : fallback;
}

export function dateShort(value, fallback = "—") {
  const d = asDate(value);
  return d ? DATE_SHORT.format(d).replace(".", "") : fallback;
}

export function dateLong(value, fallback = "—") {
  const d = asDate(value);
  return d ? DATE_LONG.format(d) : fallback;
}

export function dateTime(value, fallback = "—") {
  const d = asDate(value);
  return d ? DATETIME.format(d) : fallback;
}

export function monthLabel(date) {
  return MONTH.format(date).replace(".", "");
}

export function monthYear(date) {
  const text = MONTH_YEAR.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "há 3 dias", "ontem", "agora". Datas sem hora (AAAA-MM-DD) contam em dias. */
export function relative(value) {
  const d = asDate(value);
  if (!d) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const days = daysBetween(value);
    if (days === 0) return tr("hoje");
    if (Math.abs(days) < 30) return REL.format(-days, "day");
    if (Math.abs(days) < 365) return REL.format(-Math.round(days / 30.44), "month");
    return REL.format(-Math.round(days / 365.25), "year");
  }
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return tr("agora");
  const units = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let chosen = units[0];
  for (const unit of units) if (abs >= unit[1]) chosen = unit;
  return REL.format(Math.round(diff / chosen[1]), chosen[0]);
}

/** Dias inteiros entre duas datas ISO (ou até hoje). */
export function daysBetween(from, to) {
  const a = asDate(from);
  const b = to ? asDate(to) : new Date();
  if (!a || !b) return null;
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((end - start) / 86400000);
}

/** "20/03/2026" → "2026-03-20" (ou ""). */
export function parseBrDate(value) {
  const text = String(value || "").trim();
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, Number(match[2]) - 1, Number(match[1]), 12);
    if (d.getDate() === Number(match[1])) return toISODate(d);
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return "";
}

/* ---------------------------------------------------------- contato */
export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/** Telefone BR: "(48) 99669-8376". */
export function phone(value) {
  let d = digits(value);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return String(value ?? "").trim();
}

/** Máscara progressiva para o campo de telefone. */
export function maskPhone(value) {
  const d = digits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Link do WhatsApp (wa.me). Assume Brasil quando falta o código do país. */
export function whatsappLink(value, text = "") {
  let d = digits(value);
  if (!d || d.length < 10) return "";
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || "";
  return (first + last).toUpperCase();
}

export function plural(count, one, many) {
  return `${number(count)} ${count === 1 ? one : many}`;
}

/* CSV: em português abre no Excel com ";" e vírgula decimal; em inglês, com "," e ponto. */
export function csvDelimiter() {
  return LOCALE === "pt-BR" ? ";" : ",";
}

export function csvMoney(cents) {
  const text = ((Number(cents) || 0) / 100).toFixed(2);
  return LOCALE === "pt-BR" ? text.replace(".", ",") : text;
}

export function bytes(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${decimal(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${decimal(n / 1024 ** 2)} MB`;
  return `${decimal(n / 1024 ** 3)} GB`;
}

/* --------------------------------------------------------------- FPS */
export function parseNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

export function fps(value) {
  return value == null || value === "" ? "—" : NUM1.format(value);
}

export function signed(value, suffix = "") {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const body = NUM1.format(Math.abs(rounded));
  if (rounded > 0) return `+${body}${suffix}`;
  if (rounded < 0) return `−${body}${suffix}`;
  return `0${suffix}`;
}

/** Energia da BB em joules: E = ½·m·v² (m em kg, v em m/s). */
export function joules(fpsValue, grams) {
  const v = Number(fpsValue) * 0.3048;
  const m = Number(grams) / 1000;
  if (!Number.isFinite(v) || !Number.isFinite(m) || v <= 0 || m <= 0) return null;
  return 0.5 * m * v * v;
}
