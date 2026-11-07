/* Banner publicitário 1080×1350 (4:5): PDF 200×250 mm e PNG para redes sociais. */
import { html } from "../core/dom.js";
import * as data from "../core/data.js";
import { phone as fmtPhone, todayISO } from "../core/format.js";
import { downloadBlob, loadScript, sleep } from "../core/util.js";
import { toast } from "../ui/toast.js";
import { stage } from "./pdf.js";
import { tr, localizeDefault } from "../core/i18n.js";

export const DEFAULT_BANNER = {
  eyebrow: tr("Serviço especializado"),
  headline: tr("Serviço técnico\npara sua"),
  highlight: "AEG",
  services: [
    { title: tr("Revisão completa"), copy: tr("Sistema interno e externo • Hop-up e cano") },
    { title: tr("Troca de peças"), copy: tr("Motor, Bucking, Air Nozzle, Nub, Engrenagens, Contato de Gatilho, Fiação e Mais") },
    { title: tr("Consultoria"), copy: tr("Sobre peças internas e externas, upgrades. Loadout, Fones, Coletes e Importação") },
    { title: tr("Manutenção em AEG"), copy: tr("Revisão, Limpeza e Correção de Problemas") },
    { title: tr("Carregadores GBB"), copy: tr("Troca de O-rings") },
  ],
  connectors: true,
  connectorTitle: tr("Troca de conectores"),
  connectorCopy: tr("Principais modelos do mercado"),
  cta: tr("Solicite seu orçamento"),
  phone: "",
  handle: "",
  footer: tr("RZ Airsoft / Manutenção com precisão e compromisso"),
};

/* Textos padrão do banner em português: acompanham o idioma enquanto ninguém os editar. */
export const BANNER_TEXTS = {
  eyebrow: "Serviço especializado",
  headline: "Serviço técnico\npara sua",
  connectorTitle: "Troca de conectores",
  connectorCopy: "Principais modelos do mercado",
  cta: "Solicite seu orçamento",
  footer: "RZ Airsoft / Manutenção com precisão e compromisso",
};
export const BANNER_SERVICES = [
  ["Revisão completa", "Sistema interno e externo • Hop-up e cano"],
  ["Troca de peças", "Motor, Bucking, Air Nozzle, Nub, Engrenagens, Contato de Gatilho, Fiação e Mais"],
  ["Consultoria", "Sobre peças internas e externas, upgrades. Loadout, Fones, Coletes e Importação"],
  ["Manutenção em AEG", "Revisão, Limpeza e Correção de Problemas"],
  ["Carregadores GBB", "Troca de O-rings"],
];

export function bannerConfig() {
  const s = data.settings();
  const saved = s.marketing?.banner || {};
  const services = Array.isArray(saved.services) && saved.services.length ? saved.services : DEFAULT_BANNER.services;
  return {
    ...DEFAULT_BANNER,
    ...Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, key in BANNER_TEXTS ? localizeDefault(value, BANNER_TEXTS[key]) : value])),
    services: services.map((svc, i) => ({ ...svc, title: localizeDefault(svc.title, BANNER_SERVICES[i]?.[0] ?? []), copy: localizeDefault(svc.copy, BANNER_SERVICES[i]?.[1] ?? []) })),
    phone: saved.phone || s.business.phone || "",
    handle: saved.handle ?? s.business.instagram ?? "",
  };
}

let darkMark = "";
/** A marca preta da faixa de contato: o html2canvas não aplica CSS filter. */
async function darkLogo() {
  if (darkMark) return darkMark;
  const img = new Image();
  img.src = "/assets/logo.png";
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#191200";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  darkMark = canvas.toDataURL("image/png");
  return darkMark;
}

