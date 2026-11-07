/* Painel: números do mês, faturamento em 12 meses, bancada e próximos passos. */
import { html, render } from "../core/dom.js";
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { STATUSES, STATUS, OPEN_STATUSES, orderTotal, isPaid, fpsGain, revenueDate, equipmentLabel, isLate, catalogItems, whatsappMessage } from "../core/model.js";
import { money, moneyCompact, monthLabel, monthYear, plural, signed, percent, relative, dateShort, daysBetween, todayISO, whatsappLink, fromISODate } from "../core/format.js";
import { fold } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { columnChart, bindChartTips, sparkline, barList } from "../ui/charts.js";
import { setCrumbs } from "../ui/shell.js";
import { openNewOrder } from "../ui/new-order.js";
import { tr, trHtml } from "../core/i18n.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return tr("Bom dia");
  if (h < 18) return tr("Boa tarde");
  return tr("Boa noite");
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function lastMonths(count) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) out.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  return out;
}

function stat({ label, value, delta, deltaGood, detail, spark, href, icon: name }) {
  return html`<a class="stat" href="${href || "#"}">
    <div class="stat-top"><span class="stat-label">${icon(name, { size: 15 })}${label}</span>${spark || ""}</div>
    <strong class="stat-value">${value}</strong>
    <span class="stat-detail">${delta ? html`<span class="delta ${deltaGood ? "good" : "bad"}">${delta}</span>` : ""}${detail}</span>
  </a>`;
}

