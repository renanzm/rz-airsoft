/* Clientes: lista com busca, valor gasto e última visita. */
import { html, render, on } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { setQuery, navigate } from "../core/router.js";
import { clientOrders, orderTotal, isPaid, OPEN_STATUSES, newClient, findClientByName } from "../core/model.js";
import { money, phone as fmtPhone, maskPhone, relative, date, initials, plural, whatsappLink, todayISO } from "../core/format.js";
import { matches, downloadBlob } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { modal } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { setCrumbs } from "../ui/shell.js";

export function openNewClient({ name = "", onCreated } = {}) {
  const { el, close } = modal({
    title: "Novo cliente",
    description: "Só o nome é obrigatório. O resto você completa quando souber.",
    content: html`<form class="stack" data-form novalidate>
      <label class="field"><span class="label">Nome <span class="req">*</span></span><input class="input" name="name" value="${name}" autocomplete="off" required autofocus /><span class="field-error" hidden></span></label>
      <div class="grid-2">
        <label class="field"><span class="label">WhatsApp / telefone</span><input class="input" name="phone" inputmode="tel" placeholder="(48) 99999-9999" /></label>
        <label class="field"><span class="label">Instagram</span><input class="input" name="instagram" placeholder="@usuario" autocomplete="off" /></label>
        <label class="field"><span class="label">E-mail</span><input class="input" name="email" type="email" autocomplete="off" /></label>
        <label class="field"><span class="label">Cidade</span><input class="input" name="city" autocomplete="off" /></label>
      </div>
      <label class="field"><span class="label">Notas</span><textarea class="textarea" name="notes" rows="3" placeholder="Time, preferências, combinados…"></textarea></label>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>Cadastrar cliente</button>`,
  });
  const form = el.querySelector("[data-form]");
  form.elements.phone.addEventListener("input", (e) => (e.target.value = maskPhone(e.target.value)));
  const save = () => {
    const f = form.elements;
    const value = f.name.value.trim();
    if (!value) {
      const err = el.querySelector(".field-error");
      err.textContent = "Informe o nome do cliente.";
      err.hidden = false;
      f.name.setAttribute("aria-invalid", "true");
      f.name.focus();
      return;
    }
    const existing = findClientByName(data.clients(), value);
    if (existing) {
      toast.info(`${existing.name} já está cadastrado`, {
        action: {
          label: "Abrir ficha",
          run: () => {
            close();
            navigate(`/clientes/${existing.id}`);
          },
        },
      });
      return;
    }
    const client = data.saveClient(
      newClient({
        name: value,
        phone: f.phone.value.replace(/\D/g, ""),
        instagram: f.instagram.value.trim(),
        email: f.email.value.trim(),
        city: f.city.value.trim(),
        notes: f.notes.value.trim(),
      })
    );
    close("ok");
    toast.success(`${client.name} cadastrado`);
    onCreated?.(client);
  };
  el.querySelector("[data-save]").addEventListener("click", save);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
}

