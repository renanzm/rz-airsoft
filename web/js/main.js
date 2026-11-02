/* Ponto de entrada do app. */
import "./core/theme.js";
import { api, ApiError, describeError } from "./core/api.js";
import * as store from "./core/store.js";
import * as data from "./core/data.js";
import * as router from "./core/router.js";
import * as theme from "./core/theme.js";
import { STATUS, orderTitle } from "./core/model.js";
import { phone as fmtPhone, money } from "./core/format.js";
import { mountShell, onNavigate, onNewOrder, logout, showShortcuts } from "./ui/shell.js";
import { registerProvider } from "./ui/palette.js";
import { openNewOrder } from "./ui/new-order.js";
import { toast } from "./ui/toast.js";
import { orderTotal } from "./core/model.js";

const root = document.getElementById("app");

function bootError(message, detail = "") {
  root.innerHTML = `<div class="app-loading"><div class="empty"><div class="empty-icon">!</div><h2></h2><p></p><div class="btn-group"><button type="button" class="btn btn-primary">Tentar de novo</button></div></div></div>`;
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
    { group: "Ir para", label: "Painel", icon: "dashboard", run: go("/"), kbd: "G D" },
    { group: "Ir para", label: "Ordens de serviço", icon: "orders", run: go("/ordens"), kbd: "G O" },
    { group: "Ir para", label: "Quadro da bancada", icon: "columns", keywords: "kanban status", run: go("/ordens?view=board") },
    { group: "Ir para", label: "Clientes", icon: "users", run: go("/clientes"), kbd: "G C" },
    { group: "Ir para", label: "Serviços e preços", icon: "tag", keywords: "catálogo tabela", run: go("/servicos"), kbd: "G S" },
    { group: "Ir para", label: "Marketing e banner", icon: "megaphone", run: go("/marketing") },
    { group: "Ir para", label: "Configurações", icon: "settings", run: go("/configuracoes"), kbd: "G ," },
    { group: "Ir para", label: "Backup e dados", icon: "database", keywords: "exportar importar restaurar", run: go("/configuracoes/dados") },
    { group: "Ir para", label: "Acesso remoto", icon: "globe", keywords: "túnel internet link", run: go("/configuracoes/acesso") },
  ]);
  registerProvider(() => [
    { group: "Ações", label: "Nova ordem de serviço", icon: "plus", run: () => openNewOrder(), kbd: "N", boost: 2 },
    { group: "Ações", label: "Novo cliente", icon: "userPlus", run: go("/clientes?novo=1") },
    { group: "Ações", label: theme.resolved() === "dark" ? "Usar tema claro" : "Usar tema escuro", icon: theme.resolved() === "dark" ? "sun" : "moon", keywords: "tema aparência", run: () => theme.setPreference(theme.resolved() === "dark" ? "light" : "dark") },
    { group: "Ações", label: "Baixar backup completo (.zip)", icon: "download", run: () => (location.href = "/api/v1/backup") },
    { group: "Ações", label: "Atalhos de teclado", icon: "keyboard", run: showShortcuts },
    { group: "Ações", label: "Sair", icon: "logout", run: logout },
  ]);
  registerProvider((query) => {
    const orders = data.orders();
    const list = query ? orders : [...orders].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);
    return list.map((o) => ({
      group: query ? "Ordens de serviço" : "Ordens recentes",
      label: `${o.number ? "OS " + o.number : "OS"} — ${orderTitle(o)}`,
      hint: `${STATUS[o.status]?.label || ""} · ${money(orderTotal(o))}`,
      icon: "orders",
      keywords: `${o.problem} ${o.equipment?.type || ""}`,
      run: go(`/ordens/${o.id}`),
    }));
  });
  registerProvider((query) => {
    if (!query) return [];
    return data.clients().map((c) => ({
      group: "Clientes",
      label: c.name || "Sem nome",
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
    bootError("Não foi possível falar com o servidor", "Confira se a janela do RZ Airsoft está aberta neste computador e recarregue.");
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
    bootError("Não foi possível carregar os dados", describeError(error));
    return;
  }

  try {
    const { runLegacyMigration } = await import("./migrate/legacy.js");
    const report = await runLegacyMigration();
    if (report?.imported) {
      toast.success("Dados da versão anterior importados", { description: report.summary, duration: 9000 });
    }
  } catch (error) {
    console.error("Migração", error);
    toast.error("Não foi possível importar os dados antigos", { description: describeError(error) });
  }

  const outlet = mountShell(root);
  onNewOrder(() => openNewOrder());
  registerRoutes();
  registerPalette();
  store.subscribe((change) => {
    if (change?.type === "error") toast.error("Uma alteração não foi salva", { description: describeError(change.error) });
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
