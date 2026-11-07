/* Lista de ordens de serviço (A4 paisagem, papel branco), paginada com cabeçalho repetido. */
import { html } from "../core/dom.js";
import * as data from "../core/data.js";
import { STATUS, orderTotal, isPaid, equipmentLabel } from "../core/model.js";
import { money, date, plural, todayISO } from "../core/format.js";
import { brandName } from "./report-doc.js";
import { savePdf, paginate } from "./pdf.js";
import { tr, trValue } from "../core/i18n.js";

export function ordersListHtml(list, { title = tr("Ordens de serviço"), filters = "" } = {}) {
  const s = data.settings();
  const total = list.reduce((acc, o) => acc + orderTotal(o), 0);
  const paid = list.filter(isPaid).reduce((acc, o) => acc + orderTotal(o), 0);
  return html`<div class="doc-page landscape pd" data-paginate>
    <header class="pd-head">
      <div class="pd-brand">
        <div class="pd-logo"><img src="/assets/logo.png" alt="" /></div>
        <div><div class="pd-brand-name">${brandName(s.business.name)}</div><div class="pd-brand-sub">${s.business.subtitle || ""}</div></div>
      </div>
      <div class="pd-doc-title"><h1>${title}</h1><p>${filters ? `${filters} · ` : ""}${tr("Emitida em {date}", { date: date(todayISO()) })}</p></div>
    </header>
    <div class="pd-stats" data-first-only>
      <div class="pd-stat"><span>${tr("Ordens")}</span><strong>${list.length}</strong></div>
      <div class="pd-stat"><span>${tr("Valor total")}</span><strong>${money(total)}</strong></div>
      <div class="pd-stat"><span>${tr("Recebido")}</span><strong>${money(paid)}</strong></div>
      <div class="pd-stat"><span>${tr("A receber")}</span><strong>${money(total - paid)}</strong></div>
    </div>
    <div class="doc-flow" style="margin-top:14px">
      <table class="pd-table">
        <thead><tr><th>${tr("OS")}</th><th>Status</th><th>${tr("Entrada")}</th><th>${tr("Cliente")}</th><th>${tr("Equipamento")}</th><th>${tr("Problema / serviços")}</th><th class="num">${tr("Valor")}</th><th>${tr("Pagamento")}</th></tr></thead>
        <tbody data-flow>
          ${list.map((o, i) => html`<tr class="${i % 2 ? "zebra" : ""}">
            <td><strong>${o.number || "—"}</strong></td>
            <td>${STATUS[o.status]?.label || ""}</td>
            <td>${date(o.receivedAt, "")}</td>
            <td>${o.client?.name || ""}</td>
            <td>${equipmentLabel(o.equipment) || trValue(o.equipment?.type) || ""}</td>
            <td>${[o.problem, (o.items || []).map((it) => it.description).filter(Boolean).join(", ")].filter(Boolean).join(" — ").slice(0, 140)}</td>
            <td class="num">${orderTotal(o) ? money(orderTotal(o)) : "—"}</td>
            <td>${orderTotal(o) ? (isPaid(o) ? html`<span class="pd-badge ok">${tr("Pago")}</span>` : html`<span class="pd-badge warn">${tr("A receber")}</span>`) : ""}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <footer class="pd-foot"><span>${plural(list.length, tr("ordem"), tr("ordens"))} · ${s.business.name}</span><span data-page-num></span></footer>
  </div>`;
}

export async function exportOrdersList(list, options = {}) {
  const doc = ordersListHtml(list, options);
  await savePdf(doc, { filename: `${tr("ordens-de-servico")}_${todayISO()}.pdf`, orientation: "landscape", background: "#ffffff", title: options.title || tr("Ordens de serviço"), build: (el) => paginate(el) });
}
