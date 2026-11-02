/* Serviços e preços: catálogo por categorias, usado nas OS e no PDF da tabela. */
import { html, render, on } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { money, maskMoney, plural } from "../core/format.js";
import { uid } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { openMenu } from "../ui/menu.js";
import { confirm } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { setCrumbs } from "../ui/shell.js";

const UNITS = ["Serviço", "Unidade", "Hora", "Consulta", "Par", "Kit"];

export function mount(el) {
  setCrumbs([{ label: "Serviços e preços", href: "/servicos" }]);
  el.innerHTML = '<div class="page page-wide" data-catalog></div>';
  const root = el.firstElementChild;
  const catalog = () => data.catalog();
  const commit = (next, options = { debounce: 600 }) => data.saveCatalog(next, options);

  const mapCategory = (catId, fn) => {
    const c = catalog();
    commit({ ...c, categories: c.categories.map((cat) => (cat.id === catId ? fn(cat) : cat)) }, { debounce: 0 });
  };

  function paint() {
    const c = catalog();
    const total = c.categories.reduce((acc, cat) => acc + cat.items.length, 0);
    const priced = c.categories.reduce((acc, cat) => acc + cat.items.filter((i) => i.price).length, 0);
    render(
      root,
      html`
        <header class="page-head">
          <div class="page-head-main">
            <h1 class="page-title">Serviços e preços</h1>
            <p class="page-desc">${total ? `${plural(total, "serviço", "serviços")} em ${plural(c.categories.length, "categoria", "categorias")} · ${priced} com preço` : "Sua tabela de serviços: aparece na OS e vira um PDF para enviar aos clientes."}</p>
          </div>
          <div class="page-actions">
            <button type="button" class="btn btn-secondary" data-act="print">${icon("printer", { size: 16 })}Imprimir</button>
            <button type="button" class="btn btn-secondary" data-act="pdf">${icon("filePdf", { size: 16 })}Baixar PDF</button>
            <button type="button" class="btn btn-primary" data-act="add-category">${icon("plus", { size: 16 })}Categoria</button>
          </div>
        </header>
        <div class="catalog-grid">
          <div class="stack-lg">
            ${c.categories.length
              ? c.categories.map((cat, ci) => html`<section class="card catalog-cat" data-key="${cat.id}" data-cat="${cat.id}">
                  <header class="card-head">
                    <span class="cat-num">${String(ci + 1).padStart(2, "0")}</span>
                    <input class="input-ghost cat-name" data-cat-field="name" value="${cat.name}" placeholder="Nome da categoria" aria-label="Nome da categoria" />
                    <span class="badge">${cat.items.length}</span>
                    <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="cat-menu" aria-label="Ações da categoria">${icon("more", { size: 16 })}</button>
                  </header>
                  <div class="svc-head" aria-hidden="true"><span>Serviço e detalhes</span><span>Cobrança</span><span class="num">Valor</span><span></span></div>
                  <div class="svc-list">
                    ${cat.items.map((item, ii) => html`<div class="svc-row" data-key="${item.id}" data-item="${item.id}">
                      <div class="svc-main">
                        <input class="input-ghost svc-name" data-item-field="name" value="${item.name}" placeholder="Nome do serviço" aria-label="Nome do serviço" />
                        <input class="input-ghost svc-desc" data-item-field="description" value="${item.description}" placeholder="Detalhes (opcional)" aria-label="Detalhes" />
                      </div>
                      <select class="select svc-unit" data-item-field="unit" aria-label="Forma de cobrança">${[...new Set([...UNITS, item.unit].filter(Boolean))].map((u) => html`<option${u === item.unit ? " selected" : ""}>${u}</option>`)}</select>
                      <input class="input input-money svc-price" data-item-field="price" inputmode="numeric" value="${item.price ? money(item.price) : ""}" placeholder="Sob consulta" aria-label="Valor" />
                      <div class="svc-actions">
                        <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="item-up" data-index="${ii}" aria-label="Subir" ${ii === 0 ? "disabled" : ""}>${icon("arrowUp", { size: 13 })}</button>
                        <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="item-down" data-index="${ii}" aria-label="Descer" ${ii === cat.items.length - 1 ? "disabled" : ""}>${icon("arrowDown", { size: 13 })}</button>
                        <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="item-delete" data-index="${ii}" aria-label="Excluir serviço">${icon("trash", { size: 13 })}</button>
                      </div>
                    </div>`)}
                  </div>
                  <div class="card-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="add-item">${icon("plus", { size: 15 })}Adicionar serviço</button></div>
                </section>`)
              : html`<div class="card"><div class="empty">
                  <div class="empty-icon">${icon("tag", { size: 20 })}</div>
                  <h3>Catálogo vazio</h3>
                  <p>Organize seus serviços por categoria (ex.: Manutenção, Upgrades, Conectores). Os preços entram nas OS com um clique.</p>
                  <div class="btn-group"><button type="button" class="btn btn-primary" data-act="add-category">${icon("plus", { size: 16 })}Criar categoria</button><button type="button" class="btn btn-secondary" data-act="starter">Usar modelo inicial</button></div>
                </div></div>`}
          </div>
          <aside class="stack-lg catalog-side">
            <section class="card">
              <header class="card-head"><div><h2 class="card-title">Textos do PDF</h2><p class="card-desc">Cabeçalho e rodapé da tabela para clientes.</p></div></header>
              <div class="card-body stack">
                <label class="field"><span class="label">Título</span><input class="input" data-meta="title" value="${c.meta.title}" /></label>
                <label class="field"><span class="label">Subtítulo</span><input class="input" data-meta="subtitle" value="${c.meta.subtitle}" /></label>
                <label class="field"><span class="label">Apresentação</span><textarea class="textarea" rows="3" data-meta="intro">${c.meta.intro}</textarea></label>
                <label class="field"><span class="label">Contato</span><input class="input" data-meta="contact" value="${c.meta.contact}" placeholder="${data.settings().business.phone ? "Usa o telefone da oficina" : "(48) 99999-9999"}" /></label>
                <label class="field"><span class="label">Observação</span><textarea class="textarea" rows="2" data-meta="note">${c.meta.note}</textarea></label>
                <label class="field"><span class="label">Rodapé</span><input class="input" data-meta="footer" value="${c.meta.footer}" /></label>
              </div>
            </section>
          </aside>
        </div>
      `
    );
  }

  function addCategory() {
    const c = catalog();
    const cat = { id: uid("cat"), name: "Nova categoria", items: [{ id: uid("svc"), name: "", description: "", unit: "Serviço", price: 0 }] };
    commit({ ...c, categories: [...c.categories, cat] }, { debounce: 0 });
    requestAnimationFrame(() => {
      const input = root.querySelector(`[data-cat="${cat.id}"] .cat-name`);
      input?.focus();
      input?.select();
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function starter() {
    const c = catalog();
    const item = (name, description = "", unit = "Serviço") => ({ id: uid("svc"), name, description, unit, price: 0 });
    commit(
      {
        ...c,
        categories: [
          { id: uid("cat"), name: "Manutenção e revisão", items: [item("Revisão completa", "Sistema interno e externo, hop-up e cano"), item("Manutenção em AEG", "Revisão, limpeza e correção de problemas"), item("Diagnóstico", "Avaliação do equipamento", "Consulta")] },
          { id: uid("cat"), name: "Peças, conectores e upgrades", items: [item("Troca de peças", "Motor, bucking, nozzle, nub, engrenagens, contatos"), item("Troca de conector XT60"), item("Troca de conector T-Deans"), item("Instalação de MOSFET")] },
          { id: uid("cat"), name: "Carregadores GBB", items: [item("Troca de O-rings", "Resolução de vazamentos")] },
        ],
      },
      { debounce: 0 }
    );
    toast.success("Modelo inicial criado", { description: "Ajuste nomes e preços à sua oficina." });
  }

  async function exportCatalog(mode) {
    await store.flushAll().catch(() => {});
    const { exportCatalog: run } = await import("../docs/catalog-doc.js");
    run(mode);
  }

  const off = [
    on(root, "input", "[data-meta]", (e, input) => {
      const c = catalog();
      commit({ ...c, meta: { ...c.meta, [input.dataset.meta]: input.value } });
    }),
    on(root, "input", "[data-cat-field]", (e, input) => {
      const catId = input.closest("[data-cat]").dataset.cat;
      const c = catalog();
      commit({ ...c, categories: c.categories.map((cat) => (cat.id === catId ? { ...cat, name: input.value } : cat)) });
    }),
    on(root, "input", "[data-item-field]", (e, input) => {
      const catId = input.closest("[data-cat]").dataset.cat;
      const itemId = input.closest("[data-item]").dataset.item;
      const field = input.dataset.itemField;
      let value = input.value;
      if (field === "price") {
        input.value = maskMoney(input.value);
        value = Number(input.value.replace(/\D/g, "")) || 0;
      }
      const c = catalog();
      commit({ ...c, categories: c.categories.map((cat) => (cat.id === catId ? { ...cat, items: cat.items.map((it) => (it.id === itemId ? { ...it, [field]: value } : it)) } : cat)) });
    }),
    on(root, "click", "[data-act]", async (e, btn) => {
      const act = btn.dataset.act;
      const catEl = btn.closest("[data-cat]");
      const catId = catEl?.dataset.cat;
      const index = Number(btn.dataset.index);
      if (act === "add-category") addCategory();
      else if (act === "starter") starter();
      else if (act === "pdf") exportCatalog("pdf");
      else if (act === "print") exportCatalog("print");
      else if (act === "add-item") {
        const item = { id: uid("svc"), name: "", description: "", unit: "Serviço", price: 0 };
        mapCategory(catId, (cat) => ({ ...cat, items: [...cat.items, item] }));
        requestAnimationFrame(() => root.querySelector(`[data-item="${item.id}"] .svc-name`)?.focus());
      } else if (act === "item-up" || act === "item-down") {
        const target = index + (act === "item-up" ? -1 : 1);
        mapCategory(catId, (cat) => {
          const items = [...cat.items];
          if (target < 0 || target >= items.length) return cat;
          [items[index], items[target]] = [items[target], items[index]];
          return { ...cat, items };
        });
      } else if (act === "item-delete") {
        const c = catalog();
        const cat = c.categories.find((x) => x.id === catId);
        const item = cat?.items[index];
        mapCategory(catId, (x) => ({ ...x, items: x.items.filter((_, i) => i !== index) }));
        if (item?.name) toast.success(`“${item.name}” removido`, { action: { label: "Desfazer", run: () => mapCategory(catId, (x) => ({ ...x, items: [...x.items.slice(0, index), item, ...x.items.slice(index)] })) } });
      } else if (act === "cat-menu") {
        const c = catalog();
        const ci = c.categories.findIndex((x) => x.id === catId);
        const move = (delta) => {
          const cats = [...c.categories];
          const target = ci + delta;
          if (target < 0 || target >= cats.length) return;
          [cats[ci], cats[target]] = [cats[target], cats[ci]];
          commit({ ...c, categories: cats }, { debounce: 0 });
        };
        openMenu(btn, [
          { label: "Mover para cima", icon: "arrowUp", disabled: ci === 0, run: () => move(-1) },
          { label: "Mover para baixo", icon: "arrowDown", disabled: ci === c.categories.length - 1, run: () => move(1) },
          "-",
          {
            label: "Excluir categoria",
            icon: "trash",
            danger: true,
            run: async () => {
              const cat = c.categories[ci];
              const ok = cat.items.length ? await confirm({ title: `Excluir “${cat.name}”?`, message: `${plural(cat.items.length, "serviço também será removido", "serviços também serão removidos")}.`, confirmLabel: "Excluir", danger: true }) : true;
              if (!ok) return;
              const now = catalog();
              commit({ ...now, categories: now.categories.filter((x) => x.id !== catId) }, { debounce: 0 });
            },
          },
        ], { align: "end" });
      }
    }),
  ];
  const unsubscribe = store.subscribe((change) => {
    if (!change || change.type === "reload" || change.coll === "catalog" || change.colls?.includes("catalog")) paint();
  });
  paint();
  return {
    unmount() {
      off.forEach((fn) => fn());
      unsubscribe();
    },
  };
}