export function mount(el) {
  setCrumbs([{ label: tr("Painel"), href: "/" }]);
  el.innerHTML = '<div class="page dashboard" data-dash></div>';
  const root = el.firstElementChild;
  const unbindTips = bindChartTips(root);

  function paint() {
    const orders = data.orders();
    const settings = data.settings();
    const user = store.currentUser();
    const months = lastMonths(12);
    const byMonth = new Map(months.map((m) => [monthKey(m), 0]));
    for (const o of orders) {
      if (!isPaid(o)) continue;
      const when = fromISODate(revenueDate(o));
      if (!when) continue;
      const key = monthKey(when);
      if (byMonth.has(key)) byMonth.set(key, byMonth.get(key) + orderTotal(o));
    }
    const values = months.map((m) => byMonth.get(monthKey(m)));
    const thisMonth = values[values.length - 1];
    const lastMonth = values[values.length - 2];
    const delta = lastMonth ? (thisMonth - lastMonth) / lastMonth : null;

    const unpaid = orders.filter((o) => !isPaid(o) && orderTotal(o) > 0);
    const receivable = unpaid.reduce((acc, o) => acc + orderTotal(o), 0);
    const open = orders.filter((o) => OPEN_STATUSES.includes(o.status));
    const counts = Object.fromEntries(STATUSES.map((s) => [s.id, orders.filter((o) => o.status === s.id).length]));
    const gains = orders.map(fpsGain).filter((g) => g != null);
    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : null;
    const paidRecent = orders.filter((o) => isPaid(o) && orderTotal(o) > 0 && (daysBetween(revenueDate(o)) ?? 999) <= 90);
    const ticket = paidRecent.length ? paidRecent.reduce((a, o) => a + orderTotal(o), 0) / paidRecent.length : 0;
    const ready = orders.filter((o) => o.status === "pronto").sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    const due = open
      .filter((o) => o.dueAt && o.status !== "pronto")
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, 5);
    const late = open.filter(isLate);

    // serviços mais feitos (itens das OS, agrupados pelo nome)
    const services = new Map();
    for (const o of orders) {
      for (const item of o.items || []) {
        const name = (item.description || "").trim();
        if (!name) continue;
        const key = fold(name);
        const entry = services.get(key) || { label: name, value: 0, total: 0 };
        entry.value += 1;
        entry.total += Math.round((Number(item.qty) || 0) * (Number(item.price) || 0));
        services.set(key, entry);
      }
    }
    const topServices = [...services.values()].sort((a, b) => b.value - a.value || b.total - a.total).slice(0, 6);

    // atividade recente (eventos de todas as OS)
    const activity = orders
      .flatMap((o) => (o.events || []).map((e) => ({ ...e, order: o })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 7);

    const firstRun = !orders.length;
    const catalogEmpty = !catalogItems(data.catalog()).length;
    const profileEmpty = !settings.business.phone;

    render(
      root,
      html`
        <header class="page-head">
          <div class="page-head-main">
            <h1 class="page-title">${greeting()}${user?.username ? `, ${user.username}` : ""}</h1>
            <p class="page-desc">${tr("Resumo da oficina ·")} ${monthYear(new Date())}${late.length ? html` · <a class="danger-text" href="/ordens?status=abertas">${plural(late.length, tr("OS atrasada"), tr("OS atrasadas"))}</a>` : ""}</p>
          </div>
          <div class="page-actions">
            <a class="btn btn-secondary" href="/ordens?view=board">${icon("columns", { size: 16 })}${tr("Quadro da bancada")}</a>
            <button type="button" class="btn btn-primary" data-new>${icon("plus", { size: 16 })}${tr("Nova OS")}</button>
          </div>
        </header>

        ${firstRun || catalogEmpty || profileEmpty
          ? html`<section class="card onboarding">
              <div class="card-head plain"><div><h2 class="card-title">${tr("Primeiros passos")}</h2><p class="card-desc">${tr("Três ajustes deixam os documentos e o painel completos.")}</p></div></div>
              <div class="onboarding-steps">
                <a class="onboarding-step${profileEmpty ? "" : " done"}" href="/configuracoes">
                  <span class="onboarding-check">${profileEmpty ? "1" : icon("check", { size: 14 })}</span>
                  <span><strong>${tr("Dados da oficina")}</strong><small>${tr("Telefone, Instagram e termos de garantia nos PDFs")}</small></span>
                </a>
                <a class="onboarding-step${catalogEmpty ? "" : " done"}" href="/servicos">
                  <span class="onboarding-check">${catalogEmpty ? "2" : icon("check", { size: 14 })}</span>
                  <span><strong>${tr("Serviços e preços")}</strong><small>${tr("Lance itens na OS com um clique")}</small></span>
                </a>
                <button type="button" class="onboarding-step${firstRun ? "" : " done"}" data-new>
                  <span class="onboarding-check">${firstRun ? "3" : icon("check", { size: 14 })}</span>
                  <span><strong>${tr("Primeira ordem de serviço")}</strong><small>${tr("Entrada do equipamento, relatório e cobrança")}</small></span>
                </button>
              </div>
            </section>`
          : ""}

        <section class="stats" aria-label="${tr("Indicadores")}">
          ${stat({
            label: tr("Faturamento do mês"),
            icon: "banknote",
            value: money(thisMonth),
            delta: delta == null ? "" : `${delta >= 0 ? "▲" : "▼"} ${percent(Math.abs(delta))}`,
            deltaGood: delta != null && delta >= 0,
            detail: delta == null ? tr("OS pagas neste mês") : tr(" vs. mês anterior"),
            spark: sparkline(values, { label: tr("Faturamento dos últimos 12 meses") }),
            href: "/ordens?pay=pago&period=mes",
          })}
          ${stat({
            label: tr("A receber"),
            icon: "wallet",
            value: money(receivable),
            detail: unpaid.length ? plural(unpaid.length, tr("OS com pagamento pendente"), tr("OS com pagamento pendente")) : tr("Nada pendente"),
            href: "/ordens?pay=pendente",
          })}
          ${stat({
            label: tr("Em aberto"),
            icon: "wrench",
            value: String(open.length),
            detail: `${tr("{n} na bancada", { n: counts.bancada })} · ${plural(counts.pronto, tr("pronta"), tr("prontas"))}`,
            href: "/ordens?view=board",
          })}
          ${stat({
            label: tr("Ganho médio de FPS"),
            icon: "gauge",
            value: avgGain == null ? "—" : signed(avgGain),
            detail: gains.length ? tr("em {n} (BB 0.20g)", { n: plural(gains.length, tr("medição"), tr("medições")) }) : tr("Registre o FPS antes e depois"),
            href: "/ordens",
          })}
        </section>

        <div class="dash-grid">
          <section class="card dash-revenue">
            <header class="card-head">
              <div><h2 class="card-title">${tr("Faturamento")}</h2><p class="card-desc">${tr("OS pagas nos últimos 12 meses")}${ticket ? ` · ${tr("ticket médio {v} (90 dias)", { v: money(ticket) })}` : ""}</p></div>
              <span class="card-head-value tnum">${money(values.reduce((a, b) => a + b, 0))}</span>
            </header>
            <div class="card-body">
              ${columnChart({
                points: months.map((m, i) => ({ key: monthKey(m), label: monthLabel(m), value: values[i], tip: monthYear(m) })),
                format: money,
                tickFormat: moneyCompact,
                highlight: monthKey(months[months.length - 1]),
                height: 210,
                emptyText: tr("As OS pagas aparecem aqui, mês a mês."),
              })}
            </div>
          </section>

          <section class="card">
            <header class="card-head"><div><h2 class="card-title">${tr("Bancada agora")}</h2><p class="card-desc">${plural(open.length, tr("ordem em aberto"), tr("ordens em aberto"))}</p></div><a class="card-link" href="/ordens?view=board">${tr("Quadro")} ${icon("chevronRight", { size: 13 })}</a></header>
            <div class="card-body">
              ${barList(
                OPEN_STATUSES.map((id) => ({ label: STATUS[id].label, value: counts[id], href: `/ordens?status=${id}`, lead: html`<span class="dot dot-${id}"></span>` })),
                { format: (v) => String(v), empty: tr("Nenhuma OS em aberto. Bancada livre!") }
              )}
              <div class="mini-stats">
                <a href="/ordens?status=entregue"><strong>${counts.entregue}</strong><span>${tr("entregues no total")}</span></a>
                <a href="/ordens?status=abertas"><strong class="${late.length ? "danger-text" : ""}">${late.length}</strong><span>${late.length === 1 ? tr("atrasada") : tr("atrasadas")}</span></a>
              </div>
            </div>
          </section>
        </div>

        <div class="dash-grid three">
          <section class="card">
            <header class="card-head"><div><h2 class="card-title">${tr("Prontas para retirada")}</h2><p class="card-desc">${tr("Avise o cliente com um clique")}</p></div><span class="badge">${ready.length}</span></header>
            <div class="card-body flush">
              ${ready.length
                ? html`<ul class="list">${ready.slice(0, 6).map((o) => {
                    const link = whatsappLink(o.client?.phone, whatsappMessage(o, settings, "pronto"));
                    return html`<li class="list-row">
                      <a class="list-main" href="/ordens/${o.id}"><span class="os-number">${o.number}</span><span class="truncate"><strong>${o.client?.name || tr("Sem cliente")}</strong><small>${equipmentLabel(o.equipment) || "—"} · ${tr("pronta {when}", { when: relative(o.updatedAt) })}</small></span></a>
                      ${link ? html`<a class="btn btn-secondary btn-xs" href="${link}" target="_blank" rel="noopener" title="${tr("Avisar no WhatsApp")}">${icon("message", { size: 13 })}${tr("Avisar")}</a>` : ""}
                    </li>`;
                  })}</ul>`
                : html`<div class="empty compact"><p>${tr("Nenhuma OS pronta aguardando retirada.")}</p></div>`}
            </div>
          </section>

          <section class="card">
            <header class="card-head"><div><h2 class="card-title">${tr("Próximas entregas")}</h2><p class="card-desc">${tr("Pela previsão combinada")}</p></div></header>
            <div class="card-body flush">
              ${due.length
                ? html`<ul class="list">${due.map((o) => {
                    const days = daysBetween(todayISO(), o.dueAt);
                    return html`<li class="list-row">
                      <a class="list-main" href="/ordens/${o.id}"><span class="os-number">${o.number}</span><span class="truncate"><strong>${o.client?.name || tr("Sem cliente")}</strong><small>${STATUS[o.status].label} · ${equipmentLabel(o.equipment) || "—"}</small></span></a>
                      <span class="badge ${days < 0 ? "badge-danger" : days <= 1 ? "badge-warning" : ""}">${days < 0 ? tr("{n}d atrasada", { n: -days }) : days === 0 ? tr("hoje") : days === 1 ? tr("amanhã") : dateShort(o.dueAt)}</span>
                    </li>`;
                  })}</ul>`
                : html`<div class="empty compact"><p>${tr("Sem previsões de entrega. Defina a data na OS para acompanhar aqui.")}</p></div>`}
            </div>
          </section>

          <section class="card">
            <header class="card-head"><div><h2 class="card-title">${tr("Serviços mais feitos")}</h2><p class="card-desc">${tr("Pelos itens lançados nas OS")}</p></div></header>
            <div class="card-body">
              ${barList(topServices.map((s) => ({ label: s.label, value: s.value, detail: s.total ? moneyCompact(s.total) : "" })), {
                format: (v) => `${v}×`,
                empty: tr("Lance serviços e peças nas OS para ver o ranking."),
              })}
            </div>
          </section>
        </div>

        <section class="card">
          <header class="card-head"><div><h2 class="card-title">${tr("Atividade recente")}</h2><p class="card-desc">${tr("Entradas e mudanças de status em todas as OS")}</p></div><a class="card-link" href="/ordens">${tr("Ver ordens")} ${icon("chevronRight", { size: 13 })}</a></header>
          <div class="card-body">
            ${activity.length
              ? html`<ol class="timeline">${activity.map((e) => html`<li class="timeline-item">
                  <span class="timeline-dot ${e.type === "status" ? "dot-" + e.to : ""}"></span>
                  <div><p><a class="link-strong" href="/ordens/${e.order.id}">${tr("OS {n}", { n: e.order.number })}</a> · ${e.order.client?.name || tr("Sem cliente")} —
                    ${e.type === "status" ? trHtml("foi para <strong>{s}</strong>", { s: STATUS[e.to]?.label || e.to }) : e.type === "created" ? tr("entrada registrada") : e.type === "imported" ? tr("importada da versão anterior") : e.text || e.type}</p>
                  <time datetime="${e.at}">${relative(e.at)}</time></div>
                </li>`)}</ol>`
              : html`<p class="hint">${tr("Quando houver OS, as mudanças aparecem aqui.")}</p>`}
          </div>
        </section>
      `
    );
  }

  const onClick = (event) => {
    if (event.target.closest("[data-new]")) openNewOrder();
  };
  root.addEventListener("click", onClick);
  const unsubscribe = store.subscribe(() => paint());
  paint();
  return {
    unmount() {
      unsubscribe();
      unbindTips();
      root.removeEventListener("click", onClick);
    },
  };
}
