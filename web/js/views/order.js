/* Detalhe da OS: visão geral (dados, itens, FPS, pagamento), relatório técnico e histórico. */
import { html, render, on, raw } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { STATUSES, STATUS, EQUIPMENT_TYPES, PAYMENT_METHODS, BB_WEIGHTS, orderTotal, subtotal, itemTotal, isPaid, fpsGain, withStatus, equipmentLabel, catalogItems, isLate, findClientByName, newClient, ageDays } from "../core/model.js";
import { money, maskMoney, date, dateTime, relative, signed, decimal2, joules, parseNumber, phone as fmtPhone, todayISO, whatsappLink, plural } from "../core/format.js";
import { uid } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { openMenu } from "../ui/menu.js";
import { modal } from "../ui/dialog.js";
import { attachCombo } from "../ui/combobox.js";
import { toast } from "../ui/toast.js";
import { setCrumbs } from "../ui/shell.js";
import { orderActions, openWhatsapp, printOrderSheet, reportPdf } from "./order-actions.js";
import { tr, trValue } from "../core/i18n.js";

const TABS = [
  { id: "", label: tr("Visão geral"), icon: "orders" },
  { id: "relatorio", label: tr("Relatório técnico"), icon: "fileText" },
  { id: "historico", label: tr("Histórico"), icon: "history" },
];

