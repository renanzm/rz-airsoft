/* Ponto de entrada do app. */
import "./core/theme.js";
import { api, ApiError, describeError } from "./core/api.js";
import * as store from "./core/store.js";
import * as data from "./core/data.js";
import * as router from "./core/router.js";
import * as theme from "./core/theme.js";
import { STATUS, orderTitle } from "./core/model.js";
import { phone as fmtPhone, money } from "./core/format.js";
import { mountShell, onNavigate, onNewOrder, logout, showShortcuts, switchLanguage } from "./ui/shell.js";
import { registerProvider } from "./ui/palette.js";
import { openNewOrder } from "./ui/new-order.js";
import { toast } from "./ui/toast.js";
import { orderTotal } from "./core/model.js";
import { tr, locale, localizePage, LANGUAGES } from "./core/i18n.js";

localizePage();

const root = document.getElementById("app");

function bootError(message, detail = "") {
  root.innerHTML = `<div class="app-loading"><div class="empty"><div class="empty-icon">!</div><h2></h2><p></p><div class="btn-group"><button type="button" class="btn btn-primary">${tr("Tentar de novo")}</button></div></div></div>`;
  root.querySelector("h2").textContent = message;
  root.querySelector("p").textContent = detail;
  root.querySelector("button").addEventListener("click", () => location.reload());
}

function registerRoutes() {
  router.route("/", () => import("./views/dashboard.js"));
  router.route("/ordens", () => import("./views/orders.js"));
  router.route("/ordens/:id", () => import("./views/order.js"));
  router.route("/ordens/:id/:tab", () => import("./views/order.js"));
  router.route("/clientes", () => import("./views/clients.js"));
  router.route("/clientes/:id", () => import("./views/client.js"));
  router.route("/servicos", () => import("./views/catalog.js"));
  router.route("/marketing", () => import("./views/marketing.js"));
  router.route("/configuracoes", () => import("./views/settings.js"));
  router.route("/configuracoes/:section", () => import("./views/settings.js"));
  router.route("/404", () => import("./views/notfound.js"));
}

function registerPalette() {
  const go = (path) => () => router.navigate(path);
  registerProvider(() => [
    { group: tr("Ir para"), label: tr("Painel"), icon: "dashboard", run: go("/"), kbd: "G D" },
    { group: tr("Ir para"), label: tr("Ordens de serviço"), icon: "orders", run: go("/ordens"), kbd: "G O" },
    { group: tr("Ir para"), label: tr("Quadro da bancada"), icon: "columns", keywords: "kanban status", run: go("/ordens?view=board") },
    { group: tr("Ir para"), label: tr("Clientes"), icon: "users", run: go("/clientes"), kbd: "G C" },
    { group: tr("Ir para"), label: tr("Serviços e preços"), icon: "tag", keywords: tr("catálogo tabela"), run: go("/servicos"), kbd: "G S" },
    { group: tr("Ir para"), label: tr("Marketing e banner"), icon: "megaphone", run: go("/marketing") },
    { group: tr("Ir para"), label: tr("Configurações"), icon: "settings", run: go("/configuracoes"), kbd: "G ," },
    { group: tr("Ir para"), label: tr("Backup e dados"), icon: "database", keywords: tr("exportar importar restaurar"), run: go("/configuracoes/dados") },
    { group: tr("Ir para"), label: tr("Acesso remoto"), icon: "globe", keywords: tr("túnel internet link"), run: go("/configuracoes/acesso") },
  ]);
  registerProvider(() => [
    { group: tr("Ações"), label: tr("Nova ordem de serviço"), icon: "plus", run: () => openNewOrder(), kbd: "N", boost: 2 },
    { group: tr("Ações"), label: tr("Novo cliente"), icon: "userPlus", run: go("/clientes?novo=1") },
    { group: tr("Ações"), label: theme.resolved() === "dark" ? tr("Usar tema claro") : tr("Usar tema escuro"), icon: theme.resolved() === "dark" ? "sun" : "moon", keywords: tr("tema aparência"), run: () => theme.setPreference(theme.resolved() === "dark" ? "light" : "dark") },
    { group: tr("Ações"), label: tr("Baixar backup completo (.zip)"), icon: "download", run: () => (location.href = "/api/v1/backup") },
    { group: tr("Ações"), label: tr("Atalhos de teclado"), icon: "keyboard", run: showShortcuts },
    (() => {
      const other = LANGUAGES.find((l) => l.id !== locale());
      return { group: tr("Ações"), label: tr("Mudar idioma para {lang}", { lang: other.label }), icon: "globe", keywords: "idioma language inglês português english portuguese", run: () => switchLanguage(other.id) };
    })(),
    { group: tr("Ações"), label: tr("Sair"), icon: "logout", run: logout },
  ]);
  registerProvider((query) => {
    const orders = data.orders();
    const list = query ? orders : [...orders].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);
    return list.map((o) => ({
      group: query ? tr("Ordens de serviço") : tr("Ordens recentes"),
      label: `${o.number ? tr("OS {n}", { n: o.number }) : tr("OS")} — ${orderTitle(o)}`,
      hint: `${STATUS[o.status]?.label || ""} · ${money(orderTotal(o))}`,
      icon: "orders",
      keywords: `${o.problem} ${o.equipment?.type || ""}`,
      run: go(`/ordens/${o.id}`),
    }));
  });
  registerProvider((query) => {
    if (!query) return [];
    return data.clients().map((c) => ({
      group: tr("Clientes"),
      label: c.name || tr("Sem nome"),
      hint: fmtPhone(c.phone),
      icon: "user",
      keywords: `${c.phone} ${c.equipment.map((e) => e.model).join(" ")}`,
      run: go(`/clientes/${c.id}`),
    }));
  });
}

async function boot() {
  let session;
  try {
    session = await api("GET", "/session");
  } catch (error) {
    bootError(tr("Não foi possível falar com o servidor"), tr("Confira se a janela do RZ Airsoft está aberta neste computador e recarregue."));
    return;
  }
  if (!session.authenticated) {
    const next = location.pathname + location.search;
    location.replace("/login" + (next !== "/" ? `?next=${encodeURIComponent(next)}` : ""));
    return;
  }
  try {
    await store.load();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    bootError(tr("Não foi possível carregar os dados"), describeError(error));
    return;
  }

  try {
    const { runLegacyMigration } = await import("./migrate/legacy.js");
    const report = await runLegacyMigration();
    if (report?.imported) {
      toast.success(tr("Dados da versão anterior importados"), { description: report.summary, duration: 9000 });
    }
  } catch (error) {
    console.error("Migração", error);
    toast.error(tr("Não foi possível importar os dados antigos"), { description: describeError(error) });
  }

  const outlet = mountShell(root);
  onNewOrder(() => openNewOrder());
  registerRoutes();
  registerPalette();
  store.subscribe((change) => {
    if (change?.type === "error") toast.error(tr("Uma alteração não foi salva"), { description: describeError(change.error) });
  });
  window.addEventListener("beforeunload", (event) => {
    if (store.syncStatus().pending) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  await router.start(outlet, { onNavigate });
}

boot();
