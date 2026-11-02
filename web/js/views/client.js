/* Ficha do cliente: contato, equipamentos, OS e valores. */
import { html, render, on } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { STATUS, EQUIPMENT_TYPES, OPEN_STATUSES, clientOrders, orderTotal, isPaid, equipmentLabel, compareNumbers } from "../core/model.js";
import { money, phone as fmtPhone, maskPhone, date, relative, initials, plural, whatsappLink } from "../core/format.js";
import { uid } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { openMenu } from "../ui/menu.js";
import { confirm } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { setCrumbs } from "../ui/shell.js";
import { openNewOrder } from "../ui/new-order.js";

export function mount(el, ctx) {
  const id = ctx.params.id;
  if (!data.client(id)) {
    setCrumbs([{ label: "Clientes", href: "/clientes" }, { label: "Não encontrado" }]);
    el.innerHTML = String(html`<div class="page"><div class="card"><div class="empty"><div class="empty-icon">${icon("search", { size: 20 })}</div><h2>Cliente não encontrado</h2><p>Ele pode ter sido excluído.</p><div class="btn-group"><a class="btn btn-secondary" href="/clientes">Voltar para clientes</a></div></div></div></div>`);
    return null;
  }
  el.innerHTML = '<div class="page page-wide" data-client></div>';
  const root = el.firstElementChild;

  const client = () => data.client(id);
  const commit = (next, options = { debounce: 600 }) => {
    data.saveClient(next, options);
  };

  function paint() {
    const c = client();
    if (!c) return;
    const orders = clientOrders(data.orders(), c).sort((a, b) => compareNumbers(b.number, a.number));
    const paid = orders.filter(isPaid);
    const spent = paid.reduce((acc, o) => acc + orderTotal(o), 0);
    const open = orders.filter((o) => OPEN_STATUSES.includes(o.status));
    const first = orders.map((o) => o.receivedAt).filter(Boolean).sort()[0];
    const last = orders.map((o) => o.receivedAt).filter(Boolean).sort().pop();
    setCrumbs([{ label: "Clientes", href: "/clientes" }, { label: c.name || "Sem nome" }]);

    render(
      root,
      html`
        <header class="page-head">
          <div class="row client-hero">
            <span class="avatar avatar-lg">${initials(c.name)}</span>
            <div class="page-head-main">
              <h1 class="page-title">${c.name || "Sem nome"}</h1>
              <p class="page-desc">${[c.phone ? fmtPhone(c.phone) : "", c.city, first ? `cliente desde ${date(first)}` : ""].filter(Boolean).join(" · ") || "Complete o cadastro abaixo"}</p>
            </div>
          </div>
          <div class="page-actions">
            ${c.phone ? html`<a class="btn btn-secondary" href="${whatsappLink(c.phone)}" target="_blank" rel="noopener">${icon("message", { size: 16 })}WhatsApp</a>` : ""}
            <button type="button" class="btn btn-primary" data-act="new-order">${icon("plus", { size: 16 })}Nova OS</button>
            <button type="button" class="btn btn-ghost btn-icon" data-act="menu" aria-label="Mais ações">${icon("more", { size: 18 })}</button>
          </div>
        </header>

        <section class="stats compact">
          <div class="stat static"><span class="stat-label">${icon("orders", { size: 15 })}Ordens de serviço</span><strong class="stat-value">${orders.length}</strong><span class="stat-detail">${open.length ? `${open.length} em aberto` : "nenhuma em aberto"}</span></div>
          <div class="stat static"><span class="stat-label">${icon("banknote", { size: 15 })}Valor pago</span><strong class="stat-value">${money(spent)}</strong><span class="stat-detail">${paid.length ? `ticket médio ${money(spent / paid.length)}` : "—"}</span></div>
          <div class="stat static"><span class="stat-label">${icon("wallet", { size: 15 })}A receber</span><strong class="stat-value">${money(orders.filter((o) => !isPaid(o)).reduce((a, o) => a + orderTotal(o), 0))}</strong><span class="stat-detail">pagamentos pendentes</span></div>
          <div class="stat static"><span class="stat-label">${icon("calendar", { size: 15 })}Última visita</span><strong class="stat-value">${last ? date(last) : "—"}</strong><span class="stat-detail">${last ? relative(last) : "sem OS"}</span></div>
        </section>

        <div class="order-grid">
          <div class="stack-lg">
            <section class="card">
              <header class="card-head"><div><h2 class="card-title">Ordens de serviço</h2><p class="card-desc">${plural(orders.length, "ordem", "ordens")} deste cliente</p></div></header>
              ${orders.length
                ? html`<div class="table-scroll"><table class="table">
                    <thead><tr><th>OS</th><th>Equipamento</th><th>Status</th><th class="hide-sm">Entrada</th><th class="num">Valor</th></tr></thead>
                    <tbody>${orders.map((o) => html`<tr class="clickable" data-key="${o.id}" data-open="${o.id}">
                      <td><a class="os-number" href="/ordens/${o.id}">${o.number || "—"}</a></td>
                      <td><div class="cell-main"><strong class="truncate">${equipmentLabel(o.equipment) || o.equipment.type}</strong><small class="truncate">${o.problem || ""}</small></div></td>
                      <td><span class="status" data-status="${o.status}">${icon(STATUS[o.status].icon, { size: 14 })}${STATUS[o.status].label}</span></td>
                      <td class="hide-sm nowrap">${date(o.receivedAt)}</td>
                      <td class="num">${orderTotal(o) ? money(orderTotal(o)) : "—"}${orderTotal(o) && !isPaid(o) ? html` <span class="badge badge-warning">pendente</span>` : ""}</td>
                    </tr>`)}</tbody></table></div>`
                : html`<div class="empty compact"><p>Nenhuma OS ainda.</p><div class="btn-group"><button type="button" class="btn btn-secondary btn-sm" data-act="new-order">${icon("plus", { size: 15 })}Abrir OS</button></div></div>`}
            </section>

            <section class="card">
              <header class="card-head"><div><h2 class="card-title">Equipamentos</h2><p class="card-desc">Réplicas do cliente. Aparecem para escolha ao abrir uma OS.</p></div>
                <button type="button" class="btn btn-ghost btn-sm card-head-action" data-act="add-equip">${icon("plus", { size: 15 })}Adicionar</button></header>
              <div class="card-body">
                ${c.equipment.length
                  ? html`<div class="equip-list">${c.equipment.map((e) => html`<div class="equip-row" data-key="${e.id}" data-equip="${e.id}">
                      <select class="select" data-e="type" aria-label="Tipo">${EQUIPMENT_TYPES.map((t) => html`<option${t === e.type ? " selected" : ""}>${t}</option>`)}</select>
                      <input class="input" data-e="model" value="${e.model}" placeholder="Modelo" aria-label="Modelo" />
                      <input class="input" data-e="brand" value="${e.brand}" placeholder="Fabricante" aria-label="Fabricante" />
                      <input class="input mono" data-e="serial" value="${e.serial}" placeholder="Nº de série" aria-label="Número de série" />
                      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="new-order-equip" data-id="${e.id}" title="Abrir OS deste equipamento" aria-label="Abrir OS deste equipamento">${icon("orders", { size: 15 })}</button>
                      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="remove-equip" data-id="${e.id}" aria-label="Remover equipamento">${icon("trash", { size: 15 })}</button>
                    </div>`)}</div>`
                  : html`<p class="hint">Nenhum equipamento anotado. Eles também entram aqui automaticamente quando você abre uma OS.</p>`}
              </div>
            </section>
          </div>

          <aside class="stack-lg">
            <section class="card">
              <header class="card-head"><h2 class="card-title">Contato</h2></header>
              <div class="card-body stack">
                <label class="field"><span class="label">Nome</span><input class="input" data-f="name" value="${c.name}" /></label>
                <label class="field"><span class="label">WhatsApp / telefone</span><input class="input" data-f="phone" inputmode="tel" value="${fmtPhone(c.phone)}" placeholder="(48) 99999-9999" /></label>
                <label class="field"><span class="label">E-mail</span><input class="input" data-f="email" type="email" value="${c.email}" /></label>
                <div class="grid-2">
                  <label class="field"><span class="label">Instagram</span><input class="input" data-f="instagram" value="${c.instagram}" placeholder="@usuario" /></label>
                  <label class="field"><span class="label">Cidade</span><input class="input" data-f="city" value="${c.city}" /></label>
                </div>
                <label class="field"><span class="label">CPF</span><input class="input mono" data-f="document" value="${c.document}" placeholder="Opcional, para recibos" /></label>
              </div>
            </section>
            <section class="card">
              <header class="card-head"><h2 class="card-title">Notas</h2></header>
              <div class="card-body"><textarea class="textarea" rows="5" data-f="notes" placeholder="Time, preferências, combinados…">${c.notes}</textarea></div>
            </section>
          </aside>
        </div>
      `
    );
  }

  const off = [
    on(root, "input", "[data-f]", (e, input) => {
      const field = input.dataset.f;
      let value = input.value;
      if (field === "phone") {
        input.value = maskPhone(input.value);
        value = input.value.replace(/\D/g, "");
      }
      const next = { ...client(), [field]: value };
      commit(next);
      if (field === "name" || field === "phone") {
        // mantém o nome/telefone das OS em dia
        for (const o of data.orders()) {
          if (o.client?.id === id) data.saveOrder({ ...o, client: { ...o.client, name: next.name, phone: next.phone } }, { debounce: 1200, silent: true });
        }
      }
    }),
    on(root, "input", "[data-e]", (e, input) => {
      const equipId = input.closest("[data-equip]").dataset.equip;
      const c = client();
      commit({ ...c, equipment: c.equipment.map((eq) => (eq.id === equipId ? { ...eq, [input.dataset.e]: input.value } : eq)) });
    }),
    on(root, "change", "select[data-e]", (e, input) => {
      const equipId = input.closest("[data-equip]").dataset.equip;
      const c = client();
      commit({ ...c, equipment: c.equipment.map((eq) => (eq.id === equipId ? { ...eq, type: input.value } : eq)) }, { debounce: 0 });
    }),
    on(root, "click", "[data-open]", (e, row) => {
      if (e.target.closest("a, button")) return;
      ctx.navigate(`/ordens/${row.dataset.open}`);
    }),
    on(root, "click", "[data-act]", async (e, btn) => {
      const act = btn.dataset.act;
      const c = client();
      if (act === "new-order") openNewOrder({ clientId: id });
      else if (act === "new-order-equip") openNewOrder({ clientId: id, equipmentId: btn.dataset.id });
      else if (act === "add-equip") {
        const eq = { id: uid("e"), type: "AEG", model: "", brand: "", serial: "", notes: "" };
        commit({ ...c, equipment: [...c.equipment, eq] }, { debounce: 0 });
        requestAnimationFrame(() => root.querySelector(`[data-equip="${eq.id}"] [data-e="model"]`)?.focus());
      } else if (act === "remove-equip") {
        commit({ ...c, equipment: c.equipment.filter((eq) => eq.id !== btn.dataset.id) }, { debounce: 0 });
      } else if (act === "menu") {
        openMenu(btn, [
          { label: "Copiar telefone", icon: "copy", disabled: !c.phone, run: () => navigator.clipboard?.writeText(fmtPhone(c.phone)).then(() => toast.success("Telefone copiado")) },
          "-",
          {
            label: "Excluir cliente",
            icon: "trash",
            danger: true,
            run: async () => {
              const count = clientOrders(data.orders(), c).length;
              const ok = await confirm({ title: `Excluir ${c.name}?`, message: count ? `As ${count} OS deste cliente continuam no sistema, com o nome dele.` : "O cadastro será removido.", confirmLabel: "Excluir", danger: true });
              if (!ok) return;
              const removed = store.remove("clients", id);
              ctx.navigate("/clientes");
              toast.success(`${c.name} excluído`, { action: { label: "Desfazer", run: () => store.restore("clients", removed) } });
            },
          },
        ], { align: "end" });
      }
    }),
  ];
  const unsubscribe = store.subscribe((change) => {
    if (change?.type === "delete" && change.coll === "clients" && change.id === id) return;
    paint();
  });
  paint();
  return {
    unmount() {
      off.forEach((fn) => fn());
      unsubscribe();
    },
  };
}
