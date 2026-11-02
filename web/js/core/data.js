/* Acesso aos dados já com os formatos normalizados do modelo. */
import * as store from "./store.js";
import { catalogWithDefaults, normalizeClient, normalizeOrder, settingsWithDefaults, compareNumbers } from "./model.js";

export function settings() {
  return settingsWithDefaults(store.get("settings", "main"));
}

export function saveSettings(next, options) {
  return store.save("settings", { ...next, id: "main" }, options);
}

export function catalog() {
  return catalogWithDefaults(store.get("catalog", "main"));
}

export function saveCatalog(next, options) {
  return store.save("catalog", { ...next, id: "main" }, options);
}

export function orders() {
  return store.list("orders").map(normalizeOrder);
}

export function order(id) {
  const doc = store.get("orders", id);
  return doc ? normalizeOrder(doc) : null;
}

export function saveOrder(next, options) {
  return normalizeOrder(store.save("orders", next, options));
}

export function clients() {
  return store.list("clients").map(normalizeClient).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function client(id) {
  const doc = id ? store.get("clients", id) : null;
  return doc ? normalizeClient(doc) : null;
}

export function saveClient(next, options) {
  return normalizeClient(store.save("clients", next, options));
}

export function sortOrders(list, key = "number", dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  const value = {
    number: (o) => o.number,
    client: (o) => o.client?.name || "",
    receivedAt: (o) => o.receivedAt || "",
    updatedAt: (o) => o.updatedAt || "",
    status: (o) => o.status,
  }[key];
  return [...list].sort((a, b) => {
    if (key === "number") return sign * compareNumbers(a.number, b.number) || sign * String(a.createdAt).localeCompare(String(b.createdAt));
    if (key === "total") return sign * ((a._total || 0) - (b._total || 0));
    return sign * String(value(a)).localeCompare(String(value(b)), "pt-BR", { numeric: true });
  });
}

export { store };
