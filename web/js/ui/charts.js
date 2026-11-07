/* Gráficos leves em HTML/SVG: colunas com dica ao passar o mouse, sparkline e barras horizontais.
 * Barras finas (≤ 24px), ponta arredondada de 4px, grade em linha fina, um único eixo.
 */
import { html, raw, esc } from "../core/dom.js";
import { tr } from "../core/i18n.js";

function niceStep(max, ticks = 4) {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((n) => n * power >= raw) || 10;
  return unit * power;
}

/**
 * points: [{ key, label, value, tip }]  — `tip` é o texto completo do mês.
 * format: (value) => texto do eixo; highlight: chave da coluna destacada (rotulada no topo).
 */
export function columnChart({ points, format, tickFormat = format, highlight = null, height = 200, emptyText = tr("Sem dados no período") }) {
  const max = Math.max(0, ...points.map((p) => p.value));
  if (!points.length || max <= 0) {
    return html`<div class="chart-empty" style="height:${height}px"><span>${emptyText}</span></div>`;
  }
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return html`<div class="colchart" style="--chart-h:${height}px" data-chart>
    <div class="colchart-plot">
      <div class="colchart-grid" aria-hidden="true">
        ${ticks.map((v) => html`<div class="grid-line" style="bottom:${(v / top) * 100}%"><span>${tickFormat(v)}</span></div>`)}
      </div>
      <div class="colchart-bars" role="list">
        ${points.map((p) => {
          const pct = top ? (p.value / top) * 100 : 0;
          const isHi = p.key === highlight;
          return html`<div class="col${isHi ? " hi" : ""}" role="listitem" tabindex="0" data-tip="${p.tip || p.label}" data-value="${format(p.value)}" aria-label="${p.tip || p.label}: ${format(p.value)}">
            <div class="col-track">
              ${isHi && p.value > 0 ? html`<span class="col-value" style="bottom:calc(${pct}% + 6px)">${format(p.value)}</span>` : ""}
              <div class="col-bar${p.value > 0 ? "" : " zero"}" style="height:${p.value > 0 ? `max(3px, ${pct}%)` : "0"}"></div>
            </div>
            <span class="col-label">${p.label}</span>
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

/** Liga a dica flutuante a todos os gráficos dentro de `root`. */
export function bindChartTips(root) {
  let tip = null;
  const show = (col) => {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    tip.replaceChildren();
    const value = document.createElement("strong");
    value.textContent = col.dataset.value || "";
    const label = document.createElement("span");
    label.textContent = col.dataset.tip || "";
    tip.append(value, label);
    const bar = col.querySelector(".col-bar") || col;
    const rect = bar.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    tip.style.display = "flex";
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, colRect.left + colRect.width / 2 - w / 2));
    const topPos = Math.max(8, (rect.height > 2 ? rect.top : colRect.bottom - 30) - h - 8);
    tip.style.transform = `translate(${left}px, ${topPos}px)`;
    col.classList.add("hover");
  };
  const hide = (col) => {
    col?.classList.remove("hover");
    if (tip) tip.style.display = "none";
  };
  const over = (event) => {
    const col = event.target.closest?.(".col");
    if (col && root.contains(col)) show(col);
  };
  const out = (event) => {
    const col = event.target.closest?.(".col");
    if (col) hide(col);
  };
  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);
  root.addEventListener("focusin", over);
  root.addEventListener("focusout", out);
  return () => {
    root.removeEventListener("pointerover", over);
    root.removeEventListener("pointerout", out);
    root.removeEventListener("focusin", over);
    root.removeEventListener("focusout", out);
    tip?.remove();
  };
}

/** Sparkline: linha de 2px na cor neutra, ponto final na cor de destaque. */
export function sparkline(values, { width = 76, height = 26, label = "" } = {}) {
  const list = values.map((v) => Number(v) || 0);
  if (list.length < 2 || list.every((v) => v === 0)) return raw("");
  const max = Math.max(...list);
  const min = Math.min(0, ...list);
  const pad = 4;
  const x = (i) => pad + (i / (list.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const d = list.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lx = x(list.length - 1);
  const ly = y(list[list.length - 1]);
  return raw(
    `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">` +
      `<path d="${d}" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>` +
      `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="2"/>` +
      `</svg>`
  );
}

/** Lista de barras horizontais (uma cor só: o rótulo identifica cada linha). */
export function barList(rows, { format = (v) => String(v), empty = tr("Nada para mostrar") } = {}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0) return html`<p class="hint">${empty}</p>`;
  return html`<ul class="barlist">
    ${rows.map((r) => html`<li class="barlist-row" ${r.href ? raw(`data-href="${esc(r.href)}"`) : ""}>
      <div class="barlist-head">
        <span class="barlist-label">${r.lead || ""}${r.href ? html`<a href="${r.href}">${r.label}</a>` : r.label}</span>
        <span class="barlist-value">${format(r.value)}${r.detail ? html`<small>${r.detail}</small>` : ""}</span>
      </div>
      <div class="barlist-track"><span style="width:${Math.max(2, (r.value / max) * 100)}%"></span></div>
    </li>`)}
  </ul>`;
}
