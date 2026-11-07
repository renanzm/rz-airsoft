/* Ordens de serviço: tabela e quadro (kanban), filtros, seleção em massa. */
import { html, render, on, raw } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { setQuery } from "../core/router.js";
import { STATUSES, STATUS, OPEN_STATUSES, orderTotal, isPaid, fpsGain, orderSearchText, equipmentLabel, withStatus, ageDays, isLate, hasReport, compareNumbers } from "../core/model.js";
import { money, moneyCompact, date, dateShort, signed, plural, todayISO, toISODate, csvDelimiter, csvMoney } from "../core/format.js";
import { matches, downloadBlob, storageGet, storageSet } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { openMenu } from "../ui/menu.js";
import { confirm } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { setCrumbs } from "../ui/shell.js";
import { openNewOrder } from "../ui/new-order.js";
import { orderActions } from "./order-actions.js";
import { tr, trValue, locale } from "../core/i18n.js";

const PAGE = 60;
const PERIODS = [
  { id: "", label: tr("Qualquer data") },
  { id: "mes", label: tr("Este mês") },
  { id: "30", label: tr("Últimos 30 dias") },
  { id: "90", label: tr("Últimos 90 dias") },
  { id: "ano", label: tr("Este ano") },
];

function periodStart(id) {
  const now = new Date();
  if (id === "mes") return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  if (id === "ano") return toISODate(new Date(now.getFullYear(), 0, 1));
  if (id === "30" || id === "90") return toISODate(new Date(now.getTime() - Number(id) * 86400000));
  return "";
}

