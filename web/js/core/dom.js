/* Templates com escape automático e atualização do DOM no lugar (morph).
 *
 *   render(el, html`<p>${nome}</p>`)
 *
 * Tudo que entra em ${...} é escapado, exceto o que vier de html`` ou raw().
 * O render compara o DOM atual com o novo e muda só o que mudou: foco,
 * seleção de texto, rolagem e listeners nos elementos continuam valendo.
 * Use data-key em itens de listas para manter a identidade ao reordenar.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESC[ch]);
}

class Raw {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

export function raw(text) {
  return new Raw(String(text ?? ""));
}

function piece(value) {
  if (value == null || value === false || value === true) return "";
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(piece).join("");
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += piece(values[i]) + strings[i + 1];
  return new Raw(out);
}

/** Atributo opcional: attr("disabled", cond) → ' disabled' ou ''. */
export function attr(name, value) {
  if (value == null || value === false) return raw("");
  if (value === true) return raw(` ${name}`);
  return raw(` ${name}="${esc(value)}"`);
}

export function cls(...parts) {
  return parts
    .flatMap((part) => (part && typeof part === "object" ? Object.entries(part).filter(([, on]) => on).map(([k]) => k) : [part]))
    .filter(Boolean)
    .join(" ");
}

export function fragment(content) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(content);
  return tpl.content;
}

export function element(content) {
  return fragment(content).firstElementChild;
}

/* ------------------------------------------------------------- morph */
function keyOf(node) {
  return node.nodeType === 1 ? node.getAttribute("data-key") : null;
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.tagName === b.tagName && a.getAttribute("id") === b.getAttribute("id") && keyOf(a) === keyOf(b);
}

function syncAttributes(from, to) {
  const toAttrs = to.attributes;
  // data-morph-attrs="keep": atributos postos por scripts (ARIA de combobox etc.) ficam.
  if (!to.hasAttribute("data-morph-attrs")) {
    for (let i = from.attributes.length - 1; i >= 0; i -= 1) {
      const name = from.attributes[i].name;
      if (!to.hasAttribute(name)) from.removeAttribute(name);
    }
  }
  for (let i = 0; i < toAttrs.length; i += 1) {
    const { name, value } = toAttrs[i];
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

function syncFormState(from, to) {
  const focused = document.activeElement === from;
  if (from.tagName === "INPUT") {
    const type = from.type;
    if (type === "checkbox" || type === "radio") {
      from.checked = to.hasAttribute("checked");
    } else if (type !== "file" && !focused) {
      const value = to.getAttribute("value") ?? "";
      if (from.value !== value) from.value = value;
    }
  } else if (from.tagName === "TEXTAREA") {
    if (!focused && from.value !== to.value) from.value = to.value;
  }
}

function selectValue(select) {
  const selected = select.querySelector("option[selected]") || select.querySelector("option");
  return selected ? selected.getAttribute("value") ?? selected.textContent : "";
}

function morphNode(from, to) {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.hasAttribute("data-morph-skip") && to.hasAttribute("data-morph-skip")) return;
  syncAttributes(from, to);
  if (from.tagName === "TEXTAREA") {
    syncFormState(from, to);
    return;
  }
  // O valor desejado do <select> é lido antes: o morph move as <option> de `to`.
  const wanted = from.tagName === "SELECT" ? selectValue(to) : null;
  morphChildren(from, to);
  if (wanted != null) {
    if (document.activeElement !== from && from.value !== wanted) from.value = wanted;
  } else {
    syncFormState(from, to);
  }
}

const kept = (node) => node && node.nodeType === 1 && node.hasAttribute("data-morph-keep");

function morphChildren(from, to) {
  const next = Array.from(to.childNodes);
  const keyed = new Map();
  for (const child of from.childNodes) {
    const key = keyOf(child);
    if (key != null) keyed.set(key, child);
  }
  let cursor = from.firstChild;
  for (const node of next) {
    // Elementos criados por scripts (data-morph-keep) não fazem parte do template.
    while (kept(cursor)) cursor = cursor.nextSibling;
    const key = keyOf(node);
    let match = null;
    if (key != null) {
      match = keyed.get(key) || null;
      if (match && !sameKind(match, node)) match = null;
      if (match) keyed.delete(key);
    } else if (cursor && keyOf(cursor) == null && sameKind(cursor, node)) {
      match = cursor;
    }
    if (match) {
      if (match === cursor) cursor = cursor.nextSibling;
      else from.insertBefore(match, cursor);
      morphNode(match, node);
    } else {
      from.insertBefore(node, cursor);
    }
  }
  while (cursor) {
    const following = cursor.nextSibling;
    if (!kept(cursor)) from.removeChild(cursor);
    cursor = following;
  }
}

/** Substitui o conteúdo de `container` pelo template, mudando só o necessário. */
export function render(container, content) {
  if (!container) return;
  morphChildren(container, fragment(content));
}

/* ------------------------------------------------------------ eventos */
export function on(root, type, selector, handler, options) {
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/** Coleta o valor de um campo pelo tipo. */
export function fieldValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return input.value === "" ? null : Number(input.value);
  return input.value;
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isTyping(event) {
  const el = event.target;
  if (!(el instanceof Element)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
