/* Idioma da interface: português (padrão) ou inglês. Fica salvo neste navegador.
 *
 * O próprio texto em português é a chave: tr("Novo cliente") devolve o texto em
 * inglês de locales/en.js ou, em português, o texto como está. Sem tradução,
 * aparece o português (e um aviso no console), nunca uma chave crua.
 *
 * O idioma é lido uma vez, ao carregar. Trocar recarrega a página, então listas
 * fixas dos módulos (status, menus) podem usar tr() direto.
 */
import { html, raw } from "./dom.js";
import en from "./locales/en.js";

const KEY = "rz3:lang";
const DEFAULT = "pt-BR";

export const LANGUAGES = [
  { id: "pt-BR", label: "Português" },
  { id: "en-US", label: "English" },
];

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const current = LANGUAGES.some((l) => l.id === stored()) ? stored() : DEFAULT;
const english = current === "en-US";
const warned = new Set();

export function locale() {
  return current;
}

export function setLanguage(id) {
  if (id === current || !LANGUAGES.some((l) => l.id === id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage indisponível: não há onde guardar a escolha */
  }
  location.reload();
}

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (token, name) => (name in params ? String(params[name]) : token));
}

/** Traduz um texto da interface. tr("OS {n}", { n: 12 }) preenche os {campos}. */
export function tr(source, params) {
  if (!english) return fill(source, params);
  if (Object.hasOwn(en, source)) return fill(en[source], params);
  if (!warned.has(source)) {
    warned.add(source);
    console.warn("[i18n] sem tradução:", source);
  }
  return fill(source, params);
}

/** Para templates html``: o texto pode ter marcação; os {campos} são escapados. */
export function trHtml(source, params = {}) {
  const safe = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, String(html`${value}`)]));
  return raw(tr(source, safe));
}

/** Valor vindo dos dados (tipo de equipamento, unidade): traduz se for conhecido, sem aviso. */
export function trValue(value) {
  return english && Object.hasOwn(en, value) ? en[value] : value;
}

/**
 * Textos padrão gravados nos dados (slogan, termos de garantia…) acompanham o
 * idioma enquanto ninguém os editar. `sources` traz o(s) texto(s) em português.
 */
export function localizeDefault(value, sources) {
  const source = [sources].flat().find((text) => text === value || en[text] === value);
  return source === undefined ? value : tr(source);
}

/** Traduz o HTML fixo: [data-i18n] (texto ou, com ="html", marcação) e [data-i18n-label] (aria-label). */
export function localizePage() {
  const root = document.documentElement;
  root.lang = current;
  document.title = trValue(document.title);
  for (const el of document.querySelectorAll("[data-i18n]")) {
    if (el.dataset.i18n === "html") el.innerHTML = tr(el.innerHTML.trim());
    else el.textContent = tr(el.textContent.trim());
  }
  for (const el of document.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", tr(el.getAttribute("aria-label")));
  root.dataset.i18nReady = "";
}
