/* Notificações discretas no canto da tela, com ação opcional (ex.: Desfazer). */
import { esc } from "../core/dom.js";
import { icon } from "./icons.js";

let region = null;

function ensureRegion() {
  if (region && document.body.contains(region)) return region;
  region = document.createElement("section");
  region.className = "toasts";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-label", "Notificações");
  document.body.appendChild(region);
  return region;
}

const ICONS = { success: "checkCircle", error: "alert", info: "info", loading: "loader" };

/**
 * toast("Salvo") · toast.error("Falhou") · toast("Excluída", { action: { label: "Desfazer", run } })
 * Devolve { close(), update(message, kind) }.
 */
export function toast(message, { kind = "success", description = "", action = null, duration } = {}) {
  const host = ensureRegion();
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  const ms = duration ?? (kind === "loading" ? 0 : action ? 7000 : kind === "error" ? 6500 : 3200);

  const paint = (msg, k, desc) => {
    el.className = `toast toast-${k}`;
    el.innerHTML =
      `<span class="toast-icon">${icon(ICONS[k] || "info", { size: 18, className: k === "loading" ? "spin" : "" })}</span>` +
      `<div class="toast-body"><p class="toast-title">${esc(msg)}</p>${desc ? `<p class="toast-desc">${esc(desc)}</p>` : ""}</div>` +
      (action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : "") +
      `<button type="button" class="toast-close" aria-label="Fechar">${icon("x", { size: 14 })}</button>`;
  };
  paint(message, kind, description);

  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };
  const arm = (duration) => {
    clearTimeout(timer);
    if (duration) timer = setTimeout(close, duration);
  };
  el.addEventListener("click", (event) => {
    if (event.target.closest(".toast-close")) close();
    if (event.target.closest(".toast-action")) {
      action?.run?.();
      close();
    }
  });
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => arm(2500));
  host.appendChild(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  arm(ms);

  return {
    close,
    update(msg, k = "success", desc = "") {
      paint(msg, k, desc);
      arm(k === "loading" ? 0 : k === "error" ? 6500 : 3200);
    },
  };
}

toast.success = (message, opts) => toast(message, { ...opts, kind: "success" });
toast.error = (message, opts) => toast(message, { ...opts, kind: "error" });
toast.info = (message, opts) => toast(message, { ...opts, kind: "info" });
toast.loading = (message, opts) => toast(message, { ...opts, kind: "loading" });