export function mount(el, ctx) {
  let q = ctx.query;
  let limit = PAGE;
  let selected = new Set();
  let justDragged = false;

  const state = () => ({
    view: q.get("view") || storageGet("rz3:orders-view", "table"),
    status: q.get("status") || "",
    search: q.get("q") || "",
    pay: q.get("pay") || "",
    period: q.get("period") || "",
    report: q.get("relatorio") === "1",
    sort: q.get("sort") || "number",
    dir: q.get("dir") || "desc",
  });

  el.innerHTML = String(html`<div class="page page-wide" data-orders></div>`);
  const root = el.firstElementChild;
  setCrumbs([{ label: tr("Ordens de serviço"), href: "/ordens" }]);

  function filtered(s, all) {
    const start = periodStart(s.period);
    return all.filter((o) => {
      if (s.status === "abertas" && !OPEN_STATUSES.includes(o.status)) return false;
      if (s.status && s.status !== "abertas" && s.view !== "board" && o.status !== s.status) return false;
      if (s.pay === "pago" && !isPaid(o)) return false;
      if (s.pay === "pendente" && isPaid(o)) return false;
      if (start && (o.receivedAt || "") < start) return false;
      if (s.report && !hasReport(o)) return false;
      if (s.search && !matches(orderSearchText(o), s.search)) return false;
      return true;
    });
  }

  function sorted(s, list) {
    const dir = s.dir === "asc" ? 1 : -1;
    const by = {
      number: (a, b) => compareNumbers(a.number, b.number) || String(a.createdAt).localeCompare(String(b.createdAt)),
      client: (a, b) => (a.client?.name || "").localeCompare(b.client?.name || "", locale()),
      status: (a, b) => STATUSES.findIndex((x) => x.id === a.status) - STATUSES.findIndex((x) => x.id === b.status),
      receivedAt: (a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")),
      total: (a, b) => orderTotal(a) - orderTotal(b),
    }[s.sort] || ((a, b) => compareNumbers(a.number, b.number));
    return [...list].sort((a, b) => dir * by(a, b));
  }

  function th(s, key, label, extra = "") {
    const active = s.sort === key;
    return html`<th class="sortable ${extra}" data-sort="${key}" ${active ? raw(`aria-sort="${s.dir === "asc" ? "ascending" : "descending"}"`) : ""}>
      <span class="sort">${label}${active ? icon(s.dir === "asc" ? "arrowUp" : "arrowDown", { size: 12 }) : ""}</span>
    </th>`;
  }

  function statusButton(o) {
    const st = STATUS[o.status];
    return html`<button type="button" class="status" data-status="${o.status}" data-action="status" data-id="${o.id}" aria-label="${tr("Status: {s}. Mudar status", { s: st.label })}">
      ${icon(st.icon, { size: 14 })}${st.label}${icon("chevronDown", { size: 12, className: "caret" })}
    </button>`;
  }

  function payBadge(o) {
    if (!orderTotal(o)) return html`<span class="subtle">—</span>`;
    return isPaid(o) ? html`<span class="badge badge-success">${icon("check", { size: 12 })}${tr("Pago")}</span>` : html`<span class="badge badge-warning">${tr("Pendente")}</span>`;
  }

  function tableView(s, list) {
    const shown = list.slice(0, limit);
    const allChecked = shown.length > 0 && shown.every((o) => selected.has(o.id));
    return html`
      <div class="table-wrap">
        <table class="table orders-table">
          <thead>
            <tr>
              <th class="w-check"><label class="check"><input type="checkbox" data-action="select-all" aria-label="${tr("Selecionar todas")}" ${allChecked ? "checked" : ""} /></label></th>
              ${th(s, "number", tr("OS"), "w-os")}
              ${th(s, "client", tr("Cliente e equipamento"))}
              ${th(s, "status", "Status")}
              ${th(s, "receivedAt", tr("Entrada"), "hide-sm")}
              <th class="hide-md">FPS 0.20</th>
              ${th(s, "total", tr("Valor"), "num")}
              <th class="hide-sm">${tr("Pagamento")}</th>
              <th class="w-actions"><span class="sr-only">${tr("Ações")}</span></th>
            </tr>
          </thead>
          <tbody>
            ${shown.map((o) => {
              const gain = fpsGain(o);
              const late = isLate(o);
              return html`<tr class="clickable${selected.has(o.id) ? " selected" : ""}" data-key="${o.id}" data-open="${o.id}">
                <td class="w-check"><label class="check" data-stop><input type="checkbox" data-action="select" data-id="${o.id}" aria-label="${tr("Selecionar OS {n}", { n: o.number })}" ${selected.has(o.id) ? "checked" : ""} /></label></td>
                <td class="w-os"><a class="os-number" href="/ordens/${o.id}">${o.number || "—"}</a></td>
                <td>
                  <div class="cell-main">
                    <strong class="truncate">${o.client?.name || tr("Sem cliente")}</strong>
                    <small class="truncate">${equipmentLabel(o.equipment) || trValue(o.equipment?.type) || tr("Equipamento não informado")}${o.problem ? html` · ${o.problem}` : ""}</small>
                  </div>
                </td>
                <td data-stop>${statusButton(o)}${late ? html` <span class="badge badge-danger" title="${tr("Previsão de entrega vencida")}">${tr("Atrasada")}</span>` : ""}</td>
                <td class="hide-sm nowrap"><span title="${date(o.receivedAt)}">${dateShort(o.receivedAt)}</span></td>
                <td class="hide-md nowrap tnum">${o.fps?.before?.g20 != null || o.fps?.after?.g20 != null
                  ? html`<span class="muted">${o.fps.before.g20 ?? "—"}</span> ${icon("arrowRight", { size: 12, className: "inline-icon" })} <strong>${o.fps.after.g20 ?? "—"}</strong>${gain != null ? html` <span class="${gain >= 0 ? "success-text" : "danger-text"} small">${signed(gain)}</span>` : ""}`
                  : html`<span class="subtle">—</span>`}</td>
                <td class="num">${orderTotal(o) ? money(orderTotal(o)) : html`<span class="subtle">—</span>`}</td>
                <td class="hide-sm">${payBadge(o)}</td>
                <td class="w-actions" data-stop><button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="row-menu" data-id="${o.id}" aria-label="${tr("Mais ações da OS {n}", { n: o.number })}">${icon("more", { size: 16 })}</button></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      ${list.length > limit ? html`<div class="load-more"><button type="button" class="btn btn-secondary" data-action="more">${tr("Mostrar mais {count} de {rest}", { count: Math.min(PAGE, list.length - limit), rest: list.length - limit })}</button></div>` : ""}
    `;
  }

  function boardView(list) {
    const groups = Object.fromEntries(STATUSES.map((st) => [st.id, []]));
    for (const o of list) groups[o.status]?.push(o);
    for (const st of STATUSES) {
      groups[st.id].sort((a, b) => (st.id === "entregue" ? String(b.deliveredAt || b.updatedAt).localeCompare(String(a.deliveredAt || a.updatedAt)) : compareNumbers(a.number, b.number)));
    }
    return html`<div class="board" data-board>
      ${STATUSES.map((st) => {
        const items = groups[st.id];
        const shown = st.id === "entregue" ? items.slice(0, 30) : items;
        const total = items.reduce((acc, o) => acc + orderTotal(o), 0);
        return html`<section class="kcol" data-col="${st.id}" aria-label="${st.label}">
          <header class="kcol-head">
            <span class="status-dot" data-status="${st.id}">${icon(st.icon, { size: 15 })}</span>
            <h2>${st.label}</h2>
            <span class="kcol-count">${items.length}</span>
            <span class="kcol-sum tnum">${total ? moneyCompact(total) : ""}</span>
          </header>
          <div class="kcol-body" data-drop="${st.id}">
            ${shown.map((o) => {
              const age = ageDays(o);
              const late = isLate(o);
              return html`<article class="kcard${late ? " late" : ""}" data-key="${o.id}" data-id="${o.id}" data-open="${o.id}" tabindex="0" aria-label="${tr("OS {n} de {client}", { n: o.number, client: o.client?.name || tr("cliente") })}">
                <div class="kcard-top">
                  <span class="os-number">${o.number || "—"}</span>
                  ${age != null && st.id !== "entregue" ? html`<span class="kcard-age${age > 14 ? " old" : ""}" title="${tr("Entrada em {date}", { date: date(o.receivedAt) })}">${age === 0 ? tr("hoje") : `${age}d`}</span>` : ""}
                  <button type="button" class="btn btn-ghost btn-icon btn-xs kcard-menu" data-action="row-menu" data-id="${o.id}" aria-label="${tr("Ações da OS {n}", { n: o.number })}">${icon("more", { size: 15 })}</button>
                </div>
                <strong class="kcard-client">${o.client?.name || tr("Sem cliente")}</strong>
                <span class="kcard-equip">${equipmentLabel(o.equipment) || trValue(o.equipment?.type) || tr("Equipamento não informado")}</span>
                ${o.problem ? html`<p class="kcard-problem">${o.problem}</p>` : ""}
                <div class="kcard-foot">
                  ${orderTotal(o) ? html`<span class="kcard-value tnum">${money(orderTotal(o))}</span>` : ""}
                  ${orderTotal(o) ? (isPaid(o) ? html`<span class="badge badge-success">${tr("Pago")}</span>` : html`<span class="badge badge-warning">${tr("Pendente")}</span>`) : ""}
                  ${late ? html`<span class="badge badge-danger">${tr("Atrasada")}</span>` : ""}
                  ${hasReport(o) ? html`<span class="kcard-icon" title="${tr("Tem relatório técnico")}">${icon("fileText", { size: 14 })}</span>` : ""}
                </div>
              </article>`;
            })}
            ${!items.length ? html`<div class="kcol-empty">${tr("Solte uma OS aqui")}</div>` : ""}
            ${items.length > shown.length ? html`<a class="kcol-more" href="/ordens?status=entregue&view=table">${tr("Ver todas as {n} entregues", { n: items.length })}</a>` : ""}
          </div>
        </section>`;
      })}
    </div>`;
  }

  function paint() {
    const s = state();
    const all = data.orders();
    const list = sorted(s, filtered(s, all));
    const counts = Object.fromEntries(STATUSES.map((st) => [st.id, 0]));
    for (const o of filtered({ ...s, status: "" }, all)) counts[o.status] += 1;
    const openTotal = all.filter((o) => OPEN_STATUSES.includes(o.status)).reduce((acc, o) => acc + orderTotal(o), 0);
    const receivable = all.filter((o) => !isPaid(o)).reduce((acc, o) => acc + orderTotal(o), 0);
    for (const id of [...selected]) if (!all.some((o) => o.id === id)) selected.delete(id);
    const filtersOn = Boolean(s.search || s.pay || s.period || s.report || (s.status && s.view !== "board"));
    const periodLabel = PERIODS.find((p) => p.id === s.period)?.label;

    render(
      root,
      html`
        <header class="page-head">
          <div class="page-head-main">
            <h1 class="page-title">${tr("Ordens de serviço")}</h1>
            <p class="page-desc">${all.length ? html`${plural(all.filter((o) => OPEN_STATUSES.includes(o.status)).length, tr("em aberto"), tr("em aberto"))} · ${tr("{v} em serviços abertos", { v: money(openTotal) })} · ${tr("{v} a receber", { v: money(receivable) })}` : tr("Cada equipamento que entra na oficina vira uma OS.")}</p>
          </div>
          <div class="page-actions">
            <button type="button" class="btn btn-secondary" data-action="export" aria-haspopup="menu">${icon("download", { size: 16 })}${tr("Exportar")}</button>
            <button type="button" class="btn btn-primary" data-action="new">${icon("plus", { size: 16 })}${tr("Nova OS")}</button>
          </div>
        </header>

        ${all.length
          ? html`
              <div class="toolbar">
                <div class="input-wrap search">
                  ${icon("search", { size: 15 })}
                  <input class="input" type="search" placeholder="${tr("Buscar OS, cliente, modelo, problema…")}" value="${s.search}" data-search aria-label="${tr("Buscar ordens")}" />
                </div>
                <div class="segmented" role="group" aria-label="${tr("Visualização")}">
                  <button type="button" data-view="table" aria-pressed="${s.view !== "board" ? "true" : "false"}">${icon("list", { size: 15 })}${tr("Lista")}</button>
                  <button type="button" data-view="board" aria-pressed="${s.view === "board" ? "true" : "false"}">${icon("columns", { size: 15 })}${tr("Quadro")}</button>
                </div>
                <button type="button" class="btn btn-secondary btn-sm${s.pay ? " is-on" : ""}" data-action="pay" aria-haspopup="menu">${icon("wallet", { size: 15 })}${s.pay === "pago" ? tr("Pagas") : s.pay === "pendente" ? tr("A receber") : tr("Pagamento")}${icon("chevronDown", { size: 13 })}</button>
                <button type="button" class="btn btn-secondary btn-sm${s.period ? " is-on" : ""}" data-action="period" aria-haspopup="menu">${icon("calendar", { size: 15 })}${s.period ? periodLabel : tr("Período")}${icon("chevronDown", { size: 13 })}</button>
                <label class="check small"><input type="checkbox" data-action="report-filter" ${s.report ? "checked" : ""} />${tr("Com relatório")}</label>
                ${filtersOn ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="clear">${icon("x", { size: 14 })}${tr("Limpar filtros")}</button>` : ""}
              </div>
              ${s.view !== "board"
                ? html`<div class="chips status-chips" role="group" aria-label="${tr("Filtrar por status")}">
                    <button type="button" class="chip" data-status-filter="" aria-pressed="${!s.status ? "true" : "false"}">${tr("Todas")} <span class="count">${Object.values(counts).reduce((a, b) => a + b, 0)}</span></button>
                    <button type="button" class="chip" data-status-filter="abertas" aria-pressed="${s.status === "abertas" ? "true" : "false"}">${tr("Em aberto")} <span class="count">${OPEN_STATUSES.reduce((a, k) => a + counts[k], 0)}</span></button>
                    ${STATUSES.map((st) => html`<button type="button" class="chip" data-status-filter="${st.id}" aria-pressed="${s.status === st.id ? "true" : "false"}"><span class="dot dot-${st.id}"></span>${st.label} <span class="count">${counts[st.id]}</span></button>`)}
                  </div>`
                : ""}
              ${selected.size && s.view !== "board"
                ? html`<div class="bulkbar" role="region" aria-label="${tr("Ações em massa")}">
                    <strong>${plural(selected.size, tr("selecionada"), tr("selecionadas"))}</strong>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="bulk-status" aria-haspopup="menu">${icon("refresh", { size: 14 })}${tr("Mudar status")}</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="bulk-paid">${icon("check", { size: 14 })}${tr("Marcar como pagas")}</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="bulk-csv">${icon("download", { size: 14 })}CSV</button>
                    <button type="button" class="btn btn-danger-ghost btn-sm" data-action="bulk-delete">${icon("trash", { size: 14 })}${tr("Excluir")}</button>
                    <span class="spacer"></span>
                    <button type="button" class="btn btn-ghost btn-sm" data-action="bulk-clear">${tr("Cancelar")}</button>
                  </div>`
                : ""}
              ${list.length
                ? s.view === "board"
                  ? boardView(list)
                  : tableView(s, list)
                : html`<div class="card"><div class="empty">
                    <div class="empty-icon">${icon("search", { size: 20 })}</div>
                    <h3>${tr("Nenhuma OS encontrada")}</h3>
                    <p>${tr("Nada combina com a busca e os filtros atuais.")}</p>
                    <div class="btn-group"><button type="button" class="btn btn-secondary" data-action="clear">${tr("Limpar filtros")}</button></div>
                  </div></div>`}
            `
          : html`<div class="card"><div class="empty">
              <div class="empty-icon">${icon("orders", { size: 20 })}</div>
              <h3>${tr("Nenhuma ordem de serviço ainda")}</h3>
              <p>${tr("Registre a entrada de um equipamento para acompanhar a manutenção, gerar o relatório técnico e cobrar o serviço.")}</p>
              <div class="btn-group"><button type="button" class="btn btn-primary" data-action="new">${icon("plus", { size: 16 })}${tr("Criar primeira OS")}</button></div>
            </div></div>`}
      `
    );
  }

  /* ---------------------------------------------------------- ações */
  function setStatus(id, status) {
    const o = data.order(id);
    if (!o || o.status === status) return;
    data.saveOrder(withStatus(o, status));
    toast.success(tr("OS {n} → {s}", { n: o.number, s: STATUS[status].label }), {
      action: { label: tr("Desfazer"), run: () => data.saveOrder(withStatus(data.order(id), o.status)) },
    });
  }

  function statusMenu(trigger, id) {
    const o = data.order(id);
    openMenu(
      trigger,
      STATUSES.map((st) => ({ label: st.label, dot: st.id, checked: undefined, hint: st.hint, run: () => setStatus(id, st.id), disabled: st.id === o.status })),
      { label: tr("Mudar status"), minWidth: 230 }
    );
  }

  function exportCsv(list, name = tr("ordens-de-servico")) {
    const head = [tr("OS"), "Status", tr("Entrada"), tr("Previsão"), tr("Entrega"), tr("Cliente"), tr("Telefone"), tr("Tipo"), tr("Modelo"), tr("Fabricante"), tr("Problema"), tr("Serviços"), tr("Valor"), tr("Pagamento"), tr("Forma"), tr("FPS antes 0.20"), tr("FPS depois 0.20"), tr("FPS antes 0.28"), tr("FPS depois 0.28"), tr("FPS antes 0.32"), tr("FPS depois 0.32")];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = list.map((o) => [
      o.number,
      STATUS[o.status]?.label,
      date(o.receivedAt, ""),
      date(o.dueAt, ""),
      date(o.deliveredAt, ""),
      o.client?.name,
      o.client?.phone,
      trValue(o.equipment?.type),
      o.equipment?.model,
      o.equipment?.brand,
      o.problem,
      (o.items || []).map((i) => `${i.qty > 1 ? i.qty + "x " : ""}${i.description}`).join("; "),
      csvMoney(orderTotal(o)),
      isPaid(o) ? tr("Pago") : tr("Pendente"),
      trValue(o.payment?.method),
      o.fps?.before?.g20,
      o.fps?.after?.g20,
      o.fps?.before?.g28,
      o.fps?.after?.g28,
      o.fps?.before?.g32,
      o.fps?.after?.g32,
    ]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(csvDelimiter())).join("\r\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${name}_${todayISO()}.csv`);
    toast.success(tr("Planilha exportada"), { description: tr("{list} em CSV (abre no Excel e no Google Planilhas).", { list: plural(list.length, tr("ordem"), tr("ordens")) }) });
  }

  async function exportPdf(list) {
    const { exportOrdersList } = await import("../docs/list-doc.js");
    await exportOrdersList(list, { title: tr("Ordens de serviço"), filters: describeFilters(state()) });
  }

  function describeFilters(s) {
    const parts = [];
    if (s.status === "abertas") parts.push(tr("Em aberto"));
    else if (s.status) parts.push(STATUS[s.status]?.label);
    if (s.pay) parts.push(s.pay === "pago" ? tr("Pagas") : tr("A receber"));
    if (s.period) parts.push(PERIODS.find((p) => p.id === s.period)?.label);
    if (s.search) parts.push(tr("Busca: “{q}”", { q: s.search }));
    return parts.join(" · ");
  }

  function currentList() {
    const s = state();
    return sorted(s, filtered(s, data.orders()));
  }

  const off = [
    on(root, "input", "[data-search]", (event, input) => {
      limit = PAGE;
      setQuery({ q: input.value.trim() });
    }),
    on(root, "click", "[data-view]", (event, btn) => {
      storageSet("rz3:orders-view", btn.dataset.view);
      setQuery({ view: btn.dataset.view === "table" ? "" : btn.dataset.view });
    }),
    on(root, "click", "[data-status-filter]", (event, btn) => {
      limit = PAGE;
      setQuery({ status: btn.dataset.statusFilter });
    }),
    on(root, "click", "[data-sort]", (event, cell) => {
      const s = state();
      const key = cell.dataset.sort;
      setQuery({ sort: key === "number" ? "" : key, dir: s.sort === key ? (s.dir === "asc" ? "" : "asc") : key === "client" ? "asc" : "" });
    }),
    on(root, "change", "[data-action='report-filter']", (event, input) => setQuery({ relatorio: input.checked ? "1" : "" })),
    on(root, "change", "[data-action='select']", (event, input) => {
      if (input.checked) selected.add(input.dataset.id);
      else selected.delete(input.dataset.id);
      paint();
    }),
    on(root, "change", "[data-action='select-all']", (event, input) => {
      const shown = currentList().slice(0, limit);
      for (const o of shown) input.checked ? selected.add(o.id) : selected.delete(o.id);
      paint();
    }),
    on(root, "click", "[data-action]", async (event, btn) => {
      const action = btn.dataset.action;
      if (["select", "select-all", "report-filter"].includes(action)) return;
      event.stopPropagation();
      const id = btn.dataset.id;
      if (action === "new") openNewOrder();
      else if (action === "status") statusMenu(btn, id);
      else if (action === "row-menu") openMenu(btn, orderActions(data.order(id), { onChange: paint }), { align: "end", label: tr("Ações da OS") });
      else if (action === "more") {
        limit += PAGE;
        paint();
      } else if (action === "clear") {
        setQuery({ q: "", status: "", pay: "", period: "", relatorio: "" });
      } else if (action === "pay") {
        const s = state();
        openMenu(btn, [
          { label: tr("Todas"), checked: !s.pay, run: () => setQuery({ pay: "" }) },
          { label: tr("A receber"), checked: s.pay === "pendente", run: () => setQuery({ pay: "pendente" }) },
          { label: tr("Pagas"), checked: s.pay === "pago", run: () => setQuery({ pay: "pago" }) },
        ]);
      } else if (action === "period") {
        const s = state();
        openMenu(btn, PERIODS.map((p) => ({ label: p.label, checked: s.period === p.id, run: () => setQuery({ period: p.id }) })));
      } else if (action === "export") {
        const list = currentList();
        openMenu(
          btn,
          [
            { label: tr("Planilha CSV"), hint: tr("{list} da visão atual", { list: plural(list.length, tr("ordem"), tr("ordens")) }), icon: "table", run: () => exportCsv(list) },
            { label: tr("PDF da lista"), hint: tr("A4 paisagem, com totais"), icon: "filePdf", run: () => exportPdf(list) },
          ],
          { align: "end", minWidth: 250 }
        );
      } else if (action === "bulk-clear") {
        selected.clear();
        paint();
      } else if (action === "bulk-status") {
        openMenu(
          btn,
          STATUSES.map((st) => ({
            label: st.label,
            dot: st.id,
            run: () => {
              for (const sid of selected) {
                const o = data.order(sid);
                if (o) data.saveOrder(withStatus(o, st.id));
              }
              toast.success(tr("{list} para {s}", { list: plural(selected.size, tr("OS movida"), tr("OS movidas")), s: st.label }));
              selected.clear();
              paint();
            },
          }))
        );
      } else if (action === "bulk-paid") {
        for (const sid of selected) {
          const o = data.order(sid);
          if (o && !isPaid(o)) data.saveOrder({ ...o, payment: { ...o.payment, status: "pago", paidAt: o.payment?.paidAt || todayISO() } });
        }
        toast.success(plural(selected.size, tr("OS marcada como paga"), tr("OS marcadas como pagas")));
        selected.clear();
        paint();
      } else if (action === "bulk-csv") {
        exportCsv(currentList().filter((o) => selected.has(o.id)), tr("ordens-selecionadas"));
      } else if (action === "bulk-delete") {
        const count = selected.size;
        const ok = await confirm({ title: tr("Excluir {list}?", { list: plural(count, tr("ordem"), tr("ordens")) }), message: tr("As OS selecionadas, com relatórios e fotos, serão removidas. Um backup automático fica em dados/cloud/backups."), confirmLabel: tr("Excluir"), danger: true });
        if (!ok) return;
        const removed = [];
        for (const sid of selected) {
          const doc = store.remove("orders", sid);
          if (doc) removed.push(doc);
        }
        selected.clear();
        toast.success(`${plural(removed.length, tr("OS excluída"), tr("OS excluídas"))}`, { action: { label: tr("Desfazer"), run: () => removed.forEach((d) => store.restore("orders", d)) } });
      }
    }),
    on(root, "click", "[data-open]", (event, row) => {
      if (justDragged) return;
      if (event.target.closest("[data-stop], a, button, input, label")) return;
      ctx.navigate(`/ordens/${row.dataset.open}`);
    }),
    on(root, "keydown", ".kcard", (event, card) => {
      if (event.key === "Enter") ctx.navigate(`/ordens/${card.dataset.id}`);
    }),
  ];

  /* ------------------------------------------------- arrastar cartões */
  let drag = null;
  const onDown = (event) => {
    const card = event.target.closest?.(".kcard");
    if (!card || !root.contains(card) || event.button !== 0 || event.pointerType === "touch") return;
    if (event.target.closest("button, a, input")) return;
    drag = { id: card.dataset.id, card, x: event.clientX, y: event.clientY, started: false };
  };
  const onMove = (event) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      const rect = drag.card.getBoundingClientRect();
      drag.dx = event.clientX - rect.left;
      drag.dy = event.clientY - rect.top;
      drag.ghost = drag.card.cloneNode(true);
      drag.ghost.classList.add("kcard-ghost");
      drag.ghost.style.width = `${rect.width}px`;
      document.body.appendChild(drag.ghost);
      drag.card.classList.add("dragging");
      document.body.classList.add("is-dragging");
      drag.started = true;
    }
    drag.ghost.style.transform = `translate(${event.clientX - drag.dx}px, ${event.clientY - drag.dy}px) rotate(1.5deg)`;
    const col = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".kcol");
    root.querySelectorAll(".kcol.drop-target").forEach((c) => c !== col && c.classList.remove("drop-target"));
    if (col) col.classList.add("drop-target");
    drag.over = col?.dataset.col || null;
    const board = root.querySelector("[data-board]");
    if (board) {
      const b = board.getBoundingClientRect();
      if (event.clientX > b.right - 60) board.scrollLeft += 14;
      else if (event.clientX < b.left + 60) board.scrollLeft -= 14;
    }
  };
  const onUp = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    d.ghost.remove();
    d.card.classList.remove("dragging");
    document.body.classList.remove("is-dragging");
    root.querySelectorAll(".kcol.drop-target").forEach((c) => c.classList.remove("drop-target"));
    justDragged = true;
    setTimeout(() => (justDragged = false), 50);
    if (d.over) setStatus(d.id, d.over);
  };
  root.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  const unsubscribe = store.subscribe((change) => {
    if (drag?.started) return;
    if (!change || change.type === "reload" || change.coll === "orders" || change.colls?.includes("orders")) paint();
  });

  if (q.get("nova") === "1") {
    setQuery({ nova: "" });
    setTimeout(() => openNewOrder(), 0);
  }
  paint();

  return {
    onQuery(next) {
      q = next;
      if (q.get("nova") === "1") {
        setQuery({ nova: "" });
        openNewOrder();
        return;
      }
      paint();
    },
    unmount() {
      off.forEach((fn) => fn());
      unsubscribe();
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    },
  };
}