export function mount(el, ctx) {
  let q = ctx.query;
  setCrumbs([{ label: "Clientes", href: "/clientes" }]);
  el.innerHTML = '<div class="page" data-clients></div>';
  const root = el.firstElementChild;

  function rows() {
    const orders = data.orders();
    return data.clients().map((client) => {
      const list = clientOrders(orders, client);
      const spent = list.filter(isPaid).reduce((acc, o) => acc + orderTotal(o), 0);
      const last = list.map((o) => o.receivedAt || "").sort().pop() || "";
      return { client, count: list.length, open: list.filter((o) => OPEN_STATUSES.includes(o.status)).length, spent, last };
    });
  }

  function paint() {
    const search = q.get("q") || "";
    const sort = q.get("sort") || "name";
    const all = rows();
    let list = all.filter((r) => matches(`${r.client.name} ${r.client.phone} ${r.client.city} ${r.client.instagram} ${r.client.equipment.map((e) => `${e.model} ${e.brand}`).join(" ")}`, search));
    if (sort === "spent") list.sort((a, b) => b.spent - a.spent);
    else if (sort === "last") list.sort((a, b) => b.last.localeCompare(a.last));
    else if (sort === "count") list.sort((a, b) => b.count - a.count);
    const totalSpent = all.reduce((acc, r) => acc + r.spent, 0);
    const withOpen = all.filter((r) => r.open).length;

    render(
      root,
      html`
        <header class="page-head">
          <div class="page-head-main">
            <h1 class="page-title">Clientes</h1>
            <p class="page-desc">${all.length ? html`${plural(all.length, "cliente", "clientes")} · ${plural(withOpen, "com OS em aberto", "com OS em aberto")} · ${money(totalSpent)} em serviços pagos` : "Quem deixa a réplica na bancada."}</p>
          </div>
          <div class="page-actions">
            ${all.length ? html`<button type="button" class="btn btn-secondary" data-act="csv">${icon("download", { size: 16 })}Exportar</button>` : ""}
            <button type="button" class="btn btn-primary" data-act="new">${icon("userPlus", { size: 16 })}Novo cliente</button>
          </div>
        </header>
        ${all.length
          ? html`
              <div class="toolbar">
                <div class="input-wrap search">${icon("search", { size: 15 })}<input class="input" type="search" placeholder="Buscar por nome, telefone, cidade, réplica…" value="${search}" data-search aria-label="Buscar clientes" /></div>
                <div class="segmented" role="group" aria-label="Ordenar">
                  ${[["name", "Nome"], ["last", "Última visita"], ["spent", "Valor gasto"], ["count", "Nº de OS"]].map(([k, label]) => html`<button type="button" data-sort="${k}" aria-pressed="${sort === k ? "true" : "false"}">${label}</button>`)}
                </div>
              </div>
              ${list.length
                ? html`<div class="table-wrap"><table class="table">
                    <thead><tr><th>Cliente</th><th>Contato</th><th class="hide-md">Equipamentos</th><th class="num">OS</th><th class="num hide-sm">Valor pago</th><th class="hide-sm">Última visita</th><th class="w-actions"></th></tr></thead>
                    <tbody>${list.map(({ client, count, open, spent, last }) => html`<tr class="clickable" data-key="${client.id}" data-open="${client.id}">
                      <td><div class="row"><span class="avatar">${initials(client.name)}</span><div class="cell-main"><a class="link-strong" href="/clientes/${client.id}">${client.name || "Sem nome"}</a><small>${[client.city, client.instagram].filter(Boolean).join(" · ") || (client.notes ? client.notes.slice(0, 60) : "")}</small></div></div></td>
                      <td class="nowrap">${client.phone ? fmtPhone(client.phone) : html`<span class="subtle">—</span>`}</td>
                      <td class="hide-md"><span class="truncate block">${client.equipment.length ? client.equipment.map((e) => [e.model, e.brand].filter(Boolean).join(" ")).join(", ") : html`<span class="subtle">—</span>`}</span></td>
                      <td class="num">${count}${open ? html` <span class="badge badge-accent">${open} aberta${open > 1 ? "s" : ""}</span>` : ""}</td>
                      <td class="num hide-sm">${spent ? money(spent) : html`<span class="subtle">—</span>`}</td>
                      <td class="hide-sm nowrap">${last ? html`<span title="${date(last)}">${relative(last)}</span>` : html`<span class="subtle">—</span>`}</td>
                      <td class="w-actions" data-stop>${client.phone ? html`<a class="btn btn-ghost btn-icon btn-sm" href="${whatsappLink(client.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${client.name}" title="Conversar no WhatsApp">${icon("message", { size: 16 })}</a>` : ""}</td>
                    </tr>`)}</tbody>
                  </table></div>`
                : html`<div class="card"><div class="empty"><div class="empty-icon">${icon("search", { size: 20 })}</div><h3>Ninguém encontrado</h3><p>Nenhum cliente combina com “${search}”.</p></div></div>`}
            `
          : html`<div class="card"><div class="empty">
              <div class="empty-icon">${icon("users", { size: 20 })}</div>
              <h3>Nenhum cliente cadastrado</h3>
              <p>Os clientes também são cadastrados automaticamente quando você cria uma OS com um nome novo.</p>
              <div class="btn-group"><button type="button" class="btn btn-primary" data-act="new">${icon("userPlus", { size: 16 })}Cadastrar cliente</button></div>
            </div></div>`}
      `
    );
  }

  function exportCsv() {
    const list = rows();
    const head = ["Nome", "Telefone", "E-mail", "Instagram", "Cidade", "Equipamentos", "OS", "Valor pago", "Última visita", "Notas"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = list.map(({ client, count, spent, last }) => [client.name, fmtPhone(client.phone), client.email, client.instagram, client.city, client.equipment.map((e) => [e.model, e.brand].filter(Boolean).join(" ")).join("; "), count, (spent / 100).toFixed(2).replace(".", ","), date(last, ""), client.notes]);
    downloadBlob(new Blob(["﻿" + [head, ...lines].map((r) => r.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }), `clientes_${todayISO()}.csv`);
    toast.success("Clientes exportados em CSV");
  }

  const off = [
    on(root, "input", "[data-search]", (e, input) => setQuery({ q: input.value.trim() })),
    on(root, "click", "[data-sort]", (e, btn) => setQuery({ sort: btn.dataset.sort === "name" ? "" : btn.dataset.sort })),
    on(root, "click", "[data-act]", (e, btn) => {
      if (btn.dataset.act === "new") openNewClient({ onCreated: (c) => ctx.navigate(`/clientes/${c.id}`) });
      if (btn.dataset.act === "csv") exportCsv();
    }),
    on(root, "click", "[data-open]", (e, row) => {
      if (e.target.closest("a, button, [data-stop]")) return;
      ctx.navigate(`/clientes/${row.dataset.open}`);
    }),
  ];
  const unsubscribe = store.subscribe(() => paint());
  if (q.get("novo") === "1") {
    setQuery({ novo: "" });
    setTimeout(() => openNewClient({ onCreated: (c) => ctx.navigate(`/clientes/${c.id}`) }), 0);
  }
  paint();
  return {
    onQuery(next) {
      q = next;
      if (q.get("novo") === "1") {
        setQuery({ novo: "" });
        openNewClient({ onCreated: (c) => ctx.navigate(`/clientes/${c.id}`) });
        return;
      }
      paint();
    },
    unmount() {
      off.forEach((fn) => fn());
      unsubscribe();
    },
  };
}
