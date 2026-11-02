// Merge de três vias usado quando a mesma OS muda em dois aparelhos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3 } from "../../web/js/core/store.js";
import { html, raw, esc } from "../../web/js/core/dom.js";

test("campos diferentes mudados em cada lado são combinados", () => {
  const base = { problem: "a", notes: "x", fps: { before: { g20: 300 }, after: { g20: null } } };
  const local = { ...base, problem: "editado aqui", fps: { before: { g20: 300 }, after: { g20: 350 } } };
  const remote = { ...base, notes: "editado lá", fps: { before: { g20: 310 }, after: { g20: null } } };
  assert.deepEqual(merge3(base, local, remote), {
    problem: "editado aqui",
    notes: "editado lá",
    fps: { before: { g20: 310 }, after: { g20: 350 } },
  });
});

test("choque no mesmo campo: vale este aparelho", () => {
  assert.deepEqual(merge3({ a: 1 }, { a: 2 }, { a: 3 }), { a: 2 });
});

test("listas são tratadas como um valor só", () => {
  const base = { items: [1] };
  assert.deepEqual(merge3(base, base, { items: [1, 2] }), { items: [1, 2] });
  assert.deepEqual(merge3(base, { items: [9] }, { items: [1, 2] }), { items: [9] });
});

test("sem base conhecida, o local prevalece e o remoto completa", () => {
  assert.deepEqual(merge3(null, { a: 1 }, { a: 2, b: 3 }), { a: 1, b: 3 });
});

test("templates escapam tudo que vem de dados", () => {
  const name = '<img src=x onerror="alert(1)">';
  const out = String(html`<p title="${name}">${name}</p>`);
  assert.ok(!out.includes("<img"));
  assert.equal(out, `<p title="${esc(name)}">${esc(name)}</p>`);
  assert.equal(String(html`${[1, 2]}|${null}|${false}|${0}`), "12|||0");
  assert.equal(String(html`${raw("<b>ok</b>")}`), "<b>ok</b>");
});
