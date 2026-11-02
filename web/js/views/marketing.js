/* Marketing: banner 4:5 editável, com prévia ao vivo, PDF e PNG. */
import { html, render, on } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { maskPhone, phone as fmtPhone } from "../core/format.js";
import { debounce } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { setCrumbs } from "../ui/shell.js";
import { bannerConfig, bannerHtml, exportBanner, prepareBannerMark, DEFAULT_BANNER } from "../docs/banner-doc.js";

export function mount(el) {
  setCrumbs([{ label: "Marketing", href: "/marketing" }]);
  el.innerHTML = String(html`<div class="page page-wide">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">Marketing</h1>
        <p class="page-desc">Banner da oficina no formato 4:5 (1080 × 1350). Edite os textos e baixe em PDF ou PNG para o Instagram e o WhatsApp.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-act="png">${icon("image", { size: 16 })}Baixar PNG</button>
        <button type="button" class="btn btn-primary" data-act="pdf">${icon("filePdf", { size: 16 })}Baixar PDF</button>
      </div>
    </header>
    <div class="banner-editor">
      <div class="stack-lg" data-form></div>
      <aside class="banner-preview">
        <div class="preview-viewport" data-viewport><div class="preview-scale" data-scale><div data-doc></div></div></div>
        <p class="hint">Prévia em tamanho reduzido. O arquivo sai em alta resolução.</p>
      </aside>
    </div>
  </div>`);
  const formEl = el.querySelector("[data-form]");
  const docEl = el.querySelector("[data-doc]");
  const scaleEl = el.querySelector("[data-scale]");
  const viewport = el.querySelector("[data-viewport]");
  let mark = "";

  const save = (changes) => {
    const s = data.settings();
    const current = { ...(s.marketing?.banner || {}) };
    data.saveSettings({ ...s, marketing: { ...(s.marketing || {}), banner: { ...current, ...changes } } }, { debounce: 600 });
  };

  const fit = () => {
    const width = viewport.clientWidth;
    if (!width) return;
    const scale = Math.min(1, width / 1080);
    scaleEl.style.transform = `scale(${scale})`;
    viewport.style.height = `${Math.ceil(1350 * scale)}px`;
  };

  const paintPreview = debounce(() => {
    render(docEl, bannerHtml(bannerConfig(), { mark }));
    fit();
  }, 80);

  function paintForm() {
    const c = bannerConfig();
    render(
      formEl,
      html`
        <section class="card">
          <header class="card-head"><h2 class="card-title">Chamada principal</h2></header>
          <div class="card-body stack">
            <label class="field"><span class="label">Linha de apoio</span><input class="input" data-b="eyebrow" value="${c.eyebrow}" /></label>
            <div class="grid-2">
              <label class="field"><span class="label">Título (Enter quebra a linha)</span><textarea class="textarea" rows="2" data-b="headline">${c.headline}</textarea></label>
              <label class="field"><span class="label">Palavra em destaque</span><input class="input" data-b="highlight" value="${c.highlight}" /></label>
            </div>
          </div>
        </section>
        <section class="card">
          <header class="card-head"><div><h2 class="card-title">Serviços</h2><p class="card-desc">Cinco cartões; o primeiro ganha destaque.</p></div></header>
          <div class="card-body stack">
            ${c.services.slice(0, 5).map((svc, i) => html`<div class="banner-svc" data-key="svc-${i}">
              <span class="cat-num">${String(i + 1).padStart(2, "0")}</span>
              <input class="input" data-svc="${i}" data-svc-field="title" value="${svc.title}" aria-label="Título do serviço ${i + 1}" />
              <input class="input" data-svc="${i}" data-svc-field="copy" value="${svc.copy}" aria-label="Descrição do serviço ${i + 1}" />
            </div>`)}
          </div>
        </section>
        <section class="card">
          <header class="card-head"><h2 class="card-title">Conectores e contato</h2></header>
          <div class="card-body stack">
            <label class="switch"><input type="checkbox" data-b-check="connectors" ${c.connectors ? "checked" : ""} /><span>Mostrar a faixa de troca de conectores (XT60 e T-Deans)</span></label>
            <div class="grid-2">
              <label class="field"><span class="label">Chamada do contato</span><input class="input" data-b="cta" value="${c.cta}" /></label>
              <label class="field"><span class="label">Telefone</span><input class="input" data-b="phone" inputmode="tel" value="${fmtPhone(c.phone)}" placeholder="Usa o telefone da oficina" /></label>
              <label class="field"><span class="label">Instagram</span><input class="input" data-b="handle" value="${c.handle}" placeholder="@rzairsoft" /></label>
              <label class="field"><span class="label">Rodapé</span><input class="input" data-b="footer" value="${c.footer}" /></label>
            </div>
            <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-act="reset">${icon("undo", { size: 14 })}Voltar ao texto original</button></div>
          </div>
        </section>
      `
    );
  }

  const off = [
    on(formEl, "input", "[data-b]", (e, input) => {
      let value = input.value;
      if (input.dataset.b === "phone") {
        input.value = maskPhone(input.value);
        value = input.value.replace(/\D/g, "");
      }
      save({ [input.dataset.b]: value });
    }),
    on(formEl, "change", "[data-b-check]", (e, input) => save({ [input.dataset.bCheck]: input.checked })),
    on(formEl, "input", "[data-svc]", (e, input) => {
      const services = bannerConfig().services.map((s) => ({ ...s }));
      services[Number(input.dataset.svc)][input.dataset.svcField] = input.value;
      save({ services });
    }),
    on(el, "click", "[data-act]", async (e, btn) => {
      const act = btn.dataset.act;
      if (act === "pdf" || act === "png") {
        await store.flushAll().catch(() => {});
        exportBanner(act);
      } else if (act === "reset") {
        const s = data.settings();
        data.saveSettings({ ...s, marketing: { ...(s.marketing || {}), banner: { ...DEFAULT_BANNER, phone: "", handle: undefined } } }, { debounce: 0 });
        toast.success("Textos originais restaurados");
      }
    }),
  ];
  const resize = new ResizeObserver(fit);
  resize.observe(viewport);
  const unsubscribe = store.subscribe((change) => {
    if (!change || change.type === "reload" || change.coll === "settings" || change.colls?.includes("settings")) {
      paintForm();
      paintPreview();
    }
  });
  prepareBannerMark().then((m) => {
    mark = m;
    paintPreview();
  });
  paintForm();
  paintPreview();
  return {
    unmount() {
      off.forEach((fn) => fn());
      resize.disconnect();
      unsubscribe();
    },
  };
}
