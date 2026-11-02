/* Editor do relatório técnico: formulário à esquerda, prévia A4 ao vivo à direita. */
import { html, render, on } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { fileUrl } from "../core/api.js";
import { REPORT_FIELDS, fpsGain, equipmentLabel } from "../core/model.js";
import { parseNumber, signed } from "../core/format.js";
import { debounce, storageGet, storageSet } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { confirm } from "../ui/dialog.js";
import { reportHtml, fpsNote } from "../docs/report-doc.js";
import { exportReport } from "../docs/report-doc.js";
import { prepareImage } from "./images.js";

const MAX_PHOTOS = 6;
const SUGGESTIONS = {
  diagnosis: ["Baixo FPS", "Nozzle quebrado", "Vazamento de ar no cilindro", "Engrenagens com desgaste", "Mola cansada", "Contatos do gatilho oxidados", "Hop-up desregulado", "Bucking ressecado"],
  services: ["Limpeza e lubrificação da gearbox", "Troca de nozzle", "Troca de mola", "Calço das engrenagens (shimming)", "Ajuste de AOE", "Troca de bucking", "Limpeza do cano", "Troca de conector para T-Dean", "Instalação de MOSFET"],
};

export function mountReport(el, { getOrder, commit }) {
  let uploads = 0;
  let previewOpen = storageGet("rz3:report-preview", true);
  const order = () => getOrder();

  el.innerHTML = String(html`<div class="report-editor${previewOpen ? "" : " no-preview"}" data-editor>
    <div class="report-form" data-form></div>
    <aside class="report-preview" aria-label="Prévia do relatório">
      <div class="preview-bar">
        <span class="preview-title">${icon("eye", { size: 15 })}Prévia do PDF</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="print">${icon("printer", { size: 15 })}Imprimir</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="pdf">${icon("download", { size: 15 })}Baixar PDF</button>
      </div>
      <div class="preview-viewport" data-viewport><div class="preview-scale" data-scale><div class="preview-doc" data-doc></div></div></div>
      <p class="hint preview-hint">A prévia usa as mesmas medidas do PDF (A4 paisagem). Fotos e textos longos se ajustam ao gerar.</p>
    </aside>
  </div>`);
  const formEl = el.querySelector("[data-form]");
  const docEl = el.querySelector("[data-doc]");
  const scaleEl = el.querySelector("[data-scale]");
  const viewport = el.querySelector("[data-viewport]");
  const editor = el.querySelector("[data-editor]");

  const update = (changes, options = { debounce: 600 }) => {
    const o = order();
    commit({ ...o, report: { ...o.report, ...changes } }, options);
  };

  /* --------------------------------------------------------- partes */
  function listEditor(kind, title, number, placeholder) {
    const rows = order().report[kind];
    const items = rows.length ? rows : [""];
    return html`<section class="card" data-list="${kind}">
      <header class="card-head"><div><h2 class="card-title"><span class="step-num">${number}</span>${title}</h2></div>
        <button type="button" class="btn btn-ghost btn-sm card-head-action" data-suggest="${kind}" aria-haspopup="menu">${icon("sparkle", { size: 14 })}Sugestões</button>
      </header>
      <div class="card-body">
        <ul class="line-list">
          ${items.map((value, index) => html`<li class="line-item" data-key="${kind}-${index}">
            <span class="line-bullet${kind === "services" ? " check" : ""}">${kind === "services" ? "✓" : "►"}</span>
            <input class="input" data-line="${kind}" data-index="${index}" value="${value}" placeholder="${index === 0 ? placeholder : ""}" aria-label="${title} — linha ${index + 1}" />
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove-line="${kind}" data-index="${index}" aria-label="Remover linha" ${items.length === 1 && !value ? "disabled" : ""}>${icon("x", { size: 14 })}</button>
          </li>`)}
        </ul>
        <div class="row mt-sm">
          <button type="button" class="btn btn-ghost btn-sm" data-add-line="${kind}">${icon("plus", { size: 14 })}Adicionar linha</button>
          ${kind === "services" && order().items.length ? html`<button type="button" class="btn btn-ghost btn-sm" data-import-items>${icon("download", { size: 14 })}Trazer itens da OS</button>` : ""}
          <span class="hint spacer-left">Enter cria a próxima linha</span>
        </div>
      </div>
    </section>`;
  }

  function photosCard() {
    const photos = order().report.photos;
    return html`<section class="card">
      <header class="card-head"><div><h2 class="card-title"><span class="step-num">5</span>Registro fotográfico</h2><p class="card-desc">Componentes originais, antes da manutenção. Até ${MAX_PHOTOS} fotos; o layout do PDF se ajusta à quantidade.</p></div>
        <span class="badge">${photos.length}/${MAX_PHOTOS}</span></header>
      <div class="card-body stack">
        ${photos.length
          ? html`<div class="photo-strip">${photos.map(
              (id, index) => html`<figure class="photo-thumb" data-key="${id}">
                <img src="${fileUrl(id)}" alt="Foto ${index + 1}" loading="lazy" />
                <figcaption>
                  <button type="button" class="btn btn-secondary btn-icon btn-xs" data-move-photo="-1" data-index="${index}" aria-label="Mover para a esquerda" ${index === 0 ? "disabled" : ""}>${icon("chevronLeft", { size: 13 })}</button>
                  <span>${index + 1}</span>
                  <button type="button" class="btn btn-secondary btn-icon btn-xs" data-move-photo="1" data-index="${index}" aria-label="Mover para a direita" ${index === photos.length - 1 ? "disabled" : ""}>${icon("chevronRight", { size: 13 })}</button>
                  <button type="button" class="btn btn-danger-ghost btn-icon btn-xs" data-remove-photo="${index}" aria-label="Remover foto ${index + 1}">${icon("trash", { size: 13 })}</button>
                </figcaption>
              </figure>`
            )}</div>`
          : ""}
        ${photos.length < MAX_PHOTOS
          ? html`<label class="dropzone" data-drop>
              <input type="file" accept="image/*" multiple hidden data-photo-input />
              ${uploads ? html`${icon("loader", { size: 22, className: "spin" })}<strong>Enviando ${uploads} foto${uploads > 1 ? "s" : ""}…</strong>` : html`${icon("camera", { size: 22 })}<strong>Adicionar fotos</strong><span class="hint">Arraste aqui ou clique. No celular, abre a câmera. As fotos são reduzidas antes do envio.</span>`}
            </label>`
          : ""}
      </div>
    </section>`;
  }

  function formHtml() {
    const o = order();
    const r = o.report;
    const settings = data.settings();
    const gain = fpsGain(o);
    return html`
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">Cabeçalho</h2><p class="card-desc">OS ${o.number || "—"} · ${o.client?.name || "sem cliente"}. Esses dados vêm da OS.</p></div></header>
        <div class="card-body">
          <div class="form-grid cols-2">
            <label class="field"><span class="label">Data do relatório</span><input class="input" type="date" data-r="date" value="${r.date || o.deliveredAt || o.receivedAt}" /></label>
            <label class="field"><span class="label">Armeiro responsável</span><input class="input" data-r="technician" value="${r.technician || o.technician || settings.orders.technician}" placeholder="Seu nome" /></label>
          </div>
        </div>
      </section>

      <section class="card">
        <header class="card-head"><div><h2 class="card-title"><span class="step-num">1</span>Identificação do equipamento</h2><p class="card-desc">${equipmentLabel(o.equipment) || "Modelo não informado na OS"}</p></div></header>
        <div class="card-body">
          <div class="form-grid cols-2">
            <label class="field"><span class="label">Modelo</span><input class="input" data-o="equipment.model" value="${o.equipment.model}" placeholder="M4, AK…" /></label>
            <label class="field"><span class="label">Fabricante</span><input class="input" data-o="equipment.brand" value="${o.equipment.brand}" placeholder="G&G, Cyma…" /></label>
            ${REPORT_FIELDS.map((f) => html`<label class="field"><span class="label">${icon(f.icon, { size: 13 })}${f.label}</span><input class="input" data-r="${f.key}" value="${r[f.key]}" /></label>`)}
          </div>
        </div>
      </section>

      <section class="card">
        <header class="card-head"><div><h2 class="card-title"><span class="step-num">2</span>Desempenho</h2><p class="card-desc">FPS com BB 0.20g. As medições com 0.28g e 0.32g da OS entram como nota.</p></div>
          ${gain != null ? html`<span class="gain-pill ${gain >= 0 ? "up" : "down"}">${signed(gain, " FPS")}</span>` : ""}</header>
        <div class="card-body stack">
          <div class="form-grid cols-2">
            <label class="field"><span class="label">FPS antes (0.20g)</span><input class="input input-number" data-fps="before" inputmode="decimal" value="${o.fps.before.g20 ?? ""}" placeholder="—" /></label>
            <label class="field"><span class="label">FPS depois (0.20g)</span><input class="input input-number" data-fps="after" inputmode="decimal" value="${o.fps.after.g20 ?? ""}" placeholder="—" /></label>
            <label class="field"><span class="label">Nota abaixo do “antes”</span><input class="input" data-r="fpsBeforeNote" value="${r.fpsBeforeNote}" placeholder="${fpsNote(o.fps.before) || "Opcional"}" /></label>
            <label class="field"><span class="label">Nota abaixo do “depois”</span><input class="input" data-r="fpsAfterNote" value="${r.fpsAfterNote}" placeholder="${fpsNote(o.fps.after) || "Opcional"}" /></label>
          </div>
          <label class="field"><span class="label">Nota do ganho</span><input class="input" data-r="gainNote" value="${r.gainNote}" placeholder="Ex.: dentro do limite do campo" /></label>
          <label class="field"><span class="label">Observação</span><textarea class="textarea" rows="2" data-r="observation" placeholder="Algo que o cliente precisa saber sobre o desempenho">${r.observation}</textarea></label>
        </div>
      </section>

      ${listEditor("diagnosis", "Diagnóstico inicial", 3, "O que foi encontrado ao abrir o equipamento")}
      ${listEditor("services", "Serviços realizados", 4, "O que foi feito")}
      ${photosCard()}

      <section class="card">
        <header class="card-head"><div><h2 class="card-title"><span class="step-num">6</span>Parecer técnico</h2><p class="card-desc">Conclusão, recomendações e cuidados de uso.</p></div></header>
        <div class="card-body"><textarea class="textarea" rows="4" data-r="opinion" placeholder="Equipamento revisado e testado. Recomenda-se…">${r.opinion}</textarea></div>
      </section>
    `;
  }

  /* -------------------------------------------------------- prévia */
  const fit = () => {
    const width = viewport.clientWidth;
    if (!width) return;
    const scale = Math.min(1, width / 1122);
    scaleEl.style.transform = `scale(${scale})`;
    viewport.style.height = `${Math.ceil(docEl.offsetHeight * scale)}px`;
  };

  const paintPreview = debounce(() => {
    if (!previewOpen) return;
    render(docEl, reportHtml(order()));
    fit();
  }, 120);

  function paint() {
    render(formEl, formHtml());
    paintPreview();
  }

  /* --------------------------------------------------------- listas */
  function lines(kind) {
    return [...order().report[kind]];
  }

  function setLines(kind, next, options) {
    update({ [kind]: next }, options);
  }

  function focusLine(kind, index) {
    requestAnimationFrame(() => {
      const input = formEl.querySelector(`[data-line="${kind}"][data-index="${index}"]`);
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    });
  }

  /* ---------------------------------------------------------- fotos */
  async function addPhotos(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!list.length) return;
    const room = MAX_PHOTOS - order().report.photos.length;
    if (room <= 0) {
      toast.error(`Máximo de ${MAX_PHOTOS} fotos por relatório`);
      return;
    }
    const chosen = list.slice(0, room);
    if (list.length > room) toast.info(`Só cabem mais ${room} foto${room > 1 ? "s" : ""}`, { description: "As demais foram ignoradas." });
    uploads += chosen.length;
    paint();
    for (const file of chosen) {
      try {
        const blob = await prepareImage(file);
        const doc = await store.uploadFile(blob, file.name.replace(/\.\w+$/, ".jpg"));
        const current = order().report.photos;
        if (current.length < MAX_PHOTOS) update({ photos: [...current, doc.id] }, { debounce: 0 });
      } catch (error) {
        console.error(error);
        toast.error(`Não foi possível enviar ${file.name}`, { description: error?.message || "" });
      } finally {
        uploads -= 1;
        paint();
      }
    }
  }

  async function removePhoto(index) {
    const photos = [...order().report.photos];
    const [id] = photos.splice(index, 1);
    const ok = await confirm({ title: "Remover esta foto?", message: "Ela sai do relatório e é apagada do servidor.", confirmLabel: "Remover", danger: true });
    if (!ok) return;
    update({ photos }, { debounce: 0 });
    store.deleteFile(id);
  }

  /* -------------------------------------------------------- eventos */
  const off = [
    on(formEl, "input", "[data-r]", (event, input) => update({ [input.dataset.r]: input.value })),
    on(formEl, "input", "[data-o]", (event, input) => {
      const o = order();
      const [group, key] = input.dataset.o.split(".");
      commit({ ...o, [group]: { ...o[group], [key]: input.value } });
    }),
    on(formEl, "input", "[data-fps]", (event, input) => {
      const o = order();
      const side = input.dataset.fps;
      input.value = input.value.replace(/[^\d.,]/g, "");
      commit({ ...o, fps: { ...o.fps, [side]: { ...o.fps[side], g20: parseNumber(input.value) } } });
    }),
    on(formEl, "input", "[data-line]", (event, input) => {
      const kind = input.dataset.line;
      const next = lines(kind);
      const index = Number(input.dataset.index);
      while (next.length <= index) next.push("");
      next[index] = input.value;
      setLines(kind, next);
    }),
    on(formEl, "keydown", "[data-line]", (event, input) => {
      const kind = input.dataset.line;
      const index = Number(input.dataset.index);
      if (event.key === "Enter") {
        event.preventDefault();
        const next = lines(kind);
        if (!next.length) next.push(input.value);
        next.splice(index + 1, 0, "");
        setLines(kind, next, { debounce: 300 });
        focusLine(kind, index + 1);
      } else if (event.key === "Backspace" && !input.value && lines(kind).length > 1) {
        event.preventDefault();
        const next = lines(kind);
        next.splice(index, 1);
        setLines(kind, next, { debounce: 300 });
        focusLine(kind, Math.max(0, index - 1));
      } else if (event.key === "ArrowDown") {
        focusLine(kind, index + 1);
      } else if (event.key === "ArrowUp") {
        focusLine(kind, Math.max(0, index - 1));
      }
    }),
    on(formEl, "click", "[data-add-line]", (event, btn) => {
      const kind = btn.dataset.addLine;
      const next = lines(kind);
      if (!next.length) next.push("");
      next.push("");
      setLines(kind, next, { debounce: 300 });
      focusLine(kind, next.length - 1);
    }),
    on(formEl, "click", "[data-remove-line]", (event, btn) => {
      const kind = btn.dataset.removeLine;
      const next = lines(kind);
      next.splice(Number(btn.dataset.index), 1);
      setLines(kind, next, { debounce: 0 });
    }),
    on(formEl, "click", "[data-import-items]", () => {
      const current = lines("services").filter((x) => x.trim());
      const fromItems = order().items.map((i) => i.description.trim()).filter(Boolean).filter((d) => !current.includes(d));
      if (!fromItems.length) {
        toast.info("Os itens da OS já estão na lista");
        return;
      }
      setLines("services", [...current, ...fromItems], { debounce: 0 });
      toast.success(`${fromItems.length} ${fromItems.length > 1 ? "itens trazidos" : "item trazido"} da OS`);
    }),
    on(formEl, "click", "[data-suggest]", async (event, btn) => {
      const kind = btn.dataset.suggest;
      const { openMenu } = await import("../ui/menu.js");
      const current = lines(kind).filter((x) => x.trim());
      openMenu(
        btn,
        SUGGESTIONS[kind].map((text) => ({
          label: text,
          checked: current.includes(text),
          run: () => {
            const now = lines(kind).filter((x) => x.trim());
            setLines(kind, now.includes(text) ? now.filter((x) => x !== text) : [...now, text], { debounce: 0 });
          },
        })),
        { align: "end", minWidth: 280, label: "Sugestões" }
      );
    }),
    on(formEl, "change", "[data-photo-input]", (event, input) => {
      addPhotos(input.files);
      input.value = "";
    }),
    on(formEl, "dragover", "[data-drop]", (event, zone) => {
      event.preventDefault();
      zone.classList.add("dragging");
    }),
    on(formEl, "dragleave", "[data-drop]", (event, zone) => zone.classList.remove("dragging")),
    on(formEl, "drop", "[data-drop]", (event, zone) => {
      event.preventDefault();
      zone.classList.remove("dragging");
      addPhotos(event.dataTransfer?.files);
    }),
    on(formEl, "click", "[data-remove-photo]", (event, btn) => removePhoto(Number(btn.dataset.removePhoto))),
    on(formEl, "click", "[data-move-photo]", (event, btn) => {
      const photos = [...order().report.photos];
      const index = Number(btn.dataset.index);
      const target = index + Number(btn.dataset.movePhoto);
      if (target < 0 || target >= photos.length) return;
      [photos[index], photos[target]] = [photos[target], photos[index]];
      update({ photos }, { debounce: 0 });
    }),
    on(el, "click", "[data-act]", async (event, btn) => {
      await store.flushAll().catch(() => {});
      if (btn.dataset.act === "pdf") exportReport(order(), "pdf");
      else exportReport(order(), "print");
    }),
  ];

  const resize = new ResizeObserver(() => fit());
  resize.observe(viewport);
  const onPaste = (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length && el.isConnected) {
      event.preventDefault();
      addPhotos(files);
    }
  };
  document.addEventListener("paste", onPaste);

  paint();
  return {
    refresh: paint,
    togglePreview(open) {
      previewOpen = open;
      storageSet("rz3:report-preview", open);
      editor.classList.toggle("no-preview", !open);
      paintPreview();
    },
    unmount() {
      off.forEach((fn) => fn());
      resize.disconnect();
      document.removeEventListener("paste", onPaste);
    },
  };
}