export function bannerHtml(config = bannerConfig(), { mark = darkMark } = {}) {
  const lines = String(config.headline || "").split("\n");
  const s = data.settings();
  return html`<div class="doc-page banner bn">
    <div class="bn-grid"></div><div class="bn-grid-fade"></div><div class="bn-frame"></div>
    <img class="bn-watermark" src="/assets/logo.png" alt="" />
    <span class="bn-side">AIRSOFT / SERVICE / RZ</span>
    <header class="bn-top">
      <img class="bn-logo" src="/assets/logo.png" alt="" />
      <div class="bn-meta"><div class="bn-kicker">${s.business.subtitle || tr("Manutenção de airsoft")}</div><div class="bn-signature">${s.business.tagline || ""}</div></div>
    </header>
    <section class="bn-hero">
      <span class="bn-hero-code">RZ / 01</span>
      <p class="bn-eyebrow">${config.eyebrow}</p>
      <h1>${lines.map((line, i) => html`${i ? html`<br />` : ""}${line}`)}${config.highlight ? html` <span>${config.highlight}</span>` : ""}</h1>
    </section>
    <section class="bn-services">
      <div class="bn-label">${tr("Serviços")}</div>
      <div class="bn-cards">
        ${config.services.slice(0, 5).map((svc, i) => html`<article class="bn-card${i === 0 ? " featured" : ""}"><div class="bn-num">${String(i + 1).padStart(2, "0")}</div><h2>${svc.title}</h2><p>${svc.copy}</p></article>`)}
      </div>
    </section>
    ${config.connectors
      ? html`<section class="bn-connector">
          <div class="bn-connector-copy"><div class="bn-connector-index">${tr("CONEXÃO")}</div><h2>${config.connectorTitle}</h2><p>${config.connectorCopy}</p></div>
          <div class="bn-types">
            <div class="bn-type"><img src="/assets/connector-xt60.svg" alt="" /><span>XT60</span></div>
            <div class="bn-type"><img src="/assets/connector-tdeans.svg" alt="" /><span>T-DEANS</span></div>
          </div>
        </section>`
      : ""}
    <section class="bn-contact">
      <div><div class="bn-contact-label">${config.cta}</div><div class="bn-phone">${fmtPhone(config.phone) || "(00) 00000-0000"}</div>${config.handle ? html`<div class="bn-handle">${config.handle}</div>` : ""}</div>
      ${mark ? html`<img class="bn-mark" src="${mark}" alt="" />` : ""}
    </section>
    <div class="bn-footer">${config.footer}</div>
  </div>`;
}

async function renderCanvas(scale) {
  await loadScript("/vendor/html2canvas.min.js");
  const mark = await darkLogo().catch(() => "");
  if (document.fonts) await Promise.race([document.fonts.ready, sleep(2500)]);
  const s = stage(bannerHtml(bannerConfig(), { mark }));
  try {
    const page = s.pages[0];
    await Promise.all(Array.from(page.querySelectorAll("img")).map((img) => (img.complete ? null : img.decode().catch(() => null))));
    return await window.html2canvas(page, {
      scale,
      width: 1080,
      height: 1350,
      windowWidth: 1080,
      windowHeight: 1350,
      backgroundColor: "#05070f",
      useCORS: true,
      logging: false,
      onclone: (doc) => {
        const clone = doc.querySelector(".doc-stage");
        if (clone) clone.style.left = "0px";
      },
    });
  } finally {
    s.cleanup();
  }
}

export async function exportBanner(kind = "pdf") {
  const progress = toast.loading(kind === "png" ? tr("Gerando imagem…") : tr("Gerando PDF do banner…"));
  try {
    if (kind === "png") {
      const canvas = await renderCanvas(1);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      downloadBlob(blob, `banner-rz-airsoft_${todayISO()}.png`);
      progress.update(tr("Imagem baixada"), "success", tr("1080 × 1350 px, pronta para o Instagram"));
      return;
    }
    await loadScript("/vendor/jspdf.umd.min.js");
    const canvas = await renderCanvas(2);
    const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: [200, 250], compress: true });
    pdf.setProperties({ title: "Banner RZ Airsoft", author: "RZ Airsoft" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 200, 250, undefined, "FAST");
    downloadBlob(pdf.output("blob"), `banner-rz-airsoft_${todayISO()}.pdf`);
    progress.update(tr("PDF do banner baixado"), "success", "200 × 250 mm (4:5)");
  } catch (error) {
    console.error(error);
    progress.update(tr("Não foi possível gerar o banner"), "error", error?.message || "");
  }
}

export async function prepareBannerMark() {
  return darkLogo().catch(() => "");
}
