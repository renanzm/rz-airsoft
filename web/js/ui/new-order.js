/* Diálogo "Nova ordem de serviço": cliente (com busca), equipamento, problema. */
import { html } from "../core/dom.js";
import * as data from "../core/data.js";
import { EQUIPMENT_TYPES, findClientByName, newClient, newOrder, nextOrderNumber } from "../core/model.js";
import { maskPhone, phone as fmtPhone, todayISO } from "../core/format.js";
import { uid } from "../core/util.js";
import { navigate } from "../core/router.js";
import { modal } from "./dialog.js";
import { attachCombo } from "./combobox.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";

export function openNewOrder({ clientId = "", equipmentId = "" } = {}) {
  const settings = data.settings();
  const orders = data.orders();
  const number = nextOrderNumber(orders, settings);
  const preset = clientId ? data.client(clientId) : null;
  let chosen = preset ? { id: preset.id, name: preset.name, phone: preset.phone } : null;

  const equipmentOptions = (client) =>
    (client?.equipment || []).map((e) => html`<option value="${e.id}"${e.id === equipmentId ? " selected" : ""}>${[e.model, e.brand].filter(Boolean).join(" · ") || "Sem modelo"}</option>`);

  const { el, close } = modal({
    title: "Nova ordem de serviço",
    description: "Registre a entrada do equipamento. O resto você completa na OS.",
    size: "lg",
    content: html`
      <form class="stack-lg" data-form novalidate>
        <div class="grid-3">
          <label class="field">
            <span class="label">Número da OS</span>
            <input class="input mono" name="number" value="${number}" autocomplete="off" required />
          </label>
          <label class="field">
            <span class="label">Data de entrada</span>
            <input class="input" type="date" name="receivedAt" value="${todayISO()}" />
          </label>
          <label class="field">
            <span class="label">Previsão de entrega</span>
            <input class="input" type="date" name="dueAt" />
          </label>
        </div>

        <fieldset class="fieldset">
          <legend class="section-title">Cliente</legend>
          <div class="grid-2">
            <label class="field">
              <span class="label">Nome <span class="req">*</span></span>
              <div class="combo input-wrap">
                ${icon("search", { size: 15 })}
                <input class="input" name="clientName" placeholder="Buscar ou cadastrar cliente" value="${preset?.name || ""}" required autofocus />
              </div>
              <span class="field-error" data-error="clientName" hidden></span>
            </label>
            <label class="field">
              <span class="label">WhatsApp / telefone</span>
              <input class="input" name="clientPhone" inputmode="tel" placeholder="(48) 99999-9999" value="${preset ? fmtPhone(preset.phone) : ""}" />
            </label>
          </div>
          <p class="hint" data-client-hint>${preset ? "Cliente já cadastrado." : "Se o nome não existir, o cliente é cadastrado junto com a OS."}</p>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="section-title">Equipamento</legend>
          <div class="field" data-equip-pick ${preset?.equipment?.length ? "" : "hidden"}>
            <span class="label">Equipamento do cliente</span>
            <select class="select" name="equipmentId">
              <option value="">Outro equipamento…</option>
              ${equipmentOptions(preset)}
            </select>
          </div>
          <div class="grid-3" data-equip-fields>
            <label class="field">
              <span class="label">Tipo</span>
              <select class="select" name="type">${EQUIPMENT_TYPES.map((t) => html`<option>${t}</option>`)}</select>
            </label>
            <label class="field">
              <span class="label">Modelo</span>
              <input class="input" name="model" placeholder="M4, AK, Scar…" autocomplete="off" />
            </label>
            <label class="field">
              <span class="label">Fabricante</span>
              <input class="input" name="brand" placeholder="G&G, Cyma, Rossi…" autocomplete="off" />
            </label>
          </div>
        </fieldset>

        <label class="field">
          <span class="label">Problema relatado</span>
          <textarea class="textarea" name="problem" rows="3" placeholder="O que o cliente relatou? Ex.: baixo FPS, nozzle quebrado, não dispara…"></textarea>
        </label>
      </form>
    `,
    footer: html`
      <span class="hint spacer">${icon("info", { size: 13 })} Atalho: tecla N em qualquer tela</span>
      <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
      <button type="button" class="btn btn-primary" data-create>${icon("plus", { size: 16 })}Criar OS</button>
    `,
  });

  const form = el.querySelector("[data-form]");
  const nameInput = form.elements.clientName;
  const phoneInput = form.elements.clientPhone;
  const hint = el.querySelector("[data-client-hint]");
  const pickWrap = el.querySelector("[data-equip-pick]");
  const pickSelect = form.elements.equipmentId;
  const equipFields = el.querySelector("[data-equip-fields]");

  const syncEquip = () => {
    const client = chosen?.id ? data.client(chosen.id) : null;
    const has = Boolean(client?.equipment?.length);
    pickWrap.hidden = !has;
    if (has && pickSelect.dataset.client !== client.id) {
      pickSelect.innerHTML = `<option value="">Outro equipamento…</option>` + String(html`${equipmentOptions(client)}`);
      pickSelect.dataset.client = client.id;
      if (!equipmentId && client.equipment.length === 1) pickSelect.value = client.equipment[0].id;
    }
    equipFields.hidden = has && Boolean(pickSelect.value);
  };
  if (preset) pickSelect.dataset.client = preset.id;
  syncEquip();
  pickSelect.addEventListener("change", syncEquip);

  attachCombo(nameInput, {
    source: () =>
      data.clients().map((c) => ({
        id: c.id,
        label: c.name,
        detail: [fmtPhone(c.phone), c.equipment.map((e) => e.model).filter(Boolean).join(", ")].filter(Boolean).join(" · "),
        keywords: c.phone,
        prefix: html`<span class="avatar avatar-sm">${(c.name || "?").slice(0, 2).toUpperCase()}</span>`,
      })),
    onSelect: (option) => {
      const client = data.client(option.id);
      chosen = { id: client.id, name: client.name, phone: client.phone };
      nameInput.value = client.name;
      phoneInput.value = fmtPhone(client.phone);
      hint.textContent = "Cliente já cadastrado.";
      syncEquip();
      form.elements.model.focus();
    },
    createLabel: (q) => `Cadastrar “${q}” como novo cliente`,
    onCreate: (q) => {
      chosen = null;
      nameInput.value = q;
      hint.textContent = "Novo cliente: será cadastrado ao criar a OS.";
      syncEquip();
      phoneInput.focus();
    },
  });

  nameInput.addEventListener("input", () => {
    if (chosen && chosen.name !== nameInput.value) {
      chosen = null;
      hint.textContent = "Se o nome não existir, o cliente é cadastrado junto com a OS.";
      syncEquip();
    }
    el.querySelector('[data-error="clientName"]').hidden = true;
    nameInput.removeAttribute("aria-invalid");
  });
  phoneInput.addEventListener("input", () => {
    phoneInput.value = maskPhone(phoneInput.value);
  });

  const submit = () => {
    const f = form.elements;
    const name = f.clientName.value.trim();
    if (!name) {
      const err = el.querySelector('[data-error="clientName"]');
      err.textContent = "Informe o nome do cliente.";
      err.hidden = false;
      f.clientName.setAttribute("aria-invalid", "true");
      f.clientName.focus();
      return;
    }
    const numberValue = f.number.value.trim();
    if (numberValue && data.orders().some((o) => o.number === numberValue)) {
      toast.error(`Já existe uma OS com o número ${numberValue}.`, { description: "Use outro número para não confundir os relatórios." });
      f.number.focus();
      return;
    }

    // cliente: existente, achado pelo nome ou novo
    let client = chosen?.id ? data.client(chosen.id) : findClientByName(data.clients(), name);
    const phoneDigits = f.clientPhone.value.replace(/\D/g, "");
    if (!client) {
      client = data.saveClient(newClient({ name, phone: phoneDigits }));
    } else if (phoneDigits && phoneDigits !== String(client.phone || "").replace(/\D/g, "")) {
      client = data.saveClient({ ...client, phone: phoneDigits });
    }

    // equipamento: escolhido da ficha ou digitado (e guardado na ficha)
    let equipment;
    const picked = client.equipment.find((e) => e.id === f.equipmentId.value);
    if (picked && equipFields.hidden) {
      equipment = { type: picked.type || "AEG", model: picked.model, brand: picked.brand, serial: picked.serial || "", id: picked.id };
    } else {
      equipment = { type: f.type.value, model: f.model.value.trim(), brand: f.brand.value.trim(), serial: "" };
      if (equipment.model || equipment.brand) {
        const known = client.equipment.find((e) => (e.model || "").toLowerCase() === equipment.model.toLowerCase() && (e.brand || "").toLowerCase() === equipment.brand.toLowerCase());
        if (known) equipment.id = known.id;
        else {
          equipment.id = uid("e");
          client = data.saveClient({ ...client, equipment: [...client.equipment, { ...equipment, notes: "" }] });
        }
      }
    }

    const order = newOrder(settings, {
      number: numberValue,
      receivedAt: f.receivedAt.value || todayISO(),
      dueAt: f.dueAt.value,
      client: { id: client.id, name: client.name, phone: client.phone },
      equipment,
      problem: f.problem.value.trim(),
    });
    data.saveOrder(order);
    close("created");
    toast.success(`OS ${order.number || ""} criada`.replace("  ", " "), { description: `${client.name}${equipment.model ? " · " + equipment.model : ""}` });
    navigate(`/ordens/${order.id}`);
  };

  el.querySelector("[data-create]").addEventListener("click", submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
  });
}
