/* Regras do negócio: ordens de serviço, clientes, catálogo e configurações. */
import { fold, sum, uid } from "./util.js";
import { joules, parseNumber, todayISO } from "./format.js";
import { tr, locale, localizeDefault } from "./i18n.js";

export const STATUSES = [
  { id: "fila", label: tr("Na fila"), short: tr("Fila"), icon: "circleDashed", hint: tr("Recebida, aguardando a bancada") },
  { id: "bancada", label: tr("Na bancada"), short: tr("Bancada"), icon: "wrench", hint: tr("Em manutenção") },
  { id: "aguardando", label: tr("Aguardando peças"), short: tr("Aguardando"), icon: "pause", hint: tr("Parada por peça ou aprovação") },
  { id: "pronto", label: tr("Pronto"), short: tr("Pronto"), icon: "checkCircle", hint: tr("Pronta para retirada") },
  { id: "entregue", label: tr("Entregue"), short: tr("Entregue"), icon: "packageCheck", hint: tr("Devolvida ao cliente") },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const OPEN_STATUSES = ["fila", "bancada", "aguardando", "pronto"];

/* Gravados como estão aqui; a tela traduz com trValue(). */
export const EQUIPMENT_TYPES = ["AEG", "GBB", "HPA", "Spring", "Sniper", "Pistola elétrica", "Outro"];

export const PAYMENT_METHODS = [
  { id: "pix", label: "Pix" },
  { id: "dinheiro", label: tr("Dinheiro") },
  { id: "debito", label: tr("Cartão de débito") },
  { id: "credito", label: tr("Cartão de crédito") },
  { id: "transferencia", label: tr("Transferência") },
  { id: "outro", label: tr("Outro") },
];

export const BB_WEIGHTS = [
  { key: "g20", grams: 0.2, label: "0.20g" },
  { key: "g28", grams: 0.28, label: "0.28g" },
  { key: "g32", grams: 0.32, label: "0.32g" },
];

export const REPORT_FIELDS = [
  { key: "gearbox", label: "Gearbox", icon: "settings" },
  { key: "nozzle", label: "Nozzle", icon: "zap" },
  { key: "motor", label: "Motor", icon: "cpu" },
  { key: "mola", label: tr("Mola"), icon: "activity" },
  { key: "cilindro", label: tr("Cilindro"), icon: "battery" },
  { key: "cano", label: tr("Cano"), icon: "crosshair" },
  { key: "bb", label: tr("BB utilizada"), icon: "target" },
];

const WARRANTY_TERMS =
  "Garantia de {garantia} sobre o serviço executado, a contar da entrega. A garantia não cobre mau uso, quedas, BBs de baixa qualidade ou intervenção de terceiros. Equipamentos não retirados em até 90 dias após o aviso de conclusão poderão ter cobrança de armazenamento.";

export const DEFAULT_SETTINGS = {
  id: "main",
  business: {
    name: "RZ Airsoft",
    subtitle: tr("Manutenção de airsoft"),
    tagline: tr("Precisão • Desempenho • Confiança"),
    phone: "",
    email: "",
    instagram: "",
    city: "",
    address: "",
    document: "",
  },
  orders: {
    digits: 4,
    warrantyDays: 90,
    technician: "",
    terms: tr(WARRANTY_TERMS),
  },
  report: {
    title: tr("Relatório técnico"),
    subtitle: tr("Manutenção preventiva"),
    footer: tr("Manutenção realizada com precisão e compromisso"),
  },
};

export const DEFAULT_CATALOG = {
  id: "main",
  meta: {
    title: tr("Serviços e preços"),
    subtitle: tr("Tabela de serviços"),
    intro: tr("Manutenção, diagnóstico e melhorias para seu equipamento de airsoft."),
    contact: "",
    note: tr("Valores e condições podem ser ajustados conforme o serviço."),
    footer: tr("Precisão • Desempenho • Confiança"),
  },
  categories: [],
};

/* Textos padrão em português. Depois de salvos nos dados, continuam acompanhando
 * o idioma enquanto ninguém os editar (ver localized). */
export const DEFAULT_TEXTS = {
  business: { subtitle: "Manutenção de airsoft", tagline: "Precisão • Desempenho • Confiança" },
  orders: { terms: WARRANTY_TERMS },
  report: { title: "Relatório técnico", subtitle: "Manutenção preventiva", footer: "Manutenção realizada com precisão e compromisso" },
  catalog: {
    title: "Serviços e preços",
    subtitle: ["Tabela de serviços", "Catálogo de serviços"],
    intro: "Manutenção, diagnóstico e melhorias para seu equipamento de airsoft.",
    note: "Valores e condições podem ser ajustados conforme o serviço.",
    footer: "Precisão • Desempenho • Confiança",
  },
};

/* ------------------------------------------------------------ ordens */
export function emptyFps() {
  return { before: { g20: null, g28: null, g32: null }, after: { g20: null, g28: null, g32: null } };
}

export function emptyReport() {
  return {
    date: "",
    technician: "",
    gearbox: "",
    nozzle: "",
    motor: "",
    mola: "",
    cilindro: "",
    cano: "",
    bb: "",
    fpsBeforeNote: "",
    fpsAfterNote: "",
    gainNote: "",
    observation: "",
    diagnosis: [],
    services: [],
    photos: [],
    opinion: "",
  };
}

export function newOrder(settings, partial = {}) {
  const now = new Date().toISOString();
  return {
    id: uid("o"),
    number: "",
    status: "fila",
    receivedAt: todayISO(),
    dueAt: "",
    deliveredAt: "",
    client: { id: "", name: "", phone: "" },
    equipment: { type: "AEG", model: "", brand: "", serial: "" },
    problem: "",
    items: [],
    discount: 0,
    payment: { status: "pendente", method: "", paidAt: "" },
    fps: emptyFps(),
    notes: "",
    technician: settings?.orders?.technician || "",
    warrantyDays: settings?.orders?.warrantyDays ?? 90,
    report: emptyReport(),
    events: [{ at: now, type: "created" }],
    ...partial,
  };
}

/** Garante a forma completa (dados antigos ou incompletos). */
export function normalizeOrder(order) {
  const base = newOrder(null, { id: order.id, events: [] });
  const out = { ...base, ...order };
  out.client = { ...base.client, ...(order.client || {}) };
  out.equipment = { ...base.equipment, ...(order.equipment || {}) };
  out.payment = { ...base.payment, ...(order.payment || {}) };
  out.fps = {
    before: { ...base.fps.before, ...(order.fps?.before || {}) },
    after: { ...base.fps.after, ...(order.fps?.after || {}) },
  };
  out.report = { ...base.report, ...(order.report || {}) };
  for (const key of ["diagnosis", "services", "photos"]) if (!Array.isArray(out.report[key])) out.report[key] = [];
  if (!Array.isArray(out.items)) out.items = [];
  if (!Array.isArray(out.events)) out.events = [];
  if (!STATUS[out.status]) out.status = "fila";
  return out;
}

export function itemTotal(item) {
  return Math.round((Number(item.qty) || 0) * (Number(item.price) || 0));
}

export function subtotal(order) {
  return sum(order.items || [], itemTotal);
}

export function orderTotal(order) {
  return Math.max(0, subtotal(order) - (Number(order.discount) || 0));
}

export function isPaid(order) {
  return order.payment?.status === "pago";
}

export function fpsGain(order) {
  const before = parseNumber(order.fps?.before?.g20);
  const after = parseNumber(order.fps?.after?.g20);
  if (before == null || after == null) return null;
  return after - before;
}

export function fpsJoules(order, side = "after", key = "g20") {
  const weight = BB_WEIGHTS.find((w) => w.key === key);
  const value = parseNumber(order.fps?.[side]?.[key]);
  return value == null || !weight ? null : joules(value, weight.grams);
}

export function orderLabel(order) {
  return order.number ? tr("OS {n}", { n: order.number }) : tr("OS sem número");
}

export function equipmentLabel(equipment) {
  if (!equipment) return "";
  return [equipment.model, equipment.brand].filter(Boolean).join(" · ");
}

export function orderTitle(order) {
  const equip = equipmentLabel(order.equipment);
  return [order.client?.name, equip].filter(Boolean).join(" — ") || tr("Sem cliente");
}

export function orderSearchText(order) {
  return [
    order.number,
    order.client?.name,
    order.client?.phone,
    order.equipment?.model,
    order.equipment?.brand,
    order.equipment?.type,
    order.equipment?.serial,
    order.problem,
    order.notes,
    ...(order.items || []).map((i) => i.description),
  ].join(" ");
}

/** Próximo número de OS: maior número existente + 1, no mesmo formato dele
 * ("101" → "102", "0006" → "0007"). Sem OS ainda, usa os dígitos configurados. */
export function nextOrderNumber(orders, settings) {
  let max = 0;
  let width = 0;
  for (const order of orders) {
    const match = /(\d+)\s*$/.exec(String(order.number || ""));
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (value >= max) {
      max = value;
      width = match[1].length;
    }
  }
  const digits = width || Number(settings?.orders?.digits) || 4;
  return String(max + 1).padStart(digits, "0");
}

export function compareNumbers(a, b) {
  return String(a || "").localeCompare(String(b || ""), locale(), { numeric: true });
}

/** Registra mudança de status no histórico da OS. */
export function withStatus(order, status) {
  if (order.status === status) return order;
  const now = new Date().toISOString();
  const next = { ...order, status, events: [...(order.events || []), { at: now, type: "status", from: order.status, to: status }] };
  if (status === "entregue" && !order.deliveredAt) next.deliveredAt = todayISO();
  if (status !== "entregue" && order.status === "entregue") next.deliveredAt = "";
  return next;
}

export function withEvent(order, event) {
  return { ...order, events: [...(order.events || []), { at: new Date().toISOString(), ...event }] };
}

/** Dias desde a entrada (para cards do quadro). */
export function ageDays(order) {
  if (!order.receivedAt) return null;
  const start = new Date(order.receivedAt + "T12:00:00");
  return Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000));
}

