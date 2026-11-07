// Traduções: todo texto do código existe em inglês e o app formata no idioma escolhido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// O idioma é lido ao carregar o módulo: define inglês antes de importar.
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key) => (key === "rz3:lang" ? "en-US" : null), setItem() {} }, configurable: true });

const { default: en } = await import("../../web/js/core/locales/en.js");
const i18n = await import("../../web/js/core/i18n.js");
const f = await import("../../web/js/core/format.js");
const m = await import("../../web/js/core/model.js");
const banner = await import("../../web/js/docs/banner-doc.js");

const WEB = new URL("../../web/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = readdirSync(WEB, { recursive: true }).map(String).filter((p) => !p.startsWith("vendor") && /\.(js|html)$/.test(p) && !p.endsWith("en.js"));
const sources = Object.fromEntries(files.map((p) => [p, readFileSync(join(WEB, p), "utf8")]));
const tokens = (text) => [...new Set(text.match(/\{\w+\}/g) || [])].map((t) => t.replace("{warranty}", "{garantia}")).sort();

function usedKeys() {
  const keys = new Map();
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/\btr(?:Html)?\(\s*("(?:[^"\\]|\\.)*")/g)) keys.set(JSON.parse(match[1]), file);
    for (const match of source.matchAll(/data-i18n(?:="html")?(?=[\s>])[^>]*>([^<]*(?:<strong>[^<]*<\/strong>[^<]*)?)</g)) keys.set(match[1].trim(), file);
    for (const match of source.matchAll(/aria-label="([^"]*)"[^>]*data-i18n-label/g)) keys.set(match[1], file);
  }
  return keys;
}

test("todo texto passado a tr() tem tradução", () => {
  const missing = [...usedKeys()].filter(([key]) => !Object.hasOwn(en, key)).map(([key, file]) => `${file}: ${key}`);
  assert.deepEqual(missing, []);
});

test("valores gravados nos dados e textos padrão têm tradução", () => {
  const values = [
    ...m.EQUIPMENT_TYPES,
    "Serviço", "Unidade", "Hora", "Consulta", "Par", "Kit",
    "pix", "dinheiro", "debito", "credito", "transferencia", "outro",
    ...Object.values(m.DEFAULT_TEXTS).flatMap((group) => Object.values(group)).flat(),
    ...Object.values(banner.BANNER_TEXTS),
    ...banner.BANNER_SERVICES.flat(),
  ].filter((v) => !["AEG", "GBB", "HPA", "Spring", "Sniper"].includes(v));
  assert.deepEqual(values.filter((v) => !Object.hasOwn(en, v)), []);
});

test("traduções mantêm os mesmos {campos}", () => {
  const wrong = Object.entries(en).filter(([key, value]) => tokens(key).join() !== tokens(value).join()).map(([key]) => key);
  assert.deepEqual(wrong, []);
});

test("o dicionário não guarda chaves sem uso", () => {
  const all = Object.values(sources).join("\n");
  // Vêm do servidor, ou são dados gravados, e não aparecem no código do front.
  const external = new Set(["invalido", "vazio", "missing", "method", "conflito", "documento", "id", "colecao", "somente-leitura", "tipo", "tamanho", "interno", "pix", "dinheiro", "debito", "credito", "transferencia", "outro", "O arquivo não é um backup .zip válido.", "O .zip não tem manifest.json do RZ Airsoft.", "manifest.json ilegível.", "Este backup não é do RZ Airsoft 3.", "Backup grande demais.", "Caminho inválido dentro do backup."]);
  const unused = Object.keys(en).filter((key) => !external.has(key) && !all.includes(JSON.stringify(key).slice(1, -1)) && !all.includes(key));
  assert.deepEqual(unused, []);
});

test("tr() traduz, preenche e nunca mostra chave crua", () => {
  assert.equal(i18n.tr("Novo cliente"), "New customer");
  assert.equal(i18n.tr("OS {n}", { n: 12 }), "WO 12");
  assert.equal(i18n.tr("Texto que não existe {n}", { n: 1 }), "Texto que não existe 1");
  assert.equal(String(i18n.trHtml("foi para <strong>{s}</strong>", { s: "<b>" })), "moved to <strong>&lt;b&gt;</strong>");
  assert.equal(i18n.trValue("Pistola elétrica"), "Electric pistol");
  assert.equal(i18n.trValue("constructor"), "constructor");
});

test("moeda continua em reais, com formato e datas em inglês", () => {
  assert.equal(f.money(123456), "R$1,234.56");
  assert.equal(f.maskMoney("12000"), "R$120.00");
  assert.equal(f.date("2026-03-20"), "03/20/2026");
  assert.equal(f.relative(f.todayISO()), "today");
  assert.equal(f.csvDelimiter(), ",");
  assert.equal(f.csvMoney(123456), "1234.56");
});

test("textos padrão salvos em português acompanham o inglês, e os editados ficam como estão", () => {
  const settings = m.settingsWithDefaults({ business: { subtitle: "Manutenção de airsoft", tagline: "Meu slogan" }, report: { title: "Relatório técnico" } });
  assert.equal(settings.business.subtitle, "Airsoft maintenance");
  assert.equal(settings.business.tagline, "Meu slogan");
  assert.equal(settings.report.title, "Technical report");
  assert.equal(m.catalogWithDefaults({ meta: { subtitle: "Catálogo de serviços" } }).meta.subtitle, "Service catalog");
});

test("mensagem de WhatsApp em inglês", () => {
  const settings = m.settingsWithDefaults({});
  const order = m.newOrder(settings, { number: "0012", status: "pronto", client: { name: "Bruno Lima" }, equipment: { model: "M4" } });
  assert.equal(m.whatsappMessage(order, settings), "Hi, Bruno! This is RZ Airsoft. Your M4 (WO 0012) is ready for pickup. Let us know if you have any questions.");
});
