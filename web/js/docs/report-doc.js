/* Relatório técnico (A4 paisagem) com a identidade escura/dourada da RZ. */
import { html, raw } from "../core/dom.js";
import * as data from "../core/data.js";
import { fileUrl } from "../core/api.js";
import { date, parseNumber, fps as fmtFps, todayISO } from "../core/format.js";
import { fpsGain, equipmentLabel } from "../core/model.js";
import { safeFileName } from "../core/util.js";
import { savePdf, printHtml } from "./pdf.js";

const ICONS = {
  os: '<path d="M9 4h6a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V5a1 1 0 0 1 1-1z"/><path d="M9 5h6v2H9z"/>',
  data: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  cliente: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><path d="M12 11v3"/>',
  armeiro: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  modelo: '<path d="M2 10h12l2-1.5h3l2 1.5h1v2h-2l-1 2h-2l-.5-2H11v3H8.5L8 12H2z"/>',
  gearbox: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  nozzle: '<path d="M3 9h11v6H3z"/><path d="M14 10.5h5l2 1.5-2 1.5h-5z"/>',
  motor: '<rect x="3" y="7" width="13" height="10" rx="1.5"/><path d="M16 10h3v4h-3z"/><path d="M6 4v3M11 4v3"/>',
  mola: '<path d="M3 12h2l2-4 3 8 3-8 3 8 2-4h3"/>',
  cilindro: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M19 9h2v6h-2zM7 7v10M11 7v10"/>',
  cano: '<path d="M2 10.5h18v3H2z"/><circle cx="20.5" cy="12" r="1.6"/>',
  bb: '<circle cx="8" cy="9" r="2.4"/><circle cx="15" cy="8" r="2.4"/><circle cx="11.5" cy="15" r="2.4"/>',
  obs: '<path d="M4 4h12l4 4v12H4z"/><path d="M15 4v5h5"/><path d="M7 12h9M7 15h9"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6a1 1 0 0 1 .8-.4h4a1 1 0 0 1 .8.4L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.4"/>',
};

const ic = (name) => raw(`<svg class="rd-ic" viewBox="0 0 24 24">${ICONS[name]}</svg>`);
const corners = raw('<span class="rd-corner tl"></span><span class="rd-corner tr"></span><span class="rd-corner bl"></span><span class="rd-corner br"></span>');

export function brandName(name) {
  const text = String(name || "RZ Airsoft").toUpperCase();
  if (text.startsWith("RZ")) return html`R<span>Z</span>${text.slice(2)}`;
  const [first, ...rest] = text.split(" ");
  return rest.length ? html`${first} <span>${rest.join(" ")}</span>` : html`${text}`;
}

/** Notas automáticas das medições com outras BBs (como na versão anterior). */
export function fpsNote(side) {
  const parts = [];
  if (side.g28 != null && side.g28 !== "") parts.push(`0.28g: ${fmtFps(side.g28)}`);
  if (side.g32 != null && side.g32 !== "") parts.push(`0.32g: ${fmtFps(side.g32)}`);
  return parts.join("  ·  ");
}

function padded(list, min) {
  const clean = (list || []).map((x) => String(x ?? "")).filter((x, i, arr) => x.trim() || i < arr.length);
  const filled = clean.filter((x) => x.trim());
  const out = [...filled];
  while (out.length < min) out.push("");
  return out;
}

