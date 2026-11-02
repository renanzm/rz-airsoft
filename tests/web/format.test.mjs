// Formatação pt-BR (dinheiro, datas, telefone, FPS). Rode com: node --test tests/web/
import { test } from "node:test";
import assert from "node:assert/strict";
import * as f from "../../web/js/core/format.js";

const nbsp = (s) => s.replace(/ /g, " ");

test("dinheiro em centavos", () => {
  assert.equal(nbsp(f.money(123456)), "R$ 1.234,56");
  assert.equal(nbsp(f.money(0)), "R$ 0,00");
  assert.equal(nbsp(f.money(null)), "R$ 0,00");
});

test("parseMoney entende os formatos do sistema antigo", () => {
  assert.equal(f.parseMoney("R$ 75,00"), 7500);
  assert.equal(f.parseMoney("R$ 1.234,56"), 123456);
  assert.equal(f.parseMoney("150"), 15000);
  assert.equal(f.parseMoney("75,5"), 7550);
  assert.equal(f.parseMoney("1.500"), 150000);
  assert.equal(f.parseMoney("12.5"), 1250);
  assert.equal(f.parseMoney(""), null);
  assert.equal(f.parseMoney("sob consulta"), null);
});

test("máscara de digitação trata os dígitos como centavos", () => {
  assert.equal(nbsp(f.maskMoney("12000")), "R$ 120,00");
  assert.equal(nbsp(f.maskMoney("R$ 120,005")), "R$ 1.200,05");
  assert.equal(f.maskMoney(""), "");
});

test("datas brasileiras viram ISO", () => {
  assert.equal(f.parseBrDate("20/03/2026"), "2026-03-20");
  assert.equal(f.parseBrDate("6/6/26"), "2026-06-06");
  assert.equal(f.parseBrDate("2026-10-24"), "2026-10-24");
  assert.equal(f.parseBrDate("31/02/2026"), "");
  assert.equal(f.parseBrDate("ontem"), "");
  assert.equal(f.date("2026-03-20"), "20/03/2026");
});

test("datas sem hora contam em dias", () => {
  assert.equal(f.relative(f.todayISO()), "hoje");
  assert.equal(f.daysBetween("2026-01-01", "2026-01-31"), 30);
});

test("telefone e WhatsApp", () => {
  assert.equal(f.phone("48996698376"), "(48) 99669-8376");
  assert.equal(f.phone("5548996698376"), "(48) 99669-8376");
  assert.equal(f.maskPhone("4899669"), "(48) 9966-9");
  assert.equal(f.whatsappLink("(48) 99669-8376", "Olá"), "https://wa.me/5548996698376?text=Ol%C3%A1");
  assert.equal(f.whatsappLink("123"), "");
});

test("FPS e energia em joules", () => {
  assert.equal(f.parseNumber("385"), 385);
  assert.equal(f.parseNumber("330,5"), 330.5);
  assert.equal(f.parseNumber("abc"), null);
  assert.ok(Math.abs(f.joules(385, 0.2) - 1.377) < 0.002);
  assert.equal(f.joules(0, 0.2), null);
  assert.equal(f.signed(75), "+75");
  assert.equal(f.signed(-5), "−5");
});
