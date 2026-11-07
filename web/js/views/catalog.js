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
import { tr, trValue } from "../core/i18n.js";

/* Gravadas como estão aqui; a tela traduz com trValue(). */
const UNITS = ["Serviço", "Unidade", "Hora", "Consulta", "Par", "Kit"];

export function mount(el) {
  setCrumbs([{ label: tr("Serviços e preços"), href: "/servicos" }]);
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
            <h1 class="page-title">${tr("Serviços e preços")}</h1>
            <p class="page-desc">${total ? tr("{services} em {categories} · {priced} com preço", { services: plural(total, tr("serviço"), tr("serviços")), categories: plural(c.categories.length, tr("categoria"), tr("categorias")), priced }) : tr("Sua tabela de serviços: aparece na OS e vira um PDF para enviar aos clientes.")}</p>
          </div>
          <div class="page-actions">
            <button type="button" class="btn btn-secondary" data-act="print">${icon("printer", { size: 16 })}${tr("Imprimir")}</button>
            <button type="button" class="btn btn-secondary" data-act="pdf">${icon("filePdf", { size: 16 })}${tr("Baixar PDF")}</button>
            <button type="button" class="btn btn-primary" data-act="add-category">${icon("plus", { size: 16 })}${tr("Categoria")}</button>
          </div>
        </header>
        <div class="catalog-grid">
          <div class="stack-lg">
            ${c.categories.length
              ? c.categories.map((cat, ci) => html`<section class="card catalog-cat" data-key="${cat.id}" data-cat="${cat.id}">
                  <header class="card-head">
                    <span class="cat-num">${String(ci + 1).padStart(2, "0")}</span>
                    <input class="input-ghost cat-name" data-cat-field="name" value="${cat.name}" placeholder="${tr("Nome da categoria")}" aria-label="${tr("Nome da categoria")}" />
                    <span class="badge">${cat.items.length}</span>
                    <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="cat-menu" aria-label="${tr("Ações da categoria")}">${icon("more", { size: 16 })}</button>
                  </header>
                  <div class="svc-head" aria-hidden="true"><span>${tr("Serviço e detalhes")}</span><span>${tr("Cobrança")}</span><span class="num">${tr("Valor")}</span><span></span></div>
                  <div class="svc-list">
                    ${cat.items.map((item, ii) => html`<div class="svc-row" data-key="${item.id}" data-item="${item.id}">
                      <div class="svc-main">
                        <input class="input-ghost svc-name" data-item-field="name" value="${item.name}" placeholder="${tr("Nome do serviço")}" aria-label="${tr("Nome do serviço")}" />
                        <input class="input-ghost svc-desc" data-item-field="description" value="${item.description}" placeholder="${tr("Detalhes (opcional)")}" aria-label="${tr("Detalhes")}" />
                      </div>
                      <select class="select svc-unit" data-item-field="unit" aria-label="${tr("Forma de cobrança")}">${[...new Set([...UNITS, item.unit].filter(Boolean))].map((u) => html`<option value="${u}"${u === item.unit ? " selected" : ""}>${trValue(u)}</option>`)}</select>
                      <input class="input input-money svc-price" data-item-field="price" inputmode="numeric" value="${item.price ? money(item.price) : ""}" placeholder="${tr("Sob consulta")}" aria-label="${tr("Valor")}" />
                      <div class="svc-actions">
                        <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="item-up" data-index="${ii}" aria-label="${tr("Subir")}" ${ii === 0 ? "disabled" : ""}>${icon("arrowUp", { size: 13 })}</button>
                        <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="item-down" data-index="${ii}" aria-label="${tr("Descer")}" ${ii === cat.items.length - 1 ? "disabled" : ""}>${icon("arrowDown", { size: 13 })}</button>
                        <button type="button" class="btn btn-ghost btn-icon btn-xs" data-act="item-delete" data-index="${ii}" aria-label="${tr("Excluir serviço")}">${icon("trash", { size: 13 })}</button>
                      </div>
                    </div>`)}
                  </div>
                  <div class="card-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="add-item">${icon("plus", { size: 15 })}${tr("Adicionar serviço")}</button></div>
                </section>`)
              : html`<div class="card"><div class="empty">
                  <div class="empty-icon">${icon("tag", { size: 20 })}</div>
                  <h3>${tr("Catálogo vazio")}</h3>
                  <p>${tr("Organize seus serviços por categoria (ex.: Manutenção, Upgrades, Conectores). Os preços entram nas OS com um clique.")}</p>
                  <div class="btn-group"><button type="button" class="btn btn-primary" data-act="add-category">${icon("plus", { size: 16 })}${tr("Criar categoria")}</button><button type="button" class="btn btn-secondary" data-act="starter">${tr("Usar modelo inicial")}</button></div>
                </div></div>`}
          </div>
          <aside class="stack-lg catalog-side">
            <section class="card">
              <header class="card-head"><div><h2 class="card-title">${tr("Textos do PDF")}</h2><p class="card-desc">${tr("Cabeçalho e rodapé da tabela para clientes.")}</p></div></header>
              <div class="card-body stack">
                <label class="field"><span class="label">${tr("Título")}</span><input class="input" data-meta="title" value="${c.meta.title}" /></label>
                <label class="field"><span class="label">${tr("Subtítulo")}</span><input class="input" data-meta="subtitle" value="${c.meta.subtitle}" /></label>
                <label class="field"><span class="label">${tr("Apresentação")}</span><textarea class="textarea" rows="3" data-meta="intro">${c.meta.intro}</textarea></label>
                <label class="field"><span class="label">${tr("Contato")}</span><input class="input" data-meta="contact" value="${c.meta.contact}" placeholder="${data.settings().business.phone ? tr("Usa o telefone da oficina") : "(48) 99999-9999"}" /></label>
                <label class="field"><span class="label">${tr("Observação")}</span><textarea class="textarea" rows="2" data-meta="note">${c.meta.note}</textarea></label>
                <label class="field"><span class="label">${tr("Rodapé")}</span><input class="input" data-meta="footer" value="${c.meta.footer}" /></label>
              </div>
            </section>
          </aside>
        </div>
      `
    );
  }

  function addCategory() {
    const c = catalog();
    const cat = { id: uid("cat"), name: tr("Nova categoria"), items: [{ id: uid("svc"), name: "", description: "", unit: "Serviço", price: 0 }] };
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
          { id: uid("cat"), name: tr("Manutenção e revisão"), items: [item(tr("Revisão completa"), tr("Sistema interno e externo, hop-up e cano")), item(tr("Manutenção em AEG"), tr("Revisão, limpeza e correção de problemas")), item(tr("Diagnóstico"), tr("Avaliação do equipamento"), "Consulta")] },
          { id: uid("cat"), name: tr("Peças, conectores e upgrades"), items: [item(tr("Troca de peças"), tr("Motor, bucking, nozzle, nub, engrenagens, contatos")), item(tr("Troca de conector XT60")), item(tr("Troca de conector T-Deans")), item(tr("Instalação de MOSFET"))] },
          { id: uid("cat"), name: tr("Carregadores GBB"), items: [item(tr("Troca de O-rings"), tr("Resolução de vazamentos"))] },
        ],
      },
      { debounce: 0 }
    );
    toast.success(tr("Modelo inicial criado"), { description: tr("Ajuste nomes e preços à sua oficina.") });
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
        if (item?.name) toast.success(tr("“{name}” removido", { name: item.name }), { action: { label: tr("Desfazer"), run: () => mapCategory(catId, (x) => ({ ...x, items: [...x.items.slice(0, index), item, ...x.items.slice(index)] })) } });
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
          { label: tr("Mover para cima"), icon: "arrowUp", disabled: ci === 0, run: () => move(-1) },
          { label: tr("Mover para baixo"), icon: "arrowDown", disabled: ci === c.categories.length - 1, run: () => move(1) },
          "-",
          {
            label: tr("Excluir categoria"),
            icon: "trash",
            danger: true,
            run: async () => {
              const cat = c.categories[ci];
              const ok = cat.items.length ? await confirm({ title: tr("Excluir “{name}”?", { name: cat.name }), message: `${plural(cat.items.length, tr("serviço também será removido"), tr("serviços também serão removidos"))}.`, confirmLabel: tr("Excluir"), danger: true }) : true;
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
