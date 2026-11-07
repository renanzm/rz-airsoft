/* Ordem de serviço / comprovante (A4 retrato, papel branco): itens, total, garantia e assinaturas. */
import { html } from "../core/dom.js";
import * as data from "../core/data.js";
import { STATUS, BB_WEIGHTS, PAYMENT_METHODS, orderTotal, subtotal, itemTotal, isPaid } from "../core/model.js";
import { money, date, phone as fmtPhone, todayISO, joules, parseNumber, decimal, decimal2 } from "../core/format.js";
import { safeFileName } from "../core/util.js";
import { brandName } from "./report-doc.js";
import { savePdf, printHtml, paginate } from "./pdf.js";
import { tr, trValue } from "../core/i18n.js";

const kv = (label, value) => html`<div class="pd-kv"><span>${label}</span><strong>${value || "—"}</strong></div>`;

export function orderSheetHtml(order) {
  const s = data.settings();
  const b = s.business;
  const client = data.client(order.client?.id);
  const name = client?.name || order.client?.name || "";
  const phone = client?.phone || order.client?.phone || "";
  const contact = [fmtPhone(b.phone), b.instagram, b.email, b.city].filter(Boolean).join("  ·  ");
  const hasFps = BB_WEIGHTS.some((w) => parseNumber(order.fps?.before?.[w.key]) != null || parseNumber(order.fps?.after?.[w.key]) != null);
  const method = PAYMENT_METHODS.find((m) => m.id === order.payment?.method)?.label;
  const days = order.warrantyDays ?? s.orders.warrantyDays;
  const terms = (s.orders.terms || "").replace(/\{(garantia|warranty)\}/g, days ? tr("{n} dias", { n: days }) : tr("garantia combinada"));

  return html`<div class="doc-page portrait pd" data-paginate>
    <header class="pd-head">
      <div class="pd-brand">
        <div class="pd-logo"><img src="/assets/logo.png" alt="" /></div>
        <div>
          <div class="pd-brand-name">${brandName(b.name)}</div>
          <div class="pd-brand-sub">${b.subtitle || ""}${b.document ? ` · ${b.document}` : ""}</div>
          ${contact ? html`<div class="pd-contact">${contact}</div>` : ""}
        </div>
      </div>
      <div class="pd-doc-title">
        <h1>${tr("Ordem de serviço")}</h1>
        <div class="pd-number">${tr("Nº {n}", { n: order.number || "—" })}</div>
        <p>${tr("Emitida em {date}", { date: date(todayISO()) })}</p>
      </div>
    </header>
    <div class="doc-flow" data-flow>
      <section class="pd-section" data-block>
        <h2 class="pd-section-title">${tr("Cliente")}</h2>
        <div class="pd-grid">
          ${kv(tr("Nome"), name)}
          ${kv(tr("Telefone"), fmtPhone(phone))}
          ${kv(tr("Contato"), client?.instagram || client?.email || "")}
          ${kv(tr("CPF"), client?.document || "")}
        </div>
      </section>
      <section class="pd-section" data-block>
        <h2 class="pd-section-title">${tr("Equipamento")}</h2>
        <div class="pd-grid">
          ${kv(tr("Tipo"), trValue(order.equipment?.type))}
          ${kv(tr("Modelo"), order.equipment?.model)}
          ${kv(tr("Fabricante"), order.equipment?.brand)}
          ${kv(tr("Nº de série"), order.equipment?.serial)}
        </div>
      </section>
      <section class="pd-section" data-block>
        <h2 class="pd-section-title">${tr("Andamento")}</h2>
        <div class="pd-grid">
          ${kv(tr("Entrada"), date(order.receivedAt, ""))}
          ${kv(tr("Previsão"), date(order.dueAt, ""))}
          ${kv(tr("Entrega"), date(order.deliveredAt, ""))}
          ${kv("Status", STATUS[order.status]?.label)}
        </div>
      </section>
      ${order.problem
        ? html`<section class="pd-section" data-block><h2 class="pd-section-title">${tr("Problema relatado")}</h2><div class="pd-box">${order.problem}</div></section>`
        : ""}
      <section class="pd-section" data-block>
        <h2 class="pd-section-title">${tr("Serviços e peças")}</h2>
        ${order.items?.length
          ? html`<table class="pd-table">
              <thead><tr><th>${tr("Descrição")}</th><th class="num">${tr("Qtd.")}</th><th class="num">${tr("Valor unit.")}</th><th class="num">Total</th></tr></thead>
              <tbody>${order.items.map((item, i) => html`<tr class="${i % 2 ? "zebra" : ""}"><td>${item.description || "—"}</td><td class="num">${decimal(item.qty || 0)}</td><td class="num">${money(item.price)}</td><td class="num">${money(itemTotal(item))}</td></tr>`)}</tbody>
            </table>
            <div class="pd-totals">
              <div><span>Subtotal</span><span>${money(subtotal(order))}</span></div>
              ${order.discount ? html`<div><span>${tr("Desconto")}</span><span>− ${money(order.discount)}</span></div>` : ""}
              <div class="grand"><span>Total</span><span>${money(orderTotal(order))}</span></div>
              <div><span>${tr("Pagamento")}</span><span>${isPaid(order) ? html`<span class="pd-badge ok">${tr("Pago")}${method ? ` · ${method}` : ""}${order.payment?.paidAt ? ` · ${date(order.payment.paidAt)}` : ""}</span>` : html`<span class="pd-badge warn">${tr("A receber")}</span>`}</span></div>
            </div>`
          : html`<div class="pd-box pd-muted">${tr("Serviços a definir após o diagnóstico.")}</div>`}
      </section>
      ${hasFps
        ? html`<section class="pd-section" data-block>
            <h2 class="pd-section-title">${tr("Desempenho medido (FPS)")}</h2>
            <table class="pd-table">
              <thead><tr><th></th>${BB_WEIGHTS.map((w) => html`<th class="num">BB ${w.label}</th>`)}</tr></thead>
              <tbody>
                <tr><td>${tr("Antes")}</td>${BB_WEIGHTS.map((w) => html`<td class="num">${order.fps.before[w.key] ?? "—"}</td>`)}</tr>
                <tr class="zebra"><td>${tr("Depois")}</td>${BB_WEIGHTS.map((w) => html`<td class="num">${order.fps.after[w.key] ?? "—"}</td>`)}</tr>
                <tr><td>${tr("Energia (depois)")}</td>${BB_WEIGHTS.map((w) => {
                  const j = joules(parseNumber(order.fps.after[w.key]), w.grams);
                  return html`<td class="num">${j ? `${decimal2(j)} J` : "—"}</td>`;
                })}</tr>
              </tbody>
            </table>
          </section>`
        : ""}
      ${terms
        ? html`<section class="pd-section" data-block><h2 class="pd-section-title">${tr("Garantia e condições")}</h2><p class="pd-terms">${terms}</p></section>`
        : ""}
      <div class="pd-sign" data-block><div>${name || tr("Cliente")}</div><div>${order.technician || s.orders.technician || tr("Técnico responsável")}</div></div>
    </div>
    <footer class="pd-foot"><span>${b.name} — ${b.tagline || ""}</span><span data-page-num></span></footer>
  </div>`;
}

export function orderSheetFileName(order) {
  const os = safeFileName(order.number, "");
  return `${os ? `${tr("OS")}-${os}` : tr("OS")}_${tr("ordem-de-servico")}_${todayISO()}.pdf`;
}

export async function exportOrderSheet(order, mode = "pdf") {
  const doc = orderSheetHtml(order);
  if (mode === "print") {
    await printHtml(doc, { orientation: "portrait", title: orderSheetFileName(order).replace(/\.pdf$/, ""), build: (body) => paginate(body) });
    return;
  }
  await savePdf(doc, { filename: orderSheetFileName(order), orientation: "portrait", background: "#ffffff", title: tr("Ordem de serviço {n}", { n: order.number || "" }), build: (el) => paginate(el) });
}
