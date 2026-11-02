/* Configurações: oficina, conta, aparência, dados e acesso remoto. */
import { html, render, on } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import * as theme from "../core/theme.js";
import { api, ApiError, describeError } from "../core/api.js";
import { maskPhone, phone as fmtPhone, bytes, dateTime, relative, number } from "../core/format.js";
import { icon } from "../ui/icons.js";
import { confirm } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { setCrumbs, logout, showShortcuts } from "../ui/shell.js";

const SECTIONS = [
  { id: "", label: "Oficina", icon: "wrench", desc: "Dados que aparecem nos documentos" },
  { id: "conta", label: "Conta e segurança", icon: "shield", desc: "Senha e sessões" },
  { id: "aparencia", label: "Aparência", icon: "sun", desc: "Tema e barra lateral" },
  { id: "dados", label: "Dados e backup", icon: "database", desc: "Pasta do OneDrive, backup, importação" },
  { id: "acesso", label: "Acesso remoto", icon: "globe", desc: "Usar de outro computador" },
];

export function mount(el, ctx) {
  const section = SECTIONS.some((s) => s.id === (ctx.params.section || "")) ? ctx.params.section || "" : "";
  const current = SECTIONS.find((s) => s.id === section);
  setCrumbs([{ label: "Configurações", href: "/configuracoes" }, ...(section ? [{ label: current.label }] : [{ label: "Oficina" }])]);
  let system = null;

  el.innerHTML = String(html`<div class="page page-wide">
    <header class="page-head"><div class="page-head-main"><h1 class="page-title">Configurações</h1><p class="page-desc">Ajustes da oficina e do sistema.</p></div></header>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="Seções">
        ${SECTIONS.map((s) => html`<a class="settings-link${s.id === section ? " active" : ""}" href="/configuracoes${s.id ? "/" + s.id : ""}" ${s.id === section ? html`aria-current="page"` : ""}>${icon(s.icon, { size: 16 })}<span><strong>${s.label}</strong><small>${s.desc}</small></span></a>`)}
      </nav>
      <div class="settings-body" data-body></div>
    </div>
  </div>`);
  const body = el.querySelector("[data-body]");

  const settings = () => data.settings();
  const saveSettings = (path, value) => {
    const s = settings();
    const [group, key] = path.split(".");
    data.saveSettings({ ...s, [group]: { ...s[group], [key]: value } }, { debounce: 600 });
  };

  /* ------------------------------------------------------------ seções */
  function oficina() {
    const s = settings();
    const b = s.business;
    return html`
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Identidade da oficina</h2><p class="card-desc">Nome, contato e redes nos PDFs, no banner e nas mensagens.</p></div></header>
        <div class="card-body">
          <div class="form-grid cols-2">
            <label class="field"><span class="label">Nome da oficina</span><input class="input" data-s="business.name" value="${b.name}" /></label>
            <label class="field"><span class="label">Subtítulo</span><input class="input" data-s="business.subtitle" value="${b.subtitle}" /></label>
            <label class="field span-2"><span class="label">Slogan</span><input class="input" data-s="business.tagline" value="${b.tagline}" /></label>
            <label class="field"><span class="label">WhatsApp / telefone</span><input class="input" data-s="business.phone" data-mask="phone" inputmode="tel" value="${fmtPhone(b.phone)}" placeholder="(48) 99999-9999" /></label>
            <label class="field"><span class="label">Instagram</span><input class="input" data-s="business.instagram" value="${b.instagram}" placeholder="@rzairsoft" /></label>
            <label class="field"><span class="label">E-mail</span><input class="input" type="email" data-s="business.email" value="${b.email}" /></label>
            <label class="field"><span class="label">Cidade</span><input class="input" data-s="business.city" value="${b.city}" placeholder="Florianópolis – SC" /></label>
            <label class="field"><span class="label">Endereço</span><input class="input" data-s="business.address" value="${b.address}" /></label>
            <label class="field"><span class="label">CNPJ / CPF</span><input class="input mono" data-s="business.document" value="${b.document}" /></label>
          </div>
        </div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Ordens de serviço</h2><p class="card-desc">Padrões para cada OS nova.</p></div></header>
        <div class="card-body stack">
          <div class="form-grid cols-3">
            <label class="field"><span class="label">Técnico responsável</span><input class="input" data-s="orders.technician" value="${s.orders.technician}" placeholder="Seu nome" /></label>
            <label class="field"><span class="label">Garantia padrão</span><div class="input-wrap"><input class="input input-number" data-s="orders.warrantyDays" data-type="int" inputmode="numeric" value="${s.orders.warrantyDays}" /><span class="input-suffix">dias</span></div></label>
            <label class="field"><span class="label">Dígitos do número</span><select class="select" data-s="orders.digits" data-type="int">${[3, 4, 5, 6].map((n) => html`<option value="${n}"${n === Number(s.orders.digits) ? " selected" : ""}>${n} (ex.: ${"1".padStart(n, "0")})</option>`)}</select><span class="hint">Vale para a primeira OS; as seguintes continuam a numeração da última.</span></label>
          </div>
          <label class="field"><span class="label">Garantia e condições (impressas na OS)</span><textarea class="textarea" rows="4" data-s="orders.terms">${s.orders.terms}</textarea><span class="hint">Use {garantia} para inserir os dias de garantia de cada OS.</span></label>
        </div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Relatório técnico</h2><p class="card-desc">Títulos do PDF em A4 paisagem.</p></div></header>
        <div class="card-body">
          <div class="form-grid cols-2">
            <label class="field"><span class="label">Título</span><input class="input" data-s="report.title" value="${s.report.title}" /></label>
            <label class="field"><span class="label">Subtítulo</span><input class="input" data-s="report.subtitle" value="${s.report.subtitle}" /></label>
            <label class="field span-2"><span class="label">Rodapé</span><input class="input" data-s="report.footer" value="${s.report.footer}" /></label>
          </div>
        </div>
      </section>`;
  }

  function conta() {
    const user = store.currentUser();
    return html`
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Usuário</h2><p class="card-desc">Acesso único desta instalação.</p></div></header>
        <div class="card-body row"><span class="avatar">${(user?.username || "?").slice(0, 2).toUpperCase()}</span><div class="cell-main"><strong>${user?.username || "—"}</strong><small>Administrador</small></div></div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Trocar senha</h2><p class="card-desc">As outras sessões abertas (outros computadores) saem automaticamente.</p></div></header>
        <form class="card-body stack" data-password novalidate>
          <input type="text" name="username" autocomplete="username" value="${user?.username || ""}" hidden />
          <div class="form-grid cols-3">
            <label class="field"><span class="label">Senha atual</span><input class="input" type="password" name="current" autocomplete="current-password" required /></label>
            <label class="field"><span class="label">Nova senha</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required /><span class="hint">Mínimo de 8 caracteres. Prefira uma frase longa.</span></label>
            <label class="field"><span class="label">Repetir nova senha</span><input class="input" type="password" name="confirm" autocomplete="new-password" required /></label>
          </div>
          <p class="field-error" data-error hidden></p>
          <div class="row"><button type="submit" class="btn btn-primary">Salvar nova senha</button></div>
        </form>
      </section>
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Sessões</h2><p class="card-desc">Use se você entrou num computador que não é seu.</p></div></header>
        <div class="card-body row-wrap">
          <button type="button" class="btn btn-secondary" data-act="logout-all">${icon("shieldCheck", { size: 16 })}Encerrar as outras sessões</button>
          <button type="button" class="btn btn-ghost" data-act="logout">${icon("logout", { size: 16 })}Sair deste navegador</button>
        </div>
      </section>`;
  }

  function aparencia() {
    const pref = theme.preference();
    const collapsed = document.documentElement.dataset.sidebar === "collapsed";
    const option = (id, label, desc, ic) => html`<button type="button" class="theme-card${pref === id ? " active" : ""}" data-theme-pref="${id}" aria-pressed="${pref === id ? "true" : "false"}">
      <span class="theme-swatch theme-${id}"><span></span><span></span><span></span></span>
      <span class="theme-card-label">${icon(ic, { size: 15 })}<strong>${label}</strong></span><small>${desc}</small>
    </button>`;
    return html`
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Tema</h2><p class="card-desc">Os PDFs mantêm sempre a identidade da RZ.</p></div></header>
        <div class="card-body"><div class="theme-grid">
          ${option("dark", "Escuro", "Grafite e dourado (padrão)", "moon")}
          ${option("light", "Claro", "Para ambientes bem iluminados", "sun")}
          ${option("system", "Sistema", "Segue o Windows ou o celular", "monitor")}
        </div></div>
      </section>
      <section class="card">
        <header class="card-head"><h2 class="card-title">Navegação</h2></header>
        <div class="card-body stack">
          <label class="switch"><input type="checkbox" data-act="sidebar" ${collapsed ? "checked" : ""} /><span>Barra lateral recolhida (atalho: tecla [ )</span></label>
          <div class="row"><button type="button" class="btn btn-secondary btn-sm" data-act="shortcuts">${icon("keyboard", { size: 15 })}Ver atalhos de teclado</button></div>
        </div>
      </section>`;
  }

  function dados() {
    const counts = system?.counts || {};
    return html`
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Onde os dados ficam</h2><p class="card-desc">Tudo é gravado neste computador, numa pasta que o OneDrive sincroniza.</p></div>
          ${system ? (system.onedrive ? html`<span class="badge badge-success">${icon("cloudCheck", { size: 13 })}OneDrive</span>` : html`<span class="badge badge-warning">Fora do OneDrive</span>`) : ""}</header>
        <div class="card-body stack">
          ${system
            ? html`<dl class="props">
                <dt>Pasta</dt><dd><code class="mono path">${system.dataDir}</code></dd>
                <dt>Ordens</dt><dd>${number(counts.orders || 0)}</dd>
                <dt>Clientes</dt><dd>${number(counts.clients || 0)}</dd>
                <dt>Fotos</dt><dd>${number(counts.files || 0)} · ${bytes(system.filesBytes)}</dd>
                <dt>Banco</dt><dd>${bytes(system.dbBytes)}</dd>
                <dt>Última gravação</dt><dd>${system.lastWrite ? html`${dateTime(system.lastWrite)} <span class="subtle">(${relative(system.lastWrite)})</span>` : "—"}</dd>
                <dt>Versão</dt><dd>${system.version} · Python ${system.python}</dd>
              </dl>
              ${(system.warnings || []).map((w) => html`<div class="callout callout-warning">${icon("alert", { size: 16 })}<span>${w}</span></div>`)}
              ${system.onedrive ? "" : html`<div class="callout callout-warning">${icon("alert", { size: 16 })}<span>A pasta de dados não parece estar no OneDrive. Faça backups com frequência.</span></div>`}`
            : html`<div class="skeleton" style="height:120px"></div>`}
          <div class="callout">${icon("info", { size: 16 })}<span>Além da sincronização, o servidor guarda cópias automáticas a cada 10 minutos de uso em <strong>dados/cloud/backups</strong>.</span></div>
        </div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Backup completo</h2><p class="card-desc">Um arquivo .zip com ordens, clientes, catálogo, configurações e fotos.</p></div></header>
        <div class="card-body row-wrap">
          <a class="btn btn-primary" href="/api/v1/backup" download>${icon("download", { size: 16 })}Baixar backup (.zip)</a>
          <label class="btn btn-secondary">${icon("upload", { size: 16 })}Restaurar de um backup…<input type="file" accept=".zip,application/zip" hidden data-restore /></label>
        </div>
        <div class="card-foot hint">Restaurar substitui os dados atuais. Antes, o sistema salva uma cópia de segurança do estado atual.</div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Dados da versão anterior</h2><p class="card-desc">Arquivos .json baixados no sistema antigo (Controle, Histórico, Serviços ou um relatório).</p></div></header>
        <div class="card-body stack">
          <label class="dropzone" data-legacy-drop>
            <input type="file" accept=".json,application/json" multiple hidden data-legacy />
            ${icon("upload", { size: 20 })}<strong>Importar arquivos .json antigos</strong><span class="hint">OS e clientes repetidos não são duplicados.</span>
          </label>
          ${settings().migration ? html`<p class="hint">Importação automática feita em ${dateTime(settings().migration.at)}${settings().migration.summary ? ` · ${settings().migration.summary}` : ""}.</p>` : ""}
        </div>
      </section>`;
  }

  function acesso() {
    const url = system?.tunnelUrl;
    return html`
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Endereço público</h2><p class="card-desc">Para abrir o sistema em outro computador ou no celular, fora da rede de casa.</p></div>
          ${url ? html`<span class="badge badge-success"><span class="dot dot-success"></span>Ativo</span>` : html`<span class="badge">Desligado</span>`}</header>
        <div class="card-body stack">
          ${url
            ? html`<div class="copy-field"><code class="mono">${url}</code><button type="button" class="btn btn-secondary btn-sm" data-copy="${url}">${icon("copy", { size: 14 })}Copiar</button></div>
                <p class="hint">O link muda cada vez que o túnel é aberto. Quem tiver o link chega na tela de login — não compartilhe.</p>`
            : html`<ol class="steps">
                <li>Feche esta janela do servidor (ou deixe aberta, tanto faz).</li>
                <li>Dê dois cliques em <strong>INICIAR_RZ_INTERNET.bat</strong>, na pasta do sistema.</li>
                <li>O endereço <code>https://…trycloudflare.com</code> aparece na janela e também aqui.</li>
              </ol>`}
        </div>
      </section>
      <section class="card">
        <header class="card-head"><h2 class="card-title">Boas práticas</h2></header>
        <div class="card-body">
          <ul class="checklist">
            <li>${icon("check", { size: 15 })}Use uma senha longa (uma frase funciona bem).</li>
            <li>${icon("check", { size: 15 })}Depois de usar um computador de terceiros, encerre as outras sessões em <a class="link-strong" href="/configuracoes/conta">Conta e segurança</a>.</li>
            <li>${icon("check", { size: 15 })}Não abra a porta 8765 no roteador: o túnel já resolve o acesso externo.</li>
            <li>${icon("check", { size: 15 })}Este computador precisa ficar ligado e com a janela do servidor aberta.</li>
          </ul>
        </div>
      </section>`;
  }

  function paint() {
    const views = { "": oficina, conta, aparencia, dados, acesso };
    render(body, html`<div class="stack-lg">${views[section]()}</div>`);
  }

  async function loadSystem() {
    try {
      system = await api("GET", "/system");
      paint();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) toast.error("Não foi possível ler as informações do servidor", { description: describeError(error) });
    }
  }

  async function restore(file) {
    const ok = await confirm({
      title: "Restaurar este backup?",
      message: `Os dados atuais serão substituídos pelo conteúdo de “${file.name}”. Uma cópia do estado atual fica em dados/cloud/backups/completo.`,
      confirmLabel: "Restaurar",
      danger: true,
    });
    if (!ok) return;
    const progress = toast.loading("Restaurando backup…");
    try {
      await store.flushAll().catch(() => {});
      const res = await api("POST", "/restore", { body: file, headers: { "Content-Type": "application/zip" }, timeout: 600000 });
      progress.update("Backup restaurado", "success", `${res.counts?.orders ?? 0} OS · ${res.counts?.clients ?? 0} clientes · ${res.files} fotos`);
      await store.poll();
      loadSystem();
    } catch (error) {
      progress.update("Não foi possível restaurar", "error", error?.body?.message || describeError(error));
    }
  }

  async function importLegacy(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const progress = toast.loading("Importando arquivos…");
    try {
      const { importLegacyFiles } = await import("../migrate/legacy.js");
      const report = await importLegacyFiles(list);
      progress.update(report.imported ? "Importação concluída" : "Nada novo para importar", "success", report.summary);
    } catch (error) {
      console.error(error);
      progress.update("Não foi possível importar", "error", error?.message || "");
    }
  }

  const off = [
    on(body, "input", "[data-s]", (e, input) => {
      let value = input.value;
      if (input.dataset.mask === "phone") {
        input.value = maskPhone(input.value);
        value = input.value.replace(/\D/g, "");
      }
      if (input.dataset.type === "int") value = Number(String(value).replace(/\D/g, "")) || 0;
      saveSettings(input.dataset.s, value);
    }),
    on(body, "submit", "[data-password]", async (e, form) => {
      e.preventDefault();
      const f = form.elements;
      const err = form.querySelector("[data-error]");
      const fail = (msg, field) => {
        err.textContent = msg;
        err.hidden = false;
        field?.focus();
      };
      err.hidden = true;
      if (f.next.value.length < 8) return fail("A nova senha precisa ter pelo menos 8 caracteres.", f.next);
      if (f.next.value !== f.confirm.value) return fail("A confirmação não confere com a nova senha.", f.confirm);
      const button = form.querySelector("button[type=submit]");
      button.setAttribute("aria-busy", "true");
      try {
        await api("POST", "/auth/password", { json: { current: f.current.value, next: f.next.value } });
        form.reset();
        toast.success("Senha alterada", { description: "As outras sessões foram encerradas." });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) fail("A senha atual está incorreta.", f.current);
        else fail(describeError(error));
      } finally {
        button.removeAttribute("aria-busy");
      }
    }),
    on(body, "click", "[data-act]", async (e, btn) => {
      const act = btn.dataset.act;
      if (act === "logout") logout();
      else if (act === "shortcuts") showShortcuts();
      else if (act === "logout-all") {
        const ok = await confirm({ title: "Encerrar as outras sessões?", message: "Todos os outros navegadores precisarão entrar de novo. Este continua conectado.", confirmLabel: "Encerrar" });
        if (!ok) return;
        try {
          await api("POST", "/auth/logout-all", { json: {} });
          toast.success("Outras sessões encerradas");
        } catch (error) {
          toast.error("Não foi possível encerrar as sessões", { description: describeError(error) });
        }
      }
    }),
    on(body, "change", "[data-act='sidebar']", (e, input) => {
      if (input.checked) document.documentElement.dataset.sidebar = "collapsed";
      else delete document.documentElement.dataset.sidebar;
      try {
        localStorage.setItem("rz3:sidebar", input.checked ? "collapsed" : "expanded");
      } catch {
        /* ignora */
      }
    }),
    on(body, "click", "[data-theme-pref]", (e, btn) => {
      theme.setPreference(btn.dataset.themePref);
      paint();
    }),
    on(body, "click", "[data-copy]", (e, btn) => {
      navigator.clipboard?.writeText(btn.dataset.copy).then(() => toast.success("Endereço copiado"));
    }),
    on(body, "change", "[data-restore]", (e, input) => {
      const file = input.files?.[0];
      input.value = "";
      if (file) restore(file);
    }),
    on(body, "change", "[data-legacy]", (e, input) => {
      importLegacy(input.files);
      input.value = "";
    }),
    on(body, "dragover", "[data-legacy-drop]", (e, zone) => {
      e.preventDefault();
      zone.classList.add("dragging");
    }),
    on(body, "dragleave", "[data-legacy-drop]", (e, zone) => zone.classList.remove("dragging")),
    on(body, "drop", "[data-legacy-drop]", (e, zone) => {
      e.preventDefault();
      zone.classList.remove("dragging");
      importLegacy(e.dataTransfer?.files);
    }),
  ];
  const unsubscribe = store.subscribe((change) => {
    if (!change || change.type === "reload" || change.coll === "settings" || change.colls?.includes("settings")) paint();
  });
  paint();
  if (section === "dados" || section === "acesso") loadSystem();
  return {
    unmount() {
      off.forEach((fn) => fn());
      unsubscribe();
    },
  };
}