export function reportHtml(order, { settings = data.settings(), client } = {}) {
  const r = order.report || {};
  const b = settings.business;
  const who = client || data.client(order.client?.id);
  const clientName = who?.name || order.client?.name || "";
  const technician = r.technician || order.technician || settings.orders.technician || "";
  const reportDate = date(r.date || order.deliveredAt || order.receivedAt || todayISO(), "");
  const model = [order.equipment?.model, order.equipment?.brand].filter(Boolean).join("  ·  ") || equipmentLabel(order.equipment);
  const before = parseNumber(order.fps?.before?.g20);
  const after = parseNumber(order.fps?.after?.g20);
  const gain = fpsGain(order);
  const photos = (r.photos || []).slice(0, 6);
  const beforeNote = r.fpsBeforeNote || fpsNote(order.fps?.before || {});
  const afterNote = r.fpsAfterNote || fpsNote(order.fps?.after || {});
  const gainText = gain == null ? "+00" : (gain < 0 ? "−" : "+") + String(Math.round(Math.abs(gain))).padStart(2, "0");
  const ident = [
    ["modelo", "Modelo", model],
    ["gearbox", "Gearbox", r.gearbox],
    ["nozzle", "Nozzle", r.nozzle],
    ["motor", "Motor", r.motor],
    ["mola", "Mola", r.mola],
    ["cilindro", "Cilindro", r.cilindro],
    ["cano", "Cano", r.cano],
    ["bb", "BB utilizada", r.bb],
  ];

  return html`<div class="doc-page landscape auto-height rd">
    <header class="rd-header">
      <div class="rd-brand">
        <img class="rd-logo" src="/assets/logo.png" alt="" />
        <div>
          <div class="rd-brand-name">${brandName(b.name)}</div>
          <div class="rd-brand-sub">— ${b.subtitle || "Manutenção de airsoft"} —</div>
          <div class="rd-brand-tag">${b.tagline || ""}</div>
        </div>
      </div>
      <div class="rd-title">
        <h1>${settings.report.title || "Relatório técnico"}</h1>
        <h2>${settings.report.subtitle || ""}</h2>
      </div>
      <div class="rd-os">
        <div class="rd-os-row">${ic("os")}<div class="rd-os-field"><span class="rd-label">Ordem de serviço</span><div class="rd-line">${order.number || ""}</div></div></div>
        <div class="rd-os-row">${ic("data")}<div class="rd-os-field"><span class="rd-label">Data</span><div class="rd-line">${reportDate}</div></div></div>
        <div class="rd-os-row">${ic("cliente")}<div class="rd-os-field"><span class="rd-label">Cliente</span><div class="rd-line">${clientName}</div></div></div>
        <div class="rd-os-row">${ic("armeiro")}<div class="rd-os-field"><span class="rd-label">Armeiro responsável</span><div class="rd-line">${technician}</div></div></div>
      </div>
    </header>

    <section class="rd-panel rd-ident">${corners}
      <div class="rd-head"><span class="num">1.</span> Identificação do equipamento</div>
      <div class="rd-ident-rows">
        ${ident.map(([key, label, value]) => html`<div class="rd-ident-row">${ic(key)}<span class="rd-ident-label">${label}</span><span class="rd-value">${value || ""}</span></div>`)}
      </div>
    </section>

    <section class="rd-panel rd-perf">${corners}
      <div class="rd-head"><span class="num">2.</span> Desempenho</div>
      <div class="rd-perf-grid">
        <div class="rd-card">
          <div class="rd-card-title">FPS antes</div>
          <div class="rd-fps-box">${before ?? ""}</div>
          <div class="rd-unit">@ 0.20g</div>
          <div class="rd-foot">${beforeNote}</div>
        </div>
        <div class="rd-card highlight">
          <div class="rd-card-title">FPS depois</div>
          <div class="rd-fps-box">${after ?? ""}</div>
          <div class="rd-unit">@ 0.20g</div>
          <div class="rd-foot">${afterNote}</div>
        </div>
        <div class="rd-card">
          <div class="rd-card-title">Ganho de performance</div>
          <div class="rd-gain">${gainText} <small>FPS</small></div>
          <div class="rd-foot">${r.gainNote || ""}</div>
        </div>
      </div>
      <div class="rd-obs">${ic("obs")}<div class="rd-obs-body"><div class="rd-obs-label">Observação:</div><div class="rd-text">${r.observation || ""}</div></div></div>
    </section>

    <section class="rd-panel rd-diag">${corners}
      <div class="rd-head"><span class="num">3.</span> Diagnóstico inicial</div>
      <div class="rd-list">${padded(r.diagnosis, 4).map((line) => html`<div class="rd-list-row"><span class="rd-bullet">►</span><div class="rd-box">${line}</div></div>`)}</div>
    </section>

    <section class="rd-panel rd-serv">${corners}
      <div class="rd-head"><span class="num">4.</span> Serviços realizados</div>
      <div class="rd-list">${padded(r.services, 4).map((line) => html`<div class="rd-list-row"><span class="rd-bullet check">✓</span><div class="rd-box">${line}</div></div>`)}</div>
    </section>

    <section class="rd-panel rd-photos">${corners}
      <div class="rd-head"><span class="num">5.</span> Registro fotográfico <em>– componentes originais (antes da manutenção)</em></div>
      <div class="rd-photo-grid" data-count="${photos.length || 1}">
        ${photos.length
          ? photos.map((id) => html`<div class="rd-photo" style="background-image:url('${fileUrl(id)}')"></div>`)
          : html`<div class="rd-photo empty">${ic("camera")}<span>Sem fotos</span></div>`}
      </div>
    </section>

    <section class="rd-panel rd-parecer">${corners}
      <div class="rd-head"><span class="num">6.</span> Parecer técnico</div>
      <div class="rd-text">${r.opinion || ""}</div>
    </section>

    <footer class="rd-footer">${settings.report.footer || ""}</footer>
  </div>`;
}

export function reportFileName(order) {
  const os = safeFileName(order.number, "");
  return os ? `OS-${os}_relatorio-tecnico_${todayISO()}.pdf` : `relatorio-tecnico_${todayISO()}.pdf`;
}

export async function exportReport(order, mode = "pdf") {
  const doc = reportHtml(order);
  if (mode === "print") {
    await printHtml(doc, { orientation: "landscape", title: reportFileName(order).replace(/\.pdf$/, ""), fit: true });
    return;
  }
  await savePdf(doc, { filename: reportFileName(order), orientation: "landscape", background: "#070b15", fitHeight: true, title: `Relatório técnico — OS ${order.number || ""}` });
}
