// Regras das ordens de serviço. Rode com: node --test tests/web/
import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../../web/js/core/model.js";

const settings = m.settingsWithDefaults({});

test("numeração segue o formato da última OS", () => {
  assert.equal(m.nextOrderNumber([], settings), "0001");
  assert.equal(m.nextOrderNumber([{ number: "0006" }, { number: "0002" }], settings), "0007");
  assert.equal(m.nextOrderNumber([{ number: "101" }, { number: "102" }], settings), "103");
  assert.equal(m.nextOrderNumber([{ number: "OS-12" }, { number: "" }], settings), "13");
  assert.equal(m.nextOrderNumber([], m.settingsWithDefaults({ orders: { digits: 3 } })), "001");
});

test("total com itens e desconto (centavos)", () => {
  const order = m.newOrder(settings, {
    items: [
      { description: "Revisão", qty: 1, price: 15000 },
      { description: "Mola", qty: 2, price: 4550 },
    ],
    discount: 1000,
  });
  assert.equal(m.subtotal(order), 24100);
  assert.equal(m.orderTotal(order), 23100);
  assert.equal(m.orderTotal({ ...order, discount: 999999 }), 0);
});

test("ganho de FPS só com as duas medições", () => {
  const order = m.newOrder(settings);
  assert.equal(m.fpsGain(order), null);
  order.fps.before.g20 = 310;
  order.fps.after.g20 = 385;
  assert.equal(m.fpsGain(order), 75);
});

test("mudança de status entra no histórico e marca a entrega", () => {
  let order = m.newOrder(settings);
  order = m.withStatus(order, "bancada");
  order = m.withStatus(order, "entregue");
  assert.deepEqual(order.events.slice(1).map((e) => e.to), ["bancada", "entregue"]);
  assert.ok(order.deliveredAt);
  order = m.withStatus(order, "pronto");
  assert.equal(order.deliveredAt, "");
  assert.equal(m.withStatus(order, "pronto"), order);
});

test("normalizeOrder completa documentos antigos ou incompletos", () => {
  const order = m.normalizeOrder({ id: "o_1", status: "inexistente", report: { diagnosis: "x" } });
  assert.equal(order.status, "fila");
  assert.deepEqual(order.report.diagnosis, []);
  assert.deepEqual(order.items, []);
  assert.equal(order.fps.after.g28, null);
});

test("cliente encontrado pelo nome sem acento e sem diferença de caixa", () => {
  const clients = [m.newClient({ name: "José Antônio" })];
  assert.equal(m.findClientByName(clients, "jose antonio")?.name, "José Antônio");
  assert.equal(m.findClientByName(clients, "Maria"), null);
});

test("mensagem de WhatsApp de OS pronta", () => {
  const order = m.newOrder(settings, { number: "0012", status: "pronto", client: { name: "Bruno Lima" }, equipment: { model: "M4", brand: "G&G" } });
  const text = m.whatsappMessage(order, settings);
  assert.match(text, /^Olá, Bruno!/);
  assert.match(text, /M4 · G&G \(OS 0012\) está pronta para retirada/);
});
