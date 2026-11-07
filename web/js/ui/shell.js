/* Estrutura do app: barra lateral, barra superior, indicador de sincronização e atalhos. */
import { html, render, isTyping, esc } from "../core/dom.js";
import * as store from "../core/store.js";
import * as theme from "../core/theme.js";
import { isActive, navigate } from "../core/router.js";
import { OPEN_STATUSES } from "../core/model.js";
import { initials } from "../core/format.js";
import { icon } from "./icons.js";
import { openMenu } from "./menu.js";
import { openPalette } from "./palette.js";
import { modal } from "./dialog.js";
import { toast } from "./toast.js";
import { tr, locale, setLanguage, LANGUAGES } from "../core/i18n.js";

const NAV = [
  { href: "/", label: tr("Painel"), icon: "dashboard", key: "d" },
  { href: "/ordens", label: tr("Ordens de serviço"), icon: "orders", key: "o", count: "open" },
  { href: "/clientes", label: tr("Clientes"), icon: "users", key: "c" },
  { href: "/servicos", label: tr("Serviços e preços"), icon: "tag", key: "s" },
  { href: "/marketing", label: tr("Marketing"), icon: "megaphone", key: "m" },
];

const QUICK = [
  { href: "/ordens?status=bancada", label: tr("Na bancada"), dot: "bancada", status: "bancada" },
  { href: "/ordens?status=aguardando", label: tr("Aguardando peças"), dot: "aguardando", status: "aguardando" },
  { href: "/ordens?status=pronto", label: tr("Prontas p/ retirada"), dot: "pronto", status: "pronto" },
];

let els = {};
let crumbs = [];
let newOrderHandler = () => navigate("/ordens?nova=1");

export function onNewOrder(fn) {
  newOrderHandler = fn;
}

export function setCrumbs(list) {
  crumbs = list || [];
  paintCrumbs();
  const last = crumbs[crumbs.length - 1];
  document.title = last ? `${last.label} · RZ Airsoft` : "RZ Airsoft";
}

function paintCrumbs() {
  if (!els.crumbs) return;
  render(
    els.crumbs,
    html`${crumbs.map((c, i) =>
      i === crumbs.length - 1
        ? html`<span class="crumb current" aria-current="page">${c.label}</span>`
        : html`<a class="crumb" href="${c.href}">${c.label}</a><span class="crumb-sep" aria-hidden="true">${icon("chevronRight", { size: 14 })}</span>`
    )}`
  );
}

function counts() {
  const orders = store.list("orders");
  const byStatus = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  return { open: orders.filter((o) => OPEN_STATUSES.includes(o.status)).length, byStatus };
}

function paintNav() {
  const c = counts();
  const user = store.currentUser();
  render(
    els.nav,
    html`
      <div class="nav-section">
        ${NAV.map(
          (item) => html`<a class="nav-item${isActive(item.href) ? " active" : ""}" href="${item.href}" ${isActive(item.href) ? html`aria-current="page"` : ""} data-tip="${item.label}">
            ${icon(item.icon, { size: 18 })}<span class="nav-label">${item.label}</span>
            ${item.count && c.open ? html`<span class="nav-count">${c.open}</span>` : ""}
          </a>`
        )}
      </div>
      <div class="nav-section">
        <div class="nav-heading">${tr("Bancada")}</div>
        ${QUICK.map(
          (item) => html`<a class="nav-item nav-quick${location.pathname + location.search === item.href ? " active" : ""}" href="${item.href}" data-tip="${item.label}">
            <span class="dot dot-${item.dot}"></span><span class="nav-label">${item.label}</span>
            <span class="nav-count subtle">${c.byStatus[item.status] || 0}</span>
          </a>`
        )}
      </div>
    `
  );
  render(
    els.foot,
    html`
      <a class="nav-item${isActive("/configuracoes") ? " active" : ""}" href="/configuracoes" data-tip="${tr("Configurações")}">${icon("settings", { size: 18 })}<span class="nav-label">${tr("Configurações")}</span></a>
      <button type="button" class="user-button" data-user-menu aria-haspopup="menu" aria-expanded="false">
        <span class="avatar avatar-sm">${initials(user?.username || "RZ")}</span>
        <span class="user-meta"><strong>${user?.username || tr("Usuário")}</strong><small>${tr("Administrador")}</small></span>
        ${icon("chevronsUpDown", { size: 14, className: "user-caret" })}
      </button>
    `
  );
}

