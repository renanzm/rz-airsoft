/* Menu suspenso (Popover API): setas navegam, Enter escolhe, Esc fecha. */
import { esc } from "../core/dom.js";
import { icon } from "./icons.js";
import { tr } from "../core/i18n.js";

let openMenuEl = null;
let lastClosed = { trigger: null, at: 0 };

function place(menu, trigger, align) {
  const rect = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const gap = 6;
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 8 && rect.top - gap - height > 8) top = rect.top - gap - height;
  let left = align === "end" ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;
}

/**
 * items: [{ label, icon, hint, kbd, danger, disabled, checked, run }, "-", { heading }]
 */
export function openMenu(trigger, items, { align = "start", label = tr("Ações"), minWidth = 200 } = {}) {
  // O clique no próprio botão fecha o menu (light dismiss) antes de chegar aqui.
  if (lastClosed.trigger === trigger && performance.now() - lastClosed.at < 300) return;
  if (openMenuEl) {
    const same = openMenuEl._trigger === trigger;
    openMenuEl.hidePopover?.();
    openMenuEl.remove();
    openMenuEl = null;
    if (same) return;
  }
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.style.minWidth = `${minWidth}px`;
  menu._trigger = trigger;
  const actionable = [];
  menu.innerHTML = items
    .map((item, index) => {
      if (item === "-") return '<div class="menu-sep" role="separator"></div>';
      if (item.heading) return `<div class="menu-heading">${esc(item.heading)}</div>`;
      actionable.push(index);
      const lead = item.checked != null ? `<span class="menu-check">${item.checked ? icon("check", { size: 15 }) : ""}</span>` : item.icon ? icon(item.icon, { size: 15 }) : item.dot ? `<span class="dot dot-${esc(item.dot)}"></span>` : "";
      return (
        `<button type="button" class="menu-item${item.danger ? " danger" : ""}" role="menuitem" data-index="${index}"${item.disabled ? " disabled" : ""}>` +
        `${lead}<span class="menu-label">${esc(item.label)}${item.hint ? `<small>${esc(item.hint)}</small>` : ""}</span>` +
        (item.kbd ? `<kbd class="kbd">${esc(item.kbd)}</kbd>` : "") +
        "</button>"
      );
    })
    .join("");
  document.body.appendChild(menu);
  openMenuEl = menu;
  trigger.setAttribute("aria-expanded", "true");

  const buttons = () => Array.from(menu.querySelectorAll(".menu-item:not([disabled])"));
  const close = (restore = true) => {
    if (!restore) lastClosed = { trigger, at: performance.now() };
    if (menu.isConnected) {
      try {
        menu.hidePopover();
      } catch {
        /* já fechado */
      }
      menu.remove();
    }
    trigger.setAttribute("aria-expanded", "false");
    if (openMenuEl === menu) openMenuEl = null;
    if (restore && document.contains(trigger)) trigger.focus({ preventScroll: true });
  };

  menu.addEventListener("toggle", (event) => {
    if (event.newState === "closed") close(false);
  });
  menu.addEventListener("click", (event) => {
    const button = event.target.closest(".menu-item");
    if (!button || button.disabled) return;
    const item = items[Number(button.dataset.index)];
    close();
    item?.run?.();
  });
  menu.addEventListener("keydown", (event) => {
    const list = buttons();
    const index = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list[list.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const found = list.find((b, i) => i > index && b.textContent.trim().toLowerCase().startsWith(letter)) || list.find((b) => b.textContent.trim().toLowerCase().startsWith(letter));
      found?.focus();
    }
  });

  menu.showPopover();
  place(menu, trigger, align);
  requestAnimationFrame(() => {
    const checked = menu.querySelector(".menu-item .menu-check svg")?.closest(".menu-item");
    (checked || buttons()[0])?.focus({ preventScroll: true });
  });
  const reposition = () => menu.isConnected && place(menu, trigger, align);
  window.addEventListener("resize", reposition, { once: true });
  return { close };
}

export function closeMenus() {
  if (openMenuEl) {
    try {
      openMenuEl.hidePopover();
    } catch {
      /* ignora */
    }
    openMenuEl.remove();
    openMenuEl = null;
  }
}