export function mount(el, ctx) {
  const id = ctx.params.id;
  const tab = TABS.some((t) => t.id === (ctx.params.tab || "")) ? ctx.params.tab || "" : "";
  let order = data.order(id);
  let reportView = null;

  if (!order) {
    setCrumbs([{ label: tr("Ordens de serviço"), href: "/ordens" }, { label: tr("Não encontrada") }]);
    el.innerHTML = String(html`<div class="page"><div class="card"><div class="empty">
      <div class="empty-icon">${icon("search", { size: 20 })}</div>
      <h2>${tr("OS não encontrada")}</h2><p>${tr("Ela pode ter sido excluída, talvez em outro dispositivo.")}</p>
      <div class="btn-group"><a class="btn btn-secondary" href="/ordens">${tr("Voltar para as ordens")}</a></div>
    </div></div></div>`);
    return null;
  }

  el.innerHTML = String(html`<div class="page page-wide order-page">
    <div data-head></div>
    <div class="tabs order-tabs" role="tablist" aria-label="${tr("Seções da OS")}">
      ${TABS.map((t) => html`<a class="tab" role="tab" href="/ordens/${id}${t.id ? "/" + t.id : ""}" aria-selected="${t.id === tab ? "true" : "false"}">${icon(t.icon, { size: 15 })}${t.label}</a>`)}
    </div>
    <div class="order-tab" data-tab></div>
  </div>`);
  const headEl = el.querySelector("[data-head]");
  const tabEl = el.querySelector("[data-tab]");

  const commit = (next, options = { debounce: 600 }) => {
    order = data.saveOrder(next, options);
    paint();
  };

  function clientOf(o) {
    const record = data.client(o.client?.id);
    return { id: record?.id || "", name: record?.name || o.client?.name || "", phone: record?.phone || o.client?.phone || "", record };
  }

  /* ------------------------------------------------------- cabeçalho */
  function head() {
    const st = STATUS[order.status];
    const client = clientOf(order);
    const late = isLate(order);
    const currentIndex = STATUSES.findIndex((s) => s.id === order.status);
    return html`
      <header class="order-head">
        <div class="order-head-main">
          <div class="order-kicker">
            <a href="/ordens" class="back-link">${icon("arrowLeft", { size: 14 })}${tr("Ordens")}</a>
            <span class="subtle">·</span>
            <span class="subtle">${tr("Entrada {date}", { date: date(order.receivedAt) })}${ageDays(order) != null && order.status !== "entregue" ? (ageDays(order) === 0 ? ` · ${tr("hoje")}` : ` · ${tr("há {n}", { n: plural(ageDays(order), tr("dia"), tr("dias")) })}`) : ""}</span>
          </div>
          <h1 class="order-title">
            <span class="os-number big">${tr("OS {n}", { n: order.number || "—" })}</span>
            <button type="button" class="status status-lg" data-status="${order.status}" data-action="status" aria-label="${tr("Status: {s}. Mudar", { s: st.label })}">${icon(st.icon, { size: 15 })}${st.label}${icon("chevronDown", { size: 13, className: "caret" })}</button>
            ${late ? html`<span class="badge badge-danger">${icon("clock", { size: 12 })}${tr("Atrasada")}</span>` : ""}
            ${orderTotal(order) ? (isPaid(order) ? html`<span class="badge badge-success">${icon("check", { size: 12 })}${tr("Pago")}</span>` : html`<span class="badge badge-warning">${tr("A receber")}</span>`) : ""}
          </h1>
          <p class="order-sub">${client.name || tr("Sem cliente")}${equipmentLabel(order.equipment) ? html` <span class="subtle">—</span> ${equipmentLabel(order.equipment)}` : ""}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-secondary" data-action="whatsapp" ${client.phone ? "" : "disabled"} title="${client.phone ? tr("Enviar mensagem para {phone}", { phone: fmtPhone(client.phone) }) : tr("Cliente sem telefone")}">${icon("message", { size: 16 })}WhatsApp</button>
          <button type="button" class="btn btn-secondary" data-action="pdf" aria-haspopup="menu">${icon("filePdf", { size: 16 })}PDF${icon("chevronDown", { size: 13 })}</button>
          <button type="button" class="btn btn-secondary btn-icon" data-action="print" aria-label="${tr("Imprimir ordem de serviço")}" title="${tr("Imprimir ordem de serviço")}">${icon("printer", { size: 16 })}</button>
          <button type="button" class="btn btn-ghost btn-icon" data-action="menu" aria-label="${tr("Mais ações")}">${icon("more", { size: 18 })}</button>
        </div>
      </header>
      <ol class="stepper" aria-label="${tr("Andamento")}">
        ${STATUSES.map((s, i) => html`<li class="step${i < currentIndex ? " done" : ""}${i === currentIndex ? " current" : ""}">
          <button type="button" data-step="${s.id}" ${i === currentIndex ? html`aria-current="step"` : ""} title="${s.hint}">
            <span class="step-dot">${i < currentIndex ? icon("check", { size: 12 }) : i === currentIndex ? icon(s.icon, { size: 12 }) : ""}</span>
            <span class="step-label">${s.label}</span>
          </button>
        </li>`)}
      </ol>
    `;
  }

  /* ---------------------------------------------------- visão geral */
  function itemsCard() {
    const items = order.items || [];
    return html`<section class="card">
      <header class="card-head">
        <div><h2 class="card-title">${tr("Serviços e peças")}</h2><p class="card-desc">${tr("O que foi feito e quanto custa. Digite para buscar no catálogo.")}</p></div>
      </header>
      <div class="items">
        ${items.length
          ? html`<div class="items-head" aria-hidden="true"><span>${tr("Descrição")}</span><span>${tr("Qtd.")}</span><span>${tr("Valor unit.")}</span><span class="num">Total</span><span></span></div>`
          : ""}
        ${items.map(
          (item, index) => html`<div class="item-row" data-key="${item.id}" data-item="${item.id}">
            <div class="combo item-desc">
              <input class="input" data-item-field="description" data-morph-attrs="keep" value="${item.description}" placeholder="${tr("Ex.: Revisão completa, troca de mola M120…")}" aria-label="${tr("Descrição do item {n}", { n: index + 1 })}" />
            </div>
            <input class="input input-number item-qty" data-item-field="qty" inputmode="decimal" value="${item.qty}" aria-label="${tr("Quantidade")}" />
            <input class="input input-money item-price" data-item-field="price" inputmode="numeric" value="${item.price ? money(item.price) : ""}" placeholder="${tr("R$ 0,00")}" aria-label="${tr("Valor unitário")}" />
            <span class="num item-total tnum">${money(itemTotal(item))}</span>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="remove-item" data-id="${item.id}" aria-label="${tr("Remover item")}">${icon("x", { size: 15 })}</button>
          </div>`
        )}
        <div class="items-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="add-item">${icon("plus", { size: 15 })}${tr("Adicionar item")}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="add-catalog">${icon("tag", { size: 15 })}${tr("Do catálogo")}</button>
        </div>
      </div>
      <div class="totals">
        <div class="totals-row"><span>Subtotal</span><span class="tnum">${money(subtotal(order))}</span></div>
        <div class="totals-row"><label for="o-discount">${tr("Desconto")}</label><input id="o-discount" class="input input-sm input-money" data-field="discount" inputmode="numeric" value="${order.discount ? money(order.discount) : ""}" placeholder="${tr("R$ 0,00")}" /></div>
        <div class="totals-row total"><span>Total</span><span class="tnum">${money(orderTotal(order))}</span></div>
      </div>
    </section>`;
  }

  function fpsCard() {
    const gain = fpsGain(order);
    const cell = (side, key) => html`<input class="input input-number fps-input" data-fps="${side}.${key}" inputmode="decimal" value="${order.fps[side][key] ?? ""}" placeholder="—" aria-label="${tr("FPS {side} com BB {bb}g", { side: side === "before" ? tr("antes") : tr("depois"), bb: `${key.slice(1, 2)}.${key.slice(2)}` })}" />`;
    return html`<section class="card">
      <header class="card-head">
        <div><h2 class="card-title">${tr("Desempenho")}</h2><p class="card-desc">${tr("FPS medido no cronógrafo, antes e depois. A energia em joules é calculada.")}</p></div>
        ${gain != null ? html`<span class="gain-pill ${gain >= 0 ? "up" : "down"}">${icon(gain >= 0 ? "trendUp" : "trendDown", { size: 14 })}${signed(gain, " FPS")}</span>` : ""}
      </header>
      <div class="card-body">
        <table class="fps-table">
          <thead><tr><th></th>${BB_WEIGHTS.map((w) => html`<th>BB ${w.label}</th>`)}</tr></thead>
          <tbody>
            <tr><th scope="row">${tr("Antes")}</th>${BB_WEIGHTS.map((w) => html`<td>${cell("before", w.key)}</td>`)}</tr>
            <tr><th scope="row">${tr("Depois")}</th>${BB_WEIGHTS.map((w) => html`<td>${cell("after", w.key)}</td>`)}</tr>
            <tr class="joules-row"><th scope="row">${tr("Joules (depois)")}</th>${BB_WEIGHTS.map((w) => {
              const value = joules(parseNumber(order.fps.after[w.key]), w.grams);
              return html`<td class="tnum">${value ? html`${decimal2(value)} J` : html`<span class="subtle">—</span>`}</td>`;
            })}</tr>
          </tbody>
        </table>
      </div>
    </section>`;
  }

  function overview() {
    const client = clientOf(order);
    const eq = order.equipment;
    const events = [...(order.events || [])].reverse().slice(0, 6);
    const method = PAYMENT_METHODS.find((m) => m.id === order.payment.method);
    return html`<div class="order-grid">
      <div class="order-main stack-lg">
        <section class="card">
          <header class="card-head"><h2 class="card-title">${tr("Equipamento")}</h2></header>
          <div class="card-body">
            <div class="form-grid cols-4">
              <label class="field"><span class="label">${tr("Tipo")}</span>
                <select class="select" data-field="equipment.type">${EQUIPMENT_TYPES.map((t) => html`<option value="${t}"${t === eq.type ? " selected" : ""}>${trValue(t)}</option>`)}</select></label>
              <label class="field"><span class="label">${tr("Modelo")}</span><input class="input" data-field="equipment.model" value="${eq.model}" placeholder="M4, AK, Scar…" /></label>
              <label class="field"><span class="label">${tr("Fabricante")}</span><input class="input" data-field="equipment.brand" value="${eq.brand}" placeholder="G&G, Cyma…" /></label>
              <label class="field"><span class="label">${tr("Nº de série")}</span><input class="input mono" data-field="equipment.serial" value="${eq.serial}" placeholder="${tr("Opcional")}" /></label>
            </div>
            <label class="field mt"><span class="label">${tr("Problema relatado pelo cliente")}</span>
              <textarea class="textarea" rows="3" data-field="problem" placeholder="${tr("O que o cliente relatou na entrega do equipamento")}">${order.problem}</textarea></label>
          </div>
        </section>
        ${itemsCard()}
        ${fpsCard()}
        <section class="card">
          <header class="card-head"><div><h2 class="card-title">${tr("Observações internas")}</h2><p class="card-desc">${tr("Só para a oficina: não aparece nos documentos do cliente.")}</p></div></header>
          <div class="card-body"><textarea class="textarea" rows="3" data-field="notes" placeholder="${tr("Peças encomendadas, combinados com o cliente, senha do cadeado da case…")}">${order.notes}</textarea></div>
        </section>
      </div>

      <aside class="order-side stack-lg">
        <section class="card">
          <header class="card-head"><h2 class="card-title">${tr("Cliente")}</h2>
            <button type="button" class="btn btn-ghost btn-sm card-head-action" data-action="change-client">${tr("Trocar")}</button></header>
          <div class="card-body">
            <div class="client-chip">
              <span class="avatar">${(client.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
              <div class="cell-main">
                ${client.id ? html`<a class="link-strong" href="/clientes/${client.id}">${client.name}</a>` : html`<strong>${client.name || tr("Sem cliente")}</strong>`}
                <small>${client.phone ? fmtPhone(client.phone) : tr("Sem telefone")}</small>
              </div>
            </div>
            ${client.phone
              ? html`<div class="row mt-sm">
                  <a class="btn btn-secondary btn-sm" href="${whatsappLink(client.phone)}" target="_blank" rel="noopener">${icon("message", { size: 14 })}${tr("Conversar")}</a>
                  <a class="btn btn-ghost btn-sm" href="tel:${client.phone}">${icon("phone", { size: 14 })}${tr("Ligar")}</a>
                </div>`
              : client.id ? html`<a class="btn btn-ghost btn-sm mt-sm" href="/clientes/${client.id}">${icon("phone", { size: 14 })}${tr("Adicionar telefone")}</a>` : ""}
          </div>
        </section>

        <section class="card">
          <header class="card-head"><h2 class="card-title">${tr("Detalhes")}</h2></header>
          <div class="card-body">
            <div class="form-grid cols-2">
              <label class="field"><span class="label">${tr("Nº da OS")}</span><input class="input mono" data-field="number" value="${order.number}" /></label>
              <label class="field"><span class="label">${tr("Técnico")}</span><input class="input" data-field="technician" value="${order.technician}" placeholder="${tr("Armeiro")}" /></label>
              <label class="field"><span class="label">${tr("Entrada")}</span><input class="input" type="date" data-field="receivedAt" value="${order.receivedAt}" /></label>
              <label class="field"><span class="label">${tr("Previsão")}</span><input class="input" type="date" data-field="dueAt" value="${order.dueAt}" /></label>
              <label class="field"><span class="label">${tr("Entregue em")}</span><input class="input" type="date" data-field="deliveredAt" value="${order.deliveredAt}" /></label>
              <label class="field"><span class="label">${tr("Garantia")}</span><div class="input-wrap"><input class="input input-number" data-field="warrantyDays" inputmode="numeric" value="${order.warrantyDays ?? ""}" /><span class="input-suffix">${tr("dias")}</span></div></label>
            </div>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><h2 class="card-title">${tr("Pagamento")}</h2><span class="card-head-value tnum">${money(orderTotal(order))}</span></header>
          <div class="card-body stack">
            <div class="segmented full" role="group" aria-label="${tr("Situação do pagamento")}">
              <button type="button" data-pay="pendente" aria-pressed="${!isPaid(order) ? "true" : "false"}">${icon("clock", { size: 14 })}${tr("A receber")}</button>
              <button type="button" data-pay="pago" aria-pressed="${isPaid(order) ? "true" : "false"}">${icon("checkCircle", { size: 14 })}${tr("Pago")}</button>
            </div>
            ${isPaid(order)
              ? html`<div class="form-grid cols-2">
                  <label class="field"><span class="label">${tr("Forma")}</span>
                    <select class="select" data-field="payment.method"><option value="">—</option>${PAYMENT_METHODS.map((m) => html`<option value="${m.id}"${m.id === order.payment.method ? " selected" : ""}>${m.label}</option>`)}</select></label>
                  <label class="field"><span class="label">${tr("Data")}</span><input class="input" type="date" data-field="payment.paidAt" value="${order.payment.paidAt}" /></label>
                </div>`
              : html`<p class="hint">${method ? tr("Quando o cliente pagar, marque como pago. Entra no faturamento do Painel.") : tr("Quando o cliente pagar, marque como pago e escolha a forma. Entra no faturamento do Painel.")}</p>`}
          </div>
        </section>

        <section class="card">
          <header class="card-head"><h2 class="card-title">${tr("Atividade")}</h2><a class="card-link" href="/ordens/${id}/historico">${tr("Tudo")} ${icon("chevronRight", { size: 13 })}</a></header>
          <div class="card-body">${timeline(events, true)}</div>
        </section>
      </aside>
    </div>`;
  }

  function eventText(event) {
    if (event.type === "created") return html`${tr("OS criada")}`;
    if (event.type === "status") return html`Status: <strong>${STATUS[event.from]?.label || event.from}</strong> → <strong>${STATUS[event.to]?.label || event.to}</strong>`;
    if (event.type === "imported") return html`${tr("Importada da versão anterior")}`;
    if (event.type === "paid") return html`${tr("Pagamento registrado")}`;
    if (event.type === "note") return html`${event.text || tr("Anotação")}`;
    return html`${event.text || event.type}`;
  }

  function timeline(events, compact = false) {
    if (!events.length) return html`<p class="hint">${tr("Sem registros ainda.")}</p>`;
    return html`<ol class="timeline${compact ? " compact" : ""}">
      ${events.map((event) => html`<li class="timeline-item">
        <span class="timeline-dot ${event.type === "status" ? "dot-" + event.to : ""}"></span>
        <div><p>${eventText(event)}</p><time datetime="${event.at}" title="${dateTime(event.at)}">${relative(event.at)}</time></div>
      </li>`)}
    </ol>`;
  }

  function history() {
    const events = [...(order.events || [])].reverse();
    return html`<div class="page-narrow-inner">
      <section class="card">
        <header class="card-head"><div><h2 class="card-title">${tr("Histórico da OS")}</h2><p class="card-desc">${tr("Mudanças de status e marcos desta ordem, do mais recente ao mais antigo.")}</p></div></header>
        <div class="card-body">${timeline(events)}</div>
        <div class="card-foot subtle small">${tr("Criada em {date} · última alteração {when}", { date: dateTime(order.createdAt), when: relative(order.updatedAt) })}</div>
      </section>
    </div>`;
  }

  /* ---------------------------------------------------------- desenho */
  async function paint() {
    order = data.order(id) || order;
    const client = clientOf(order);
    setCrumbs([{ label: tr("Ordens de serviço"), href: "/ordens" }, { label: `${tr("OS {n}", { n: order.number || "—" })}${client.name ? " · " + client.name : ""}` }]);
    render(headEl, head());
    if (tab === "relatorio") {
      if (!reportView) {
        const module = await import("./report.js");
        reportView = module.mountReport(tabEl, { getOrder: () => order, commit });
      } else {
        reportView.refresh();
      }
    } else {
      render(tabEl, tab === "historico" ? history() : overview());
    }
  }

  /* ---------------------------------------------------------- edição */
  function setPath(obj, path, value) {
    const keys = path.split(".");
    const next = { ...obj };
    let cursor = next;
    for (let i = 0; i < keys.length - 1; i += 1) {
      cursor[keys[i]] = { ...(cursor[keys[i]] || {}) };
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = value;
    return next;
  }

  function onFieldInput(input) {
    const path = input.dataset.field;
    let value = input.value;
    if (path === "discount") {
      input.value = maskMoney(input.value);
      value = Number(input.value.replace(/\D/g, "")) || 0;
    } else if (path === "warrantyDays") {
      value = input.value === "" ? null : Number(input.value.replace(/\D/g, "")) || 0;
    }
    let next = setPath(order, path, value);
    if (path === "deliveredAt" && value && order.status !== "entregue") next = withStatus(next, "entregue");
    commit(next);
  }

  function onItemInput(input) {
    const row = input.closest("[data-item]");
    const itemId = row.dataset.item;
    const field = input.dataset.itemField;
    let value = input.value;
    if (field === "price") {
      input.value = maskMoney(input.value);
      value = Number(input.value.replace(/\D/g, "")) || 0;
    } else if (field === "qty") {
      value = parseNumber(input.value) ?? (input.value === "" ? "" : 1);
    }
    commit({ ...order, items: order.items.map((item) => (item.id === itemId ? { ...item, [field]: value } : item)) });
  }

  function onFpsInput(input) {
    const [side, key] = input.dataset.fps.split(".");
    const cleaned = input.value.replace(/[^\d.,]/g, "");
    if (cleaned !== input.value) input.value = cleaned;
    const value = parseNumber(cleaned);
    commit({ ...order, fps: { ...order.fps, [side]: { ...order.fps[side], [key]: value } } });
  }

  function addItem(preset = {}) {
    const item = { id: uid("i"), kind: "servico", description: "", qty: 1, price: 0, ...preset };
    commit({ ...order, items: [...order.items, item] }, { debounce: 0 });
    requestAnimationFrame(() => tabEl.querySelector(`[data-item="${item.id}"] [data-item-field="${preset.description ? "price" : "description"}"]`)?.focus());
  }

  function catalogPicker(trigger) {
    const items = catalogItems(data.catalog());
    if (!items.length) {
      toast.info(tr("O catálogo está vazio"), { description: tr("Cadastre seus serviços em Serviços e preços para lançar com um clique."), action: { label: tr("Abrir catálogo"), run: () => ctx.navigate("/servicos") } });
      return;
    }
    openMenu(
      trigger,
      items.slice(0, 40).map((item) => ({
        label: item.name || tr("Sem nome"),
        hint: `${item.category}${item.price ? " · " + money(item.price) : ""}`,
        run: () => addItem({ description: item.name, price: item.price || 0, catalogId: item.id }),
      })),
      { label: tr("Catálogo"), minWidth: 300 }
    );
  }

  function attachItemCombo(input) {
    if (input._combo) return input._combo;
    input._combo = attachCombo(input, {
      minChars: 1,
      source: () => catalogItems(data.catalog()).map((item) => ({ id: item.id, label: item.name, detail: `${item.category}${item.price ? " · " + money(item.price) : ""}`, value: item })),
      onSelect: (option) => {
        const row = input.closest("[data-item]");
        const itemId = row.dataset.item;
        commit({ ...order, items: order.items.map((item) => (item.id === itemId ? { ...item, description: option.value.name, price: option.value.price || item.price, catalogId: option.value.id } : item)) }, { debounce: 0 });
        requestAnimationFrame(() => row.querySelector('[data-item-field="price"]')?.focus());
      },
    });
    return input._combo;
  }

  function changeClient() {
    const { el: dlg, close } = modal({
      title: tr("Trocar cliente da OS"),
      size: "sm",
      content: html`<div class="field"><span class="label">${tr("Cliente")}</span><div class="combo input-wrap">${icon("search", { size: 15 })}<input class="input" placeholder="${tr("Buscar ou cadastrar")}" autofocus /></div></div>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>${tr("Cancelar")}</button>`,
    });
    const input = dlg.querySelector("input");
    const apply = (client) => {
      commit({ ...order, client: { id: client.id, name: client.name, phone: client.phone } }, { debounce: 0 });
      close();
      toast.success(tr("Cliente alterado para {name}", { name: client.name }));
    };
    attachCombo(input, {
      source: () => data.clients().map((c) => ({ id: c.id, label: c.name, detail: fmtPhone(c.phone) })),
      onSelect: (option) => apply(data.client(option.id)),
      createLabel: (q) => tr("Cadastrar “{q}”", { q }),
      onCreate: (q) => apply(findClientByName(data.clients(), q) || data.saveClient(newClient({ name: q }))),
    });
  }

  const off = [
    on(el, "input", "[data-field]", (event, input) => onFieldInput(input)),
    on(el, "change", "select[data-field], input[type=date][data-field]", (event, input) => onFieldInput(input)),
    on(el, "input", "[data-item-field]", (event, input) => {
      // a lista de sugestões nasce no primeiro foco; se o foco não gerou evento, nasce aqui
      if (input.dataset.itemField === "description" && !input._combo) attachItemCombo(input).refresh();
      onItemInput(input);
    }),
    on(el, "input", "[data-fps]", (event, input) => onFpsInput(input)),
    on(el, "focusin", '[data-item-field="description"]', (event, input) => attachItemCombo(input)),
    on(el, "click", "[data-step]", (event, btn) => {
      const status = btn.dataset.step;
      if (status === order.status) return;
      const before = order.status;
      commit(withStatus(order, status), { debounce: 0 });
      toast.success(`Status: ${STATUS[status].label}`, { action: { label: tr("Desfazer"), run: () => commit(withStatus(order, before), { debounce: 0 }) } });
      if (status === "pronto" && clientOf(order).phone) {
        toast.info(tr("Avisar o cliente que está pronto?"), { action: { label: "WhatsApp", run: () => openWhatsapp(order, "pronto") }, duration: 9000 });
      }
    }),
    on(el, "click", "[data-pay]", (event, btn) => {
      const status = btn.dataset.pay;
      if (status === order.payment.status) return;
      commit({ ...order, payment: { ...order.payment, status, paidAt: status === "pago" ? order.payment.paidAt || todayISO() : "" } }, { debounce: 0 });
    }),
    on(el, "click", "[data-action]", (event, btn) => {
      const action = btn.dataset.action;
      if (action === "status") {
        openMenu(btn, STATUSES.map((s) => ({ label: s.label, dot: s.id, hint: s.hint, disabled: s.id === order.status, run: () => el.querySelector(`[data-step="${s.id}"]`)?.click() })), { minWidth: 240 });
      } else if (action === "whatsapp") openWhatsapp(order);
      else if (action === "print") printOrderSheet(order, "print");
      else if (action === "pdf") {
        openMenu(btn, [
          { label: tr("Relatório técnico"), hint: tr("A4 paisagem com a identidade da RZ"), icon: "fileText", run: () => reportPdf(order, "pdf") },
          { label: tr("Ordem de serviço"), hint: tr("Comprovante com itens, total e garantia"), icon: "receipt", run: () => printOrderSheet(order, "pdf") },
        ], { align: "end", minWidth: 280 });
      } else if (action === "menu") openMenu(btn, orderActions(order, { inDetail: true, onChange: paint }), { align: "end" });
      else if (action === "add-item") addItem();
      else if (action === "add-catalog") catalogPicker(btn);
      else if (action === "remove-item") commit({ ...order, items: order.items.filter((item) => item.id !== btn.dataset.id) }, { debounce: 0 });
      else if (action === "change-client") changeClient();
    }),
  ];

  const unsubscribe = store.subscribe((change) => {
    const touches = !change || change.type === "reload" || (change.coll === "orders" && change.id === id) || change.colls?.includes("orders") || change.coll === "clients" || change.colls?.includes("clients");
    if (!touches) return;
    if (change?.type === "delete" && change.coll === "orders" && change.id === id && change.remote) {
      toast.info(tr("Esta OS foi excluída em outro dispositivo"));
      ctx.navigate("/ordens");
      return;
    }
    if (data.order(id)) paint();
  });

  paint();
  return {
    unmount() {
      off.forEach((fn) => fn());
      unsubscribe();
      reportView?.unmount?.();
    },
  };
}

