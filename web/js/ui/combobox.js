/* Campo com sugestões (combobox ARIA). Usado para escolher cliente e serviços. */
import { html, render } from "../core/dom.js";
import { fuzzyScore } from "../core/util.js";

/**
 * attachCombo(input, {
 *   source: (query) => [{ id, label, detail, value }],
 *   onSelect: (option) => void,
 *   createLabel: (query) => "Cadastrar “Fulano”" (opcional),
 *   onCreate: (query) => void (opcional),
 * })
 */
export function attachCombo(input, { source, onSelect, createLabel, onCreate, minChars = 0, limit = 8 }) {
  const wrap = input.closest(".combo") || input.parentElement;
  const listId = `combo-${Math.random().toString(36).slice(2, 8)}`;
  const list = document.createElement("div");
  list.className = "combo-list";
  list.id = listId;
  list.setAttribute("data-morph-keep", "");
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.appendChild(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";

  let options = [];
  let active = -1;
  let open = false;

  const close = () => {
    open = false;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const paint = () => {
    const query = input.value.trim();
    if (query.length < minChars) {
      close();
      return;
    }
    const raw = source(query) || [];
    options = query
      ? raw
          .map((opt) => ({ opt, score: fuzzyScore(`${opt.label} ${opt.detail || ""} ${opt.keywords || ""}`, query) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((x) => x.opt)
      : raw.slice(0, limit);
    const exact = options.some((o) => o.label.trim().toLowerCase() === query.toLowerCase());
    const showCreate = Boolean(onCreate && query && !exact);
    if (!options.length && !showCreate) {
      render(list, html`<div class="combo-empty">Nenhum resultado</div>`);
    } else {
      render(
        list,
        html`${options.map(
          (o, i) => html`<button type="button" class="combo-option" role="option" id="${listId}-${i}" data-index="${i}" aria-selected="${i === active ? "true" : "false"}" tabindex="-1">
            ${o.prefix ? o.prefix : ""}
            <span class="truncate"><span>${o.label}</span>${o.detail ? html`<small>${o.detail}</small>` : ""}</span>
          </button>`
        )}${showCreate
          ? html`<button type="button" class="combo-option" role="option" id="${listId}-new" data-combo-create aria-selected="${active === options.length ? "true" : "false"}" tabindex="-1">
              <span class="avatar avatar-sm">+</span><span>${createLabel ? createLabel(query) : `Usar “${query}”`}</span>
            </button>`
          : ""}`
      );
    }
    open = true;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", active === options.length ? `${listId}-new` : `${listId}-${active}`);
  };

  const choose = (index) => {
    if (index === options.length && onCreate) {
      const query = input.value.trim();
      close();
      onCreate(query);
      return;
    }
    const option = options[index];
    if (!option) return;
    close();
    onSelect(option);
  };

  input.addEventListener("input", () => {
    active = -1;
    paint();
  });
  input.addEventListener("focus", () => {
    if (!input.readOnly) paint();
  });
  input.addEventListener("keydown", (event) => {
    const total = options.length + (onCreate && input.value.trim() ? 1 : 0);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) paint();
      active = Math.min(total - 1, active + 1);
      paint();
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(0, active - 1);
      paint();
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close();
    }
  });
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const btn = event.target.closest(".combo-option");
    if (!btn) return;
    if (btn.hasAttribute("data-combo-create")) choose(options.length);
    else choose(Number(btn.dataset.index));
  });
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { close, refresh: paint };
}
