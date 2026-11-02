/* Acesso: cria o primeiro usuário ou entra. A senha nunca é guardada no navegador. */
import { api, ApiError } from "./core/api.js";
import { icon } from "./ui/icons.js";

const USER_RE = /^[A-Za-z0-9._-]{3,32}$/;
const $ = (id) => document.getElementById(id);

const form = $("auth-form");
const status = $("auth-status");
const errorBox = $("auth-error");
const title = $("auth-title");
const desc = $("auth-desc");
const submit = $("submit");
const user = $("username");
const pass = $("password");
const confirmField = $("confirm-field");
const confirmInput = $("confirm");
const strength = $("strength");
const remember = $("remember-field");
const eye = $("toggle-password");

let mode = "login";
let busy = false;

function safeNext() {
  const next = new URLSearchParams(location.search).get("next") || "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /^\/(api|login)/.test(next) || /[\0\r\n]/.test(next)) return "/";
  return next;
}

function showError(message, field) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
  for (const input of [user, pass, confirmInput]) input.removeAttribute("aria-invalid");
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}

function setBusy(value) {
  busy = value;
  submit.disabled = value;
  if (value) submit.setAttribute("aria-busy", "true");
  else submit.removeAttribute("aria-busy");
}

function score(value) {
  let points = 0;
  if (value.length >= 8) points += 1;
  if (value.length >= 12) points += 1;
  if (value.length >= 16) points += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points += 1;
  if (/\d/.test(value)) points += 1;
  if (/[^A-Za-z0-9]/.test(value)) points += 1;
  if (/^(.)\1+$/.test(value) || /^(12345678|senha|password|qwerty)/i.test(value)) points = 0;
  return Math.min(4, Math.floor(points * 0.75));
}

function paintStrength() {
  const s = score(pass.value);
  const labels = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"];
  const colors = ["var(--danger)", "var(--danger)", "var(--warning)", "var(--success)", "var(--success)"];
  strength.querySelector(".strength-bar span").style.width = `${pass.value ? Math.max(8, (s / 4) * 100) : 0}%`;
  strength.querySelector(".strength-bar span").style.background = colors[s];
  strength.querySelector(".strength-label").textContent = pass.value ? labels[s] : "";
}

function setMode(next) {
  mode = next;
  const setup = mode === "setup";
  title.textContent = setup ? "Criar acesso" : "Entrar";
  desc.textContent = setup ? "Primeira vez por aqui: escolha o usuário e uma senha forte para proteger os dados da oficina." : "Use o usuário e a senha desta instalação.";
  document.title = `${setup ? "Criar acesso" : "Entrar"} · RZ Airsoft`;
  pass.autocomplete = setup ? "new-password" : "current-password";
  confirmField.hidden = !setup;
  confirmInput.required = setup;
  strength.hidden = !setup;
  remember.hidden = setup;
  $("forgot").hidden = setup;
  $("username-hint").hidden = !setup;
  submit.textContent = setup ? "Criar acesso e entrar" : "Entrar";
  status.hidden = true;
  form.hidden = false;
  user.focus();
}

function validate() {
  user.value = user.value.trim();
  if (!USER_RE.test(user.value)) {
    showError("Usuário inválido: use de 3 a 32 caracteres (letras, números, ponto, hífen ou sublinhado).", user);
    return false;
  }
  if (pass.value.length < 8) {
    showError("A senha precisa ter pelo menos 8 caracteres.", pass);
    return false;
  }
  if (mode === "setup" && pass.value !== confirmInput.value) {
    showError("A confirmação não confere com a senha.", confirmInput);
    return false;
  }
  showError("");
  return true;
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy || !validate()) return;
  setBusy(true);
  try {
    if (mode === "setup") {
      await api("POST", "/auth/setup", { json: { username: user.value, password: pass.value } });
    } else {
      await api("POST", "/auth/login", { json: { username: user.value, password: pass.value, remember: $("remember").checked } });
    }
    pass.value = "";
    confirmInput.value = "";
    location.replace(safeNext());
  } catch (error) {
    setBusy(false);
    if (!(error instanceof ApiError)) return showError("Algo deu errado. Tente de novo.");
    if (error.status === 0) return showError("Sem conexão com o servidor. Confira se a janela do RZ Airsoft está aberta.");
    if (error.status === 429) {
      const wait = Number(error.body?.retryAfter) || 60;
      return showError(`Muitas tentativas. Aguarde ${wait >= 120 ? `${Math.ceil(wait / 60)} minutos` : `${wait} segundos`} e tente de novo.`, pass);
    }
    if (error.status === 401) return showError("Usuário ou senha incorretos.", pass);
    if (error.status === 409) {
      setMode("login");
      return showError("O acesso já foi criado. Entre com o usuário e a senha.", user);
    }
    if (error.status === 403) return showError("Bloqueado por segurança. Recarregue a página e tente de novo.");
    showError("Não foi possível entrar agora. Tente de novo.");
  }
}

eye.innerHTML = String(icon("eye", { size: 17 }));
eye.addEventListener("click", () => {
  const show = pass.type === "password";
  pass.type = show ? "text" : "password";
  eye.setAttribute("aria-pressed", String(show));
  eye.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
  eye.innerHTML = String(icon(show ? "eyeOff" : "eye", { size: 17 }));
});
pass.addEventListener("input", () => mode === "setup" && paintStrength());
form.addEventListener("submit", onSubmit);

(async () => {
  try {
    const session = await api("GET", "/session");
    if (session.authenticated && !session.setupRequired) {
      location.replace(safeNext());
      return;
    }
    setMode(session.setupRequired ? "setup" : "login");
  } catch {
    status.textContent = "Não foi possível falar com o servidor. Abra o sistema pelo atalho INICIAR_RZ_WEB.bat neste computador.";
  }
})();