export function isLate(order) {
  if (!order.dueAt || order.status === "entregue" || order.status === "pronto") return false;
  return order.dueAt < todayISO();
}

/** A data de referência para relatórios de faturamento. */
export function revenueDate(order) {
  return order.payment?.paidAt || order.deliveredAt || order.receivedAt || (order.createdAt || "").slice(0, 10);
}

export function hasReport(order) {
  const r = order.report || {};
  const textual = ["gearbox", "nozzle", "motor", "mola", "cilindro", "cano", "bb", "observation", "opinion"].some((k) => String(r[k] || "").trim());
  return textual || (r.diagnosis || []).some((x) => String(x || "").trim()) || (r.services || []).some((x) => String(x || "").trim()) || (r.photos || []).length > 0;
}

/* ----------------------------------------------------------- clientes */
export function newClient(partial = {}) {
  return {
    id: uid("c"),
    name: "",
    phone: "",
    email: "",
    instagram: "",
    city: "",
    document: "",
    notes: "",
    equipment: [],
    ...partial,
  };
}

export function normalizeClient(client) {
  const base = newClient({ id: client.id });
  const out = { ...base, ...client };
  out.equipment = Array.isArray(client.equipment) ? client.equipment.map((e) => ({ id: e.id || uid("e"), type: "AEG", model: "", brand: "", serial: "", notes: "", ...e })) : [];
  return out;
}

