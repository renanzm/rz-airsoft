/* Paleta de comandos (Ctrl+K): ir para telas, executar ações, achar OS e clientes. */
import { html, render } from "../core/dom.js";
import { fuzzyScore } from "../core/util.js";
import { icon } from "./icons.js";
import { modal } from "./dialog.js";

let providers = [];
let isOpen = false;

/** Cada provedor devolve [{ id, group, label, hint, icon, keywords, run }] para a busca. */
export function registerProvider(fn) {
  providers.push(fn);
}

function collect(query) {
  const items = [];
  for (const provider of providers) {
    try {
      items.push(...provider(query));
    } catch (error) {
      console.error(error);
    }
  }
  const scored = items
    .map((item) => {
      const base = query ? fuzzyScore(`${item.label} ${item.keywords || ""} ${item.hint || ""}`, query) : 1;
      return { item, score: base > 0 ? base + (item.boost || 0) : 0 };
    })
    .filter((entry) => entry.score > 0);
  if (query) scored.sort((a, b) => b.score - a.score);
  const groups = new Map();
  for (const { item } of scored) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    const list = groups.get(item.group);
    if (list.length < (query ? 6 : 8)) list.push(item);
  }
  return groups;
}

export function openPalette(initial = "") {
  if (isOpen) return;
  isOpen = true;
  let active = 0;
  let flat = [];
  const { el, close } = modal({
    size: "palette",
    dismissable: true,
    className: "palette",
    content: html`
      <div class="palette-search">
        ${icon("search", { size: 18 })}
        <input class="palette-input" type="text" placeholder="Busque telas, ações, OS ou clientes…" aria-label="Buscar" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list" value="${initial}" autofocus />
        <kbd class="kbd">Esc</kbd>
      </div>
      <div class="palette-list" id="palette-list" role="listbox" aria-label="Resultados"></div>
      <div class="palette-foot">
        <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> navegar</span>
        <span><kbd class="kbd">Enter</kbd> abrir</span>
        <span><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd> abre de qualquer tela</span>
      </div>
    `,
    onClose: () => {
      isOpen = false;
    },
  });
  el.querySelector(".dialog-head")?.remove();
  const input = el.querySelector(".palette-input");
  const listEl = el.querySelector(".palette-list");

  const paint = () => {
    const groups = collect(input.value.trim());
    flat = [];
    for (const items of groups.values()) flat.push(...items);
    if (active >= flat.length) active = Math.max(0, flat.length - 1);
    let i = -1;
    render(
      listEl,
      flat.length
        ? html`${[...groups.entries()].map(
            ([group, items]) => html`<div class="palette-group" role="presentation">
              <div class="palette-group-label">${group}</div>
              ${items.map((item) => {
                i += 1;
                const selected = i === active;
                return html`<div class="palette-item${selected ? " active" : ""}" role="option" id="pal-${i}" data-index="${i}" aria-selected="${selected ? "true" : "false"}">
                  <span class="palette-item-icon">${icon(item.icon || "arrowRight", { size: 16 })}</span>
                  <span class="palette-item-label">${item.label}</span>
                  ${item.hint ? html`<span class="palette-item-hint">${item.hint}</span>` : ""}
                  ${item.kbd ? html`<kbd class="kbd">${item.kbd}</kbd>` : ""}
                </div>`;
              })}
            </div>`
          )}`
        : html`<div class="palette-empty">${icon("search", { size: 20 })}<p>Nada encontrado para “${input.value}”.</p></div>`
    );
    input.setAttribute("aria-activedescendant", flat.length ? `pal-${active}` : "");
    listEl.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  };

  const run = (index) => {
    const item = flat[index];
    if (!item) return;
    close();
    setTimeout(() => item.run(), 0);
  };

  input.addEventListener("input", () => {
    active = 0;
    paint();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(flat.length - 1, active + 1);
      paint();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(0, active - 1);
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  });
  listEl.addEventListener("mousemove", (event) => {
    const item = event.target.closest(".palette-item");
    if (!item) return;
    const index = Number(item.dataset.index);
    if (index !== active) {
      active = index;
      paint();
    }
  });
  listEl.addEventListener("click", (event) => {
    const item = event.target.closest(".palette-item");
    if (item) run(Number(item.dataset.index));
  });
  paint();
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
