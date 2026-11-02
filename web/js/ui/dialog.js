/* Diálogos e painéis laterais com <dialog> nativo (foco preso, Esc fecha). */
import { html, raw } from "../core/dom.js";
import { icon } from "./icons.js";

/**
 * Abre um modal. `content` é o HTML do corpo. Devolve
 * { el, close(value), result } — `result` resolve com o valor de fechamento.
 */
export function modal({ title = "", description = "", content = "", footer = "", size = "md", variant = "dialog", className = "", dismissable = true, onMount, onClose } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = `${variant === "sheet" ? "sheet" : "dialog"} ${variant === "sheet" ? "" : `dialog-${size}`} ${className}`.trim();
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.innerHTML = String(html`
    <div class="dialog-inner">
      ${title || dismissable
        ? html`<header class="dialog-head">
            <div class="dialog-titles">
              <h2 class="dialog-title" id="${titleId}">${title}</h2>
              ${description ? html`<p class="dialog-desc">${description}</p>` : ""}
            </div>
            ${dismissable ? html`<button type="button" class="btn btn-ghost btn-icon btn-sm dialog-x" data-close aria-label="Fechar">${icon("x")}</button>` : ""}
          </header>`
        : ""}
      <div class="dialog-body">${raw(String(content))}</div>
      ${footer ? html`<footer class="dialog-foot">${raw(String(footer))}</footer>` : ""}
    </div>
  `);

  let settled = false;
  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });

  const close = (value = null) => {
    if (settled) return;
    settled = true;
    dialog.classList.add("closing");
    const finish = () => {
      if (dialog.open) dialog.close();
      dialog.remove();
      onClose?.(value);
      resolveResult(value);
    };
    setTimeout(finish, 140);
  };

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (dismissable) close(null);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && dismissable) close(null);
    const closer = event.target.closest("[data-close]");
    if (closer && dialog.contains(closer)) close(closer.dataset.close || null);
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  onMount?.(dialog, close);
  const auto = dialog.querySelector("[autofocus]") || dialog.querySelector(".dialog-body :is(input, textarea, select):not([disabled])");
  if (auto) requestAnimationFrame(() => auto.focus());
  return { el: dialog, close, result };
}

/** Confirmação: resolve true/false. */
export function confirm({ title = "Tem certeza?", message = "", confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false } = {}) {
  const { result } = modal({
    title,
    size: "sm",
    content: message ? html`<p class="dialog-message">${message}</p>` : "",
    footer: html`
      <button type="button" class="btn btn-secondary" data-close="cancel">${cancelLabel}</button>
      <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-close="ok" autofocus>${confirmLabel}</button>
    `,
  });
  return result.then((value) => value === "ok");
}

/** Pergunta um texto curto. Resolve com o texto ou null. */
export function promptText({ title, label = "", value = "", placeholder = "", confirmLabel = "Salvar" } = {}) {
  const { el, close, result } = modal({
    title,
    size: "sm",
    content: html`<form class="stack" data-prompt>
      <label class="field"><span class="label">${label}</span>
      <input class="input" name="value" value="${value}" placeholder="${placeholder}" autocomplete="off" autofocus /></label>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancelar</button>
      <button type="button" class="btn btn-primary" data-submit>${confirmLabel}</button>`,
  });
  const submit = () => close(el.querySelector("input[name=value]").value.trim());
  el.querySelector("[data-prompt]").addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  el.querySelector("[data-submit]").addEventListener("click", submit);
  return result.then((v) => (typeof v === "string" && v !== "cancel" ? v : null));
}

/** Painel lateral (detalhes, filtros). */
export function sheet(options) {
  return modal({ ...options, variant: "sheet" });
}

export function keyHint(keys) {
  return html`<span class="kbd-group">${keys.map((k) => html`<kbd class="kbd">${k}</kbd>`)}</span>`;
}

