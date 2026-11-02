/* Tabela de serviços e preços (A4 retrato, identidade escura/dourada), paginada. */
import { html } from "../core/dom.js";
import * as data from "../core/data.js";
import { money, phone as fmtPhone, todayISO } from "../core/format.js";
import { brandName } from "./report-doc.js";
import { savePdf, printHtml, paginate } from "./pdf.js";

export function catalogHtml() {
  const c = data.catalog();
  const s = data.settings();
  const contact = c.meta.contact || fmtPhone(s.business.phone) || "";
  return html`<div class="doc-page portrait cd" data-paginate>
    <header class="cd-head" data-first-only>
      <div class="cd-brand">
        <img src="/assets/logo.png" alt="" />
        <div>
          <div class="cd-brand-name">${brandName(s.business.name)}</div>
          <div class="cd-brand-sub">${s.business.subtitle || ""}</div>
        </div>
      </div>
      <div class="cd-title"><h1>${c.meta.title || "Serviços e preços"}</h1><h2>${c.meta.subtitle || ""}</h2></div>
    </header>
    ${c.meta.intro || contact || c.meta.note
      ? html`<div class="cd-intro" data-first-only>
          <div class="cd-intro-box"><span class="cd-label">Apresentação</span><p>${c.meta.intro || ""}</p></div>
          <div class="cd-intro-box"><span class="cd-label">Contato</span><p>${contact}</p>${c.meta.note ? html`<span class="cd-label" style="margin-top:8px">Observação</span><p style="font-size:12.5px">${c.meta.note}</p>` : ""}</div>
        </div>`
      : ""}
    <div class="doc-flow" data-flow>
      ${c.categories.map((cat, ci) => html`
        <div class="cd-category-head cd-category" data-block>
          <span class="cd-category-num">${String(ci + 1).padStart(2, "0")}</span>
          <span class="cd-category-name">${cat.name}</span>
          <span class="cd-category-line"></span>
        </div>
        ${cat.items.filter((i) => (i.name || "").trim()).map((item) => html`<div class="cd-item" data-block>
          <div><div class="cd-item-name">${item.name}</div>${item.description ? html`<div class="cd-item-desc">${item.description}</div>` : ""}</div>
          <div class="cd-item-unit">${item.unit || ""}</div>
          <div class="cd-item-price${item.price ? "" : " consult"}">${item.price ? money(item.price) : "Sob consulta"}</div>
        </div>`)}
      `)}
    </div>
    <footer class="cd-foot"><span>${c.meta.footer || s.business.tagline || ""}</span><strong data-page-num></strong></footer>
  </div>`;
}

export async function exportCatalog(mode = "pdf") {
  const doc = catalogHtml();
  if (mode === "print") {
    await printHtml(doc, { orientation: "portrait", title: "servicos-e-precos", build: (body) => paginate(body) });
    return;
  }
  await savePdf(doc, { filename: `servicos-e-precos_${todayISO()}.pdf`, orientation: "portrait", background: "#070b15", title: "Serviços e preços", build: (stageEl) => paginate(stageEl) });
}
