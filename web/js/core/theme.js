/* Tema: "dark" (padrão, identidade da RZ), "light" ou "system". Fica salvo neste navegador. */
const KEY = "rz3:theme";
const media = window.matchMedia("(prefers-color-scheme: light)");
const listeners = new Set();

export function preference() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}

export function resolved(pref = preference()) {
  if (pref === "light" || pref === "dark") return pref;
  return media.matches ? "light" : "dark";
}

function apply() {
  const theme = resolved();
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#090c11" : "#f6f7f9";
  for (const fn of listeners) fn(theme, preference());
}

export function setPreference(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* continua só nesta sessão */
  }
  apply();
}

export function cycle() {
  const order = ["dark", "light", "system"];
  const next = order[(order.indexOf(preference()) + 1) % order.length];
  setPreference(next);
  return next;
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media.addEventListener("change", () => {
  if (preference() === "system") apply();
});
window.addEventListener("storage", (event) => {
  if (event.key === KEY) apply();
});

apply();
