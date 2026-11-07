/* Página não encontrada. */
import { html } from "../core/dom.js";
import { icon } from "../ui/icons.js";
import { setCrumbs } from "../ui/shell.js";
import { tr } from "../core/i18n.js";

export function mount(el) {
  setCrumbs([{ label: tr("Página não encontrada") }]);
  el.innerHTML = String(html`<div class="page"><div class="card"><div class="empty">
    <div class="empty-icon">${icon("crosshair", { size: 20 })}</div>
    <h2>${tr("Esta página não existe")}</h2>
    <p>${tr("O endereço pode ter mudado na versão nova do sistema. Use a busca (Ctrl+K) ou volte ao painel.")}</p>
    <div class="btn-group"><a class="btn btn-primary" href="/">${tr("Ir para o painel")}</a><a class="btn btn-secondary" href="/ordens">${tr("Ordens de serviço")}</a></div>
  </div></div></div>`);
  return null;
}