function paintSync(snapshot) {
  if (!els.sync) return;
  const map = {
    idle: { icon: "cloudCheck", label: tr("Salvo"), cls: "ok" },
    saving: { icon: "loader", label: tr("Salvando…"), cls: "saving" },
    offline: { icon: "cloudOff", label: snapshot.pending > 1 ? tr("Offline · {n} pendentes", { n: snapshot.pending }) : snapshot.pending ? tr("Offline · {n} pendente", { n: snapshot.pending }) : "Offline", cls: "offline" },
    error: { icon: "alert", label: tr("Erro ao salvar"), cls: "error" },
  };
  const s = map[snapshot.state] || map.idle;
  els.sync.className = `sync sync-${s.cls}`;
  els.sync.title = snapshot.error || (s.cls === "ok" ? tr("Tudo salvo no servidor (pasta do OneDrive)") : s.label);
  els.sync.innerHTML = `${icon(s.icon, { size: 15, className: s.cls === "saving" ? "spin" : "" })}<span>${esc(s.label)}</span>`;
}

function userMenu(trigger) {
  const pref = theme.preference();
  openMenu(
    trigger,
    [
      { heading: tr("Aparência") },
      { label: tr("Escuro"), checked: pref === "dark", run: () => theme.setPreference("dark") },
      { label: tr("Claro"), checked: pref === "light", run: () => theme.setPreference("light") },
      { label: tr("Seguir o sistema"), checked: pref === "system", run: () => theme.setPreference("system") },
      "-",
      { heading: tr("Idioma") },
      ...LANGUAGES.map((language) => ({ label: language.label, checked: locale() === language.id, run: () => switchLanguage(language.id) })),
      "-",
      { label: tr("Configurações"), icon: "settings", run: () => navigate("/configuracoes") },
      { label: tr("Atalhos de teclado"), icon: "keyboard", kbd: "?", run: showShortcuts },
      "-",
      { label: tr("Sair"), icon: "logout", danger: true, run: logout },
    ],
    { align: "start", label: tr("Conta"), minWidth: 220 }
  );
}

/** Grava o que estiver pendente e recarrega no novo idioma. */
export async function switchLanguage(id) {
  await store.flushAll().catch(() => {});
  setLanguage(id);
}

export async function logout() {
  try {
    await store.flushAll();
  } catch {
    /* segue para sair */
  }
  try {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  } finally {
    location.replace("/login");
  }
}

export function showShortcuts() {
  const rows = [
    [["Ctrl", "K"], tr("Buscar e executar comandos")],
    [["N"], tr("Nova ordem de serviço")],
    [["G", "D"], tr("Ir para o Painel")],
    [["G", "O"], tr("Ir para Ordens de serviço")],
    [["G", "C"], tr("Ir para Clientes")],
    [["G", "S"], tr("Ir para Serviços e preços")],
    [["G", ","], tr("Ir para Configurações")],
    [["["], tr("Recolher ou expandir a barra lateral")],
    [["?"], tr("Mostrar estes atalhos")],
  ];
  modal({
    title: tr("Atalhos de teclado"),
    size: "sm",
    content: html`<dl class="shortcut-list">${rows.map(
      ([keys, label]) => html`<div class="shortcut-row"><dt>${label}</dt><dd>${keys.map((k, i) => html`${i ? html`<span class="kbd-then">${keys.length === 2 && keys[0] !== "Ctrl" ? tr("depois") : "+"}</span>` : ""}<kbd class="kbd">${k}</kbd>`)}</dd></div>`
    )}</dl>`,
  });
}

function toggleSidebar() {
  const root = document.documentElement;
  const collapsed = root.dataset.sidebar === "collapsed";
  if (collapsed) delete root.dataset.sidebar;
  else root.dataset.sidebar = "collapsed";
  try {
    localStorage.setItem("rz3:sidebar", collapsed ? "expanded" : "collapsed");
  } catch {
    /* ignora */
  }
}

function setDrawer(open) {
  document.body.classList.toggle("drawer-open", open);
  els.menuButton?.setAttribute("aria-expanded", String(open));
  if (open) els.sidebar.querySelector(".nav-item.active, .nav-item")?.focus();
}

function setupShortcuts() {
  let pendingG = 0;
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event) || document.querySelector("dialog[open]")) return;
    const key = event.key.toLowerCase();
    if (pendingG && Date.now() - pendingG < 1200) {
      pendingG = 0;
      const target = { d: "/", o: "/ordens", c: "/clientes", s: "/servicos", m: "/marketing", ",": "/configuracoes" }[key];
      if (target) {
        event.preventDefault();
        navigate(target);
      }
      return;
    }
    if (key === "g") {
      pendingG = Date.now();
      return;
    }
    if (key === "/") {
      event.preventDefault();
      openPalette();
    } else if (key === "n") {
      event.preventDefault();
      newOrderHandler();
    } else if (event.key === "?") {
      event.preventDefault();
      showShortcuts();
    } else if (key === "[") {
      event.preventDefault();
      toggleSidebar();
    }
  });
}

