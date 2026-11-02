/* Roteador com History API. Cada rota carrega um módulo de view sob demanda.
 *
 * Uma view exporta `mount(el, ctx)` e devolve opcionalmente
 * { unmount(), onQuery(query) }. Mudanças só na query string da mesma rota
 * chamam onQuery em vez de remontar a tela.
 */
import { prefersReducedMotion } from "./dom.js";

const routes = [];
const scrollMemory = new Map();
let outlet = null;
let current = null; // { route, params, path, view }
let afterNavigate = () => {};
let token = 0;

export function route(pattern, loader, meta = {}) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, "")
    .replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
  routes.push({ pattern, regex: new RegExp(`^${source || ""}/?$`), keys, loader, meta });
}

function match(pathname) {
  for (const item of routes) {
    const found = item.regex.exec(pathname);
    if (found) {
      const params = {};
      item.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(found[index + 1]);
      });
      return { route: item, params };
    }
  }
  return null;
}

export function currentPath() {
  return location.pathname + location.search;
}

export function query() {
  return new URLSearchParams(location.search);
}

/** Atualiza a query string sem recarregar a tela (filtros, abas). */
export function setQuery(changes, { replace = true } = {}) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "" || value === false) params.delete(key);
    else params.set(key, String(value));
  }
  const search = params.toString();
  navigate(location.pathname + (search ? `?${search}` : ""), { replace });
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) {
    location.href = to;
    return;
  }
  const next = url.pathname + url.search + url.hash;
  if (next === currentPath() + location.hash && !replace) return;
  scrollMemory.set(history.state?.key ?? "start", window.scrollY);
  const state = { key: Math.random().toString(36).slice(2) };
  if (replace) history.replaceState({ ...(history.state || {}), key: history.state?.key || state.key }, "", next);
  else history.pushState(state, "", next);
  resolve({ push: !replace });
}

export function back(fallback = "/") {
  if (history.length > 1 && document.referrer.startsWith(location.origin)) history.back();
  else navigate(fallback);
}

async function resolve({ push = false, pop = false } = {}) {
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const found = match(pathname) || match("/404");
  if (!found) return;
  const sameRoute = current && current.route === found.route && JSON.stringify(current.params) === JSON.stringify(found.params);
  if (sameRoute && current.view?.onQuery) {
    current.view.onQuery(query());
    afterNavigate({ ...found, query: query(), sameRoute: true });
    return;
  }
  const mine = ++token;
  let module;
  try {
    module = await found.route.loader();
  } catch (error) {
    console.error(error);
    outlet.innerHTML = '<div class="page"><div class="empty"><h2>Não foi possível abrir esta tela</h2><p>Recarregue a página.</p></div></div>';
    return;
  }
  if (mine !== token) return;

  const swap = () => {
    try {
      current?.view?.unmount?.();
    } catch (error) {
      console.error(error);
    }
    outlet.replaceChildren();
    const ctx = { params: found.params, query: query(), meta: found.route.meta, navigate, setQuery };
    let view = null;
    try {
      view = module.mount(outlet, ctx) || null;
    } catch (error) {
      console.error(error);
      outlet.innerHTML = '<div class="page"><div class="empty"><h2>Esta tela encontrou um erro</h2><p>Recarregue a página. Se continuar, veja o console.</p></div></div>';
    }
    current = { route: found.route, params: found.params, view };
    if (pop) window.scrollTo(0, scrollMemory.get(history.state?.key ?? "start") || 0);
    else if (push) window.scrollTo(0, 0);
    afterNavigate({ ...found, query: query(), sameRoute: false });
  };

  // A troca nunca depende da animação: se o navegador não desenhar (aba em
  // segundo plano), a tela muda mesmo assim em até 250 ms.
  let swapped = false;
  const run = () => {
    if (swapped || mine !== token) return;
    swapped = true;
    swap();
  };
  if (current && document.startViewTransition && !prefersReducedMotion() && document.visibilityState === "visible") {
    const transition = document.startViewTransition(run);
    // Uma animação pulada rejeita estas promessas; não é erro.
    for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) promise?.catch(() => {});
    setTimeout(() => {
      if (swapped) return;
      try {
        transition.skipTransition();
      } catch {
        /* já terminou */
      }
      run();
    }, 250);
  } else {
    run();
  }
}

function onClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!link || link.target === "_blank" || link.hasAttribute("download") || link.dataset.external != null) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || /^(mailto|tel|https?):/i.test(href) && !href.startsWith(location.origin)) return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

export function start(element, { onNavigate } = {}) {
  outlet = element;
  if (onNavigate) afterNavigate = onNavigate;
  if (!history.state?.key) history.replaceState({ key: "start" }, "", currentPath() + location.hash);
  document.addEventListener("click", onClick);
  window.addEventListener("popstate", () => resolve({ pop: true }));
  return resolve();
}

export function isActive(prefix) {
  const path = location.pathname;
  if (prefix === "/") return path === "/";
  return path === prefix || path.startsWith(prefix + "/");
}