export function nameKey(name) {
  return fold(name);
}

export function findClientByName(clients, name) {
  const key = nameKey(name);
  if (!key) return null;
  return clients.find((c) => nameKey(c.name) === key) || null;
}

export function clientOrders(orders, client) {
  const key = nameKey(client.name);
  return orders.filter((o) => (o.client?.id && o.client.id === client.id) || (!o.client?.id && key && nameKey(o.client?.name) === key));
}

/* ----------------------------------------------------------- catálogo */
export function catalogItems(catalog) {
  const out = [];
  for (const category of catalog?.categories || []) {
    for (const item of category.items || []) out.push({ ...item, category: category.name });
  }
  return out;
}

function localized(group, sources) {
  const out = { ...group };
  for (const [key, source] of Object.entries(sources)) out[key] = localizeDefault(out[key], source);
  return out;
}

export function settingsWithDefaults(settings) {
  const s = settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    business: localized({ ...DEFAULT_SETTINGS.business, ...(s.business || {}) }, DEFAULT_TEXTS.business),
    orders: localized({ ...DEFAULT_SETTINGS.orders, ...(s.orders || {}) }, DEFAULT_TEXTS.orders),
    report: localized({ ...DEFAULT_SETTINGS.report, ...(s.report || {}) }, DEFAULT_TEXTS.report),
  };
}

export function catalogWithDefaults(catalog) {
  const c = catalog || {};
  return { ...DEFAULT_CATALOG, ...c, meta: localized({ ...DEFAULT_CATALOG.meta, ...(c.meta || {}) }, DEFAULT_TEXTS.catalog), categories: Array.isArray(c.categories) ? c.categories : [] };
}

/** Mensagem de WhatsApp pronta para cada situação. */
export function whatsappMessage(order, settings, kind = "status") {
  const name = (order.client?.name || "").split(" ")[0];
  const greeting = name ? tr("Olá, {name}!", { name }) : tr("Olá!");
  const shop = settings?.business?.name || "RZ Airsoft";
  const equip = equipmentLabel(order.equipment) || tr("sua réplica");
  const os = order.number ? ` (${tr("OS {n}", { n: order.number })})` : "";
  const parts = { greeting, shop, equip, os };
  if (kind === "pronto" || order.status === "pronto") {
    return tr("{greeting} Aqui é da {shop}. A {equip}{os} está pronta para retirada. Qualquer dúvida, é só chamar.", parts);
  }
  if (order.status === "entregue") {
    return tr("{greeting} Aqui é da {shop}. Obrigado pela confiança no serviço da {equip}{os}! Se precisar de algo, estamos à disposição.", parts);
  }
  const status = STATUS[order.status]?.label.toLowerCase() || tr("em andamento");
  return tr("{greeting} Aqui é da {shop}. Passando para avisar que a {equip}{os} está {status}.", { ...parts, status });
}
