/* Geração de PDF (html2canvas + jsPDF, locais) e impressão em iframe. */
import { loadScript, downloadBlob, sleep } from "../core/util.js";
import { toast } from "../ui/toast.js";
import { tr, locale } from "../core/i18n.js";

const PAGE = {
  landscape: { w: 1122, h: 793, mm: [297, 210] },
  portrait: { w: 793, h: 1122, mm: [210, 297] },
};

async function libs() {
  await Promise.all([loadScript("/vendor/html2canvas.min.js"), loadScript("/vendor/jspdf.umd.min.js")]);
  if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error(tr("As bibliotecas de PDF não carregaram."));
}

async function fontsReady() {
  if (!document.fonts) return;
  const faces = ['700 20px "Oswald"', '600 20px "Oswald"', '500 20px "Oswald"', '300 20px "Oswald"', '600 14px "Rajdhani"', '700 14px "Rajdhani"', '400 12px "Inter"', '600 12px "Inter"', '700 12px "Inter"'];
  try {
    await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f))), sleep(2500)]);
    await document.fonts.ready;
  } catch {
    /* segue com as fontes do sistema */
  }
}

async function imagesReady(root) {
  const urls = new Set();
  root.querySelectorAll("img").forEach((img) => urls.add(img.currentSrc || img.src));
  root.querySelectorAll("[style*='background-image']").forEach((el) => {
    const match = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage);
    if (match) urls.add(match[1]);
  });
  await Promise.race([
    Promise.all(
      [...urls].filter(Boolean).map(
        (src) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = img.onerror = () => resolve();
            img.src = src;
            if (img.decode) img.decode().then(resolve, resolve);
          })
      )
    ),
    sleep(8000),
  ]);
}

/** Monta as páginas fora da tela e devolve { stage, pages, cleanup }. */
export function stage(html) {
  const el = document.createElement("div");
  el.className = "doc-stage";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = String(html);
  document.body.appendChild(el);
  return { el, pages: Array.from(el.querySelectorAll(".doc-page")), cleanup: () => el.remove() };
}

/**
 * Gera e baixa o PDF. `build(stageEl)` pode paginar o conteúdo depois de montado.
 * pages: string HTML com um ou mais .doc-page (landscape|portrait).
 */
export async function savePdf(html, { filename, orientation = "landscape", title = "", fitHeight = false, background = "#ffffff", build } = {}) {
  const progress = toast.loading(tr("Gerando PDF…"));
  const s = stage(html);
  try {
    await libs();
    await fontsReady();
    if (build) await build(s.el);
    const pages = Array.from(s.el.querySelectorAll(".doc-page"));
    await imagesReady(s.el);
    const size = PAGE[orientation];
    const pdf = new window.jspdf.jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title: title || filename, author: "RZ Airsoft", creator: tr("RZ Airsoft — gestão da oficina") });
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      if (pages.length > 1) progress.update(tr("Gerando PDF… página {page} de {pages}", { page: i + 1, pages: pages.length }), "loading");
      const width = page.offsetWidth;
      const height = page.offsetHeight;
      const canvas = await window.html2canvas(page, {
        scale: 2,
        backgroundColor: background,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: 0,
        onclone: (doc) => {
          const clone = doc.querySelector(".doc-stage");
          if (clone) {
            clone.style.left = "0px";
            clone.style.top = "0px";
          }
        },
      });
      if (i > 0) pdf.addPage("a4", orientation);
      const [pw, ph] = size.mm;
      pdf.setFillColor(background);
      pdf.rect(0, 0, pw, ph, "F");
      let w = pw;
      let h = (height / width) * pw;
      if (fitHeight && h > ph) {
        h = ph;
        w = (width / height) * ph;
      }
      const x = (pw - w) / 2;
      const y = fitHeight ? (ph - h) / 2 : 0;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", x, y, w, h, undefined, "FAST");
    }
    const blob = pdf.output("blob");
    downloadBlob(blob, filename);
    progress.update(tr("PDF baixado"), "success", filename);
  } catch (error) {
    console.error(error);
    progress.update(tr("Não foi possível gerar o PDF"), "error", error?.message || "");
  } finally {
    s.cleanup();
  }
}

/** Abre a impressão do navegador só com o documento (qualidade vetorial). */
export async function printHtml(html, { orientation = "landscape", title = tr("Documento"), build, fit = false } = {}) {
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const fonts = document.querySelector('link[href*="fonts.googleapis.com"]')?.href || "";
  doc.open();
  doc.write(`<!doctype html><html lang="${locale()}"><head><meta charset="utf-8"><title>${title.replace(/</g, "")}</title>
    ${fonts ? `<link rel="stylesheet" href="${fonts}">` : ""}
    <link rel="stylesheet" href="/css/documents.css">
    <style>@page{size:A4 ${orientation};margin:0}html,body{margin:0;padding:0;background:#fff}</style>
    </head><body>${html}</body></html>`);
  doc.close();
  try {
    await new Promise((resolve) => {
      if (doc.readyState === "complete") resolve();
      else frame.addEventListener("load", resolve, { once: true });
      setTimeout(resolve, 2500);
    });
    if (doc.fonts) await Promise.race([doc.fonts.ready, sleep(2500)]);
    if (build) await build(doc.body);
    await imagesReady(doc.body);
    if (fit) {
      const size = PAGE[orientation];
      doc.querySelectorAll(".doc-page.auto-height").forEach((page) => {
        const h = page.scrollHeight;
        if (h > size.h) page.style.zoom = String(size.h / h);
      });
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } finally {
    setTimeout(() => frame.remove(), 60000);
  }
}

/**
 * Paginação simples: distribui os blocos [data-block] de um .doc-page modelo
 * em quantas páginas forem necessárias, repetindo cabeçalho e rodapé.
 */
export function paginate(root) {
  const template = root.querySelector(".doc-page[data-paginate]");
  if (!template) return;
  const body = template.querySelector("[data-flow]");
  const blocks = Array.from(body.children);
  body.innerHTML = "";
  let page = template;
  let flow = body;
  // A área útil é o .doc-flow (flex: 1, overflow: hidden): o bloco cabe se o fim dele
  // não passa do fim dessa área. Funciona também quando o fluxo é um <tbody>.
  const fits = () => {
    const area = flow.closest(".doc-flow") || flow;
    const last = flow.lastElementChild;
    if (!last) return true;
    return last.getBoundingClientRect().bottom <= area.getBoundingClientRect().bottom + 0.5;
  };
  for (const block of blocks) {
    flow.appendChild(block);
    if (!fits() && flow.children.length > 1) {
      flow.removeChild(block);
      const next = template.cloneNode(true);
      next.querySelectorAll("[data-first-only]").forEach((el) => el.remove());
      const nextFlow = next.querySelector("[data-flow]");
      nextFlow.innerHTML = "";
      page.after(next);
      page = next;
      flow = nextFlow;
      flow.appendChild(block);
    }
  }
  const pages = Array.from(root.querySelectorAll(".doc-page[data-paginate]"));
  pages.forEach((p, i) => {
    p.querySelectorAll("[data-page-num]").forEach((el) => (el.textContent = tr("Página {page} de {pages}", { page: i + 1, pages: pages.length })));
  });
}