export function mountShell(root) {
  root.innerHTML = String(html`
    <a class="skip-link" href="#main">${tr("Pular para o conteúdo")}</a>
    <aside class="sidebar" id="sidebar" aria-label="${tr("Navegação")}">
      <div class="sidebar-brand">
        <a class="brand" href="/" aria-label="${tr("RZ Airsoft — Painel")}">
          <span class="brand-mark"><img src="/assets/logo.png" alt="" width="28" height="28" /></span>
          <span class="brand-text"><strong>RZ Airsoft</strong><small>${tr("Gestão da oficina")}</small></span>
        </a>
        <button type="button" class="btn btn-ghost btn-icon btn-sm sidebar-collapse" data-collapse aria-label="${tr("Recolher barra lateral")}" title="${tr("Recolher barra lateral ( [ )")}">${icon("sidebar", { size: 17 })}</button>
      </div>
      <button type="button" class="sidebar-search" data-palette>
        ${icon("search", { size: 16 })}<span class="nav-label">${tr("Buscar…")}</span><span class="kbd-group"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd></span>
      </button>
      <nav class="sidebar-nav" data-nav></nav>
      <div class="sidebar-foot" data-foot></div>
    </aside>
    <div class="drawer-backdrop" data-backdrop></div>
    <div class="workspace">
      <header class="topbar">
        <button type="button" class="btn btn-ghost btn-icon topbar-menu" data-menu aria-label="${tr("Abrir menu")}" aria-controls="sidebar" aria-expanded="false">${icon("menu", { size: 20 })}</button>
        <nav class="crumbs" aria-label="${tr("Você está em")}" data-crumbs></nav>
        <div class="topbar-actions">
          <button type="button" class="sync sync-ok" data-sync aria-live="polite"></button>
          <button type="button" class="btn btn-ghost btn-icon topbar-search" data-palette aria-label="${tr("Buscar (Ctrl+K)")}">${icon("search", { size: 18 })}</button>
          <button type="button" class="btn btn-ghost btn-icon" data-theme-toggle aria-label="${tr("Alternar tema")}" title="${tr("Alternar tema")}"></button>
          <button type="button" class="btn btn-primary btn-sm" data-new-order>${icon("plus", { size: 16 })}<span>${tr("Nova OS")}</span></button>
        </div>
      </header>
      <main class="main" id="main" tabindex="-1" data-outlet></main>
    </div>
  `);

  els = {
    sidebar: root.querySelector("#sidebar"),
    nav: root.querySelector("[data-nav]"),
    foot: root.querySelector("[data-foot]"),
    crumbs: root.querySelector("[data-crumbs]"),
    sync: root.querySelector("[data-sync]"),
    outlet: root.querySelector("[data-outlet]"),
    menuButton: root.querySelector("[data-menu]"),
    themeButton: root.querySelector("[data-theme-toggle]"),
  };

  const paintTheme = () => {
    const dark = theme.resolved() === "dark";
    els.themeButton.innerHTML = String(icon(dark ? "sun" : "moon", { size: 18 }));
    els.themeButton.title = dark ? tr("Usar tema claro") : tr("Usar tema escuro");
  };
  paintTheme();
  theme.onThemeChange(paintTheme);

  root.addEventListener("click", (event) => {
    const t = event.target instanceof Element ? event.target : null;
    if (!t) return;
    if (t.closest("[data-palette]")) openPalette();
    else if (t.closest("[data-new-order]")) newOrderHandler();
    else if (t.closest("[data-collapse]")) toggleSidebar();
    else if (t.closest("[data-menu]")) setDrawer(!document.body.classList.contains("drawer-open"));
    else if (t.closest("[data-backdrop]")) setDrawer(false);
    else if (t.closest("[data-theme-toggle]")) theme.setPreference(theme.resolved() === "dark" ? "light" : "dark");
    else if (t.closest("[data-user-menu]")) userMenu(t.closest("[data-user-menu]"));
    else if (t.closest("[data-sync]")) {
      const s = store.syncStatus();
      if (s.state === "error" || s.state === "offline") toast.error(s.error || tr("As alterações ainda não chegaram ao servidor."), { description: tr("O app tenta de novo sozinho. Os dados ficam guardados neste navegador até lá.") });
      else store.poll().then(() => toast.success(tr("Tudo sincronizado")));
    }
    if (t.closest(".sidebar a.nav-item")) setDrawer(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("drawer-open")) setDrawer(false);
  });

  store.onStatus(paintSync);
  store.subscribe(() => paintNav());
  setupShortcuts();
  paintNav();
  return els.outlet;
}

/** Chamado pelo roteador a cada navegação. */
export function onNavigate() {
  paintNav();
  document.body.classList.remove("drawer-open");
}
