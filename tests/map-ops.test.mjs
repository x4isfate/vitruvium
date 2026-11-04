// Черновики и заявки модуля карты: слияние правок, конфликты, план применения.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeOp, addToDraft, draftOps, applyOps, conflictOf, buildApplyPlan, changedFields,
  formatStatus, statusToAspect, randomId
} from "../modules/vitruvium-map/scripts/review/ops.mjs";

const city = (name, x = 0) => ({ name, text: "", system: { kind: "object", geometry: { x, y: 0 }, statuses: [], aspects: [] } });

test("тридцать перетаскиваний города дают одну правку с первой версией", () => {
  let draft = {};
  for ( let i = 0; i < 30; i++ ) draft = addToDraft(draft, { action: "update", id: "A", baseRev: i === 0 ? 3 : 99, state: city("Винтерфол", i) });
  const ops = draftOps(draft);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].baseRev, 3);
  assert.equal(ops[0].state.system.geometry.x, 29);
});

test("создал и удалил: в черновике пусто", () => {
  let draft = addToDraft({}, { action: "create", id: "N", state: city("Новый") });
  draft = addToDraft(draft, { action: "delete", id: "N", name: "Новый" });
  assert.deepEqual(draft, {});
});

test("создал и подвинул: остаётся созданием с новым положением", () => {
  const op = mergeOp({ action: "create", id: "N", state: city("Новый", 0) }, { action: "update", id: "N", baseRev: 0, state: city("Новый", 5) });
  assert.equal(op.action, "create");
  assert.equal(op.state.system.geometry.x, 5);
});

test("поправил и удалил: удаление помнит версию правки", () => {
  const op = mergeOp({ action: "update", id: "A", baseRev: 4, state: city("A") }, { action: "delete", id: "A" });
  assert.equal(op.action, "delete");
  assert.equal(op.baseRev, 4);
  assert.equal(op.name, "A");
});

test("порядок: создания, правки, удаления", () => {
  const draft = { b: { action: "delete", id: "b" }, a: { action: "update", id: "a", state: city("a") }, c: { action: "create", id: "c", state: city("c") } };
  assert.deepEqual(draftOps(draft).map(o => o.action), ["create", "update", "delete"]);
});

test("предпросмотр применяет правки и не трогает исходник", () => {
  const cur = new Map([["A", { id: "A", ...city("A") }], ["B", { id: "B", ...city("B") }]]);
  const out = applyOps(cur, [{ action: "delete", id: "B" }, { action: "create", id: "C", state: city("C") }]);
  assert.deepEqual([...out.keys()].sort(), ["A", "C"]);
  assert.equal(cur.size, 2);
});

test("конфликты", () => {
  assert.equal(conflictOf({ action: "create", id: "X" }, undefined), null);
  assert.equal(conflictOf({ action: "create", id: "X" }, 1), "exists");
  assert.equal(conflictOf({ action: "update", id: "X", baseRev: 2 }, undefined), "missing");
  assert.equal(conflictOf({ action: "update", id: "X", baseRev: 2 }, 3), "stale");
  assert.equal(conflictOf({ action: "delete", id: "X", baseRev: 3 }, 3), null);
});

test("план: версия растёт, устаревшее пропускается без force", () => {
  const revs = { A: 2, B: 5 };
  const ops = [
    { action: "create", id: "N", state: city("N") },
    { action: "update", id: "A", baseRev: 2, state: city("A2") },
    { action: "update", id: "B", baseRev: 4, state: city("B2") },
    { action: "delete", id: "Z", baseRev: 1 }
  ];
  const plan = buildApplyPlan(ops, id => revs[id]);
  assert.equal(plan.create[0].system.rev, 1);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].system.rev, 3);
  assert.deepEqual(plan.skipped.map(s => s.conflict), ["stale", "missing"]);
  const forced = buildApplyPlan(ops, id => revs[id], { force: true });
  assert.equal(forced.update.length, 2);
  assert.equal(forced.update[1].system.rev, 6);
  assert.deepEqual(forced.skipped.map(s => s.conflict), ["missing"]);
});

test("какие поля меняет правка", () => {
  const a = city("A"), b = { ...city("A", 10), name: "Б" };
  assert.deepEqual(changedFields(a, b), ["name", "geometry"]);
});

test("статус с уровнем и без, перевод в аспект", () => {
  assert.equal(formatStatus({ name: "Голод", value: 2, max: 10 }), "Голод (2/10)");
  assert.equal(formatStatus({ name: "Защищённая крепость", value: null }), "Защищённая крепость");
  const asp = statusToAspect({ name: "Осаждён Кумачами", value: 9, max: 10 }, "x");
  assert.equal(asp.value, 9);
  assert.equal(asp.max, 10);
  assert.deepEqual(asp.statuses, []);
});

test("id из 16 символов", () => {
  assert.match(randomId(), /^[A-Za-z0-9]{16}$/);
});
