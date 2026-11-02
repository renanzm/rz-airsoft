/* Cliente da API v1. Erros viram ApiError com status e código estáveis. */

export class ApiError extends Error {
  constructor(status, code, body = null, message = "") {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
  get offline() {
    return this.status === 0;
  }
}

let unauthorizedHandler = () => {
  const next = location.pathname + location.search;
  location.replace("/login" + (next && next !== "/" ? "?next=" + encodeURIComponent(next) : ""));
};

export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

export async function api(method, path, { json, body, headers = {}, signal, keepalive = false, timeout = 30000, raw = false } = {}) {
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeout) : 0;
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  const init = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...headers },
    signal: controller.signal,
    keepalive,
  };
  if (json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body;
  }
  let res;
  try {
    res = await fetch("/api/v1" + path, init);
  } catch (error) {
    clearTimeout(timer);
    if (signal?.aborted) throw error;
    throw new ApiError(0, error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network", null, "Sem conexão com o servidor");
  }
  clearTimeout(timer);
  if (raw && res.ok) return res;
  let data = null;
  const type = res.headers.get("Content-Type") || "";
  if (type.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (res.status === 401 && !path.startsWith("/auth/") && path !== "/session") {
    unauthorizedHandler();
    throw new ApiError(401, "auth", data, "Sessão expirada");
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `http-${res.status}`, data, data?.message || "");
  }
  return data;
}

export const get = (path, opts) => api("GET", path, opts);
export const post = (path, json, opts) => api("POST", path, { ...opts, json });

export function fileUrl(id) {
  return id ? `/api/v1/files/${encodeURIComponent(id)}` : "";
}

/** Mensagem amigável para mostrar em toast. */
export function describeError(error) {
  if (!(error instanceof ApiError)) return error?.message || "Algo deu errado.";
  if (error.status === 0) return "Sem conexão com o servidor. Verifique se a janela do RZ Airsoft está aberta.";
  if (error.status === 413) return "O conteúdo é grande demais para salvar.";
  if (error.status === 415) return "Formato de arquivo não aceito.";
  if (error.status === 403 && error.code === "origin") return "Requisição bloqueada por segurança. Recarregue a página.";
  if (error.status >= 500) return "O servidor encontrou um erro. Tente novamente.";
  return error.message || "Não foi possível concluir a ação.";
}
