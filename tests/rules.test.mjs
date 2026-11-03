import test from "node:test";
import assert from "node:assert/strict";
import { rollQueue, created, makeActor } from "./stubs.mjs";

const { default: VitruviumDie } = await import("../system/module/dice/vitruvium-die.mjs");
const { prepareCheck, rollCheck } = await import("../system/module/dice/check.mjs");
const { findForbiddenDie } = await import("../system/module/dice/dice-guard.mjs");
const { normalizeLists, parseScale } = await import("../system/module/sheets/actor-sheet.mjs");

test("грани кубика: три пустые, две с одним успехом, одна с двумя", () => {
  const counts = [1, 2, 3, 4, 5, 6].map(f => VitruviumDie.successesFor(f));
  assert.equal(counts.filter(n => n === 0).length, 3);
  assert.equal(counts.filter(n => n === 1).length, 2);
  assert.equal(counts.filter(n => n === 2).length, 1);
});

test("итог кубика считает символы успеха по активным результатам", () => {
  const d = new VitruviumDie({ number: 3 });
  d._evaluated = true;
  d.results = [{ result: 6, active: true }, { result: 4, active: true }, { result: 2, active: true }, { result: 6, active: false }];
  assert.equal(d.faces, 6);
  assert.equal(d.total, 3);
});

test("кубиков: характеристика + домен + 1 за вдохновение, не больше 6", () => {
  const actor = makeActor({ chars: { physique: 3 }, inspiration: 2, domains: [{ level: 3 }] });
  const p = prepareCheck(actor, { characteristic: "physique", domainId: "d0", inspireDie: true });
  assert.equal(p.rawDice, 7);
  assert.equal(p.dice, 6);
  assert.equal(p.capped, true);
  const q = prepareCheck(actor, { characteristic: "physique" });
  assert.equal(q.dice, 3);
});

test("домен как самостоятельная способность бросает уровень домена", () => {
  const actor = makeActor({ domains: [{ level: 2 }] });
  assert.equal(prepareCheck(actor, { characteristic: null, domainId: "d0" }).dice, 2);
});

test("преимущества и помехи: не больше двух, гасят друг друга", () => {
  const actor = makeActor();
  assert.equal(prepareCheck(actor, { characteristic: "will", advantages: 5 }).net, 2);
  assert.equal(prepareCheck(actor, { characteristic: "will", advantages: 2, hindrances: 1 }).net, 1);
  assert.equal(prepareCheck(actor, { characteristic: "will", advantages: 1, hindrances: 1 }).net, 0);
});

test("вдохновение за способность даёт успехи по уровню домена и только с доменом", () => {
  const actor = makeActor({ inspiration: 3, domains: [{ level: 2 }] });
  assert.equal(prepareCheck(actor, { characteristic: "will", domainId: "d0", inspireSuccesses: true }).bonus, 2);
  assert.equal(prepareCheck(actor, { characteristic: "will", inspireSuccesses: true }).bonus, 0);
  assert.equal(prepareCheck(actor, { characteristic: "will", domainId: "d0", inspireSuccesses: true, inspireDie: true }).spend, 2);
});

test("преимущество засчитывает лучший бросок, сложность сравнивается с успехами", async () => {
  const actor = makeActor({ chars: { will: 2 } });
  rollQueue.push([1, 2], [6, 4]); // 0 успехов и 3 успеха
  await rollCheck(actor, { characteristic: "will", advantages: 1, difficulty: 3 });
  const flag = created.at(-1).flags.vitruvium.check;
  assert.equal(flag.successes, 3);
  assert.equal(flag.outcome, "success");
});

test("помеха засчитывает худший бросок", async () => {
  const actor = makeActor({ chars: { will: 2 } });
  rollQueue.push([6, 6], [4, 1]); // 4 и 1
  await rollCheck(actor, { characteristic: "will", hindrances: 1, difficulty: 2 });
  const flag = created.at(-1).flags.vitruvium.check;
  assert.equal(flag.successes, 1);
  assert.equal(flag.outcome, "failure");
});

test("вдохновение списывается, без запаса проверка не идёт", async () => {
  const actor = makeActor({ chars: { will: 1 }, inspiration: 1, domains: [{ level: 3 }] });
  rollQueue.push([1, 1, 1, 1, 1]);
  await rollCheck(actor, { characteristic: "will", domainId: "d0", inspireDie: true });
  assert.equal(actor.system.inspiration.value, 0);
  const before = created.length;
  const res = await rollCheck(actor, { characteristic: "will", inspireDie: true });
  assert.equal(res, null);
  assert.equal(created.length, before);
});

test("без сложности итог не присуждается", async () => {
  const actor = makeActor();
  rollQueue.push([6]);
  await rollCheck(actor, { characteristic: "movement" });
  assert.equal(created.at(-1).flags.vitruvium.check.outcome, null);
});

test("запрещены все кубы, кроме шестигранных", () => {
  const { Die } = foundry.dice.terms;
  const ok = { terms: [new Die({ number: 2, faces: 6 }), new VitruviumDie({ number: 1 })] };
  const bad = { terms: [new Die({ number: 1, faces: 20 })] };
  assert.equal(findForbiddenDie(ok), null);
  assert.ok(findForbiddenDie(bad));
});

test("шкала аспекта и списки из формы", () => {
  assert.deepEqual(parseScale("3 Идеально\n-1 Сомнения\n0"), [
    { value: 3, label: "Идеально" }, { value: -1, label: "Сомнения" }, { value: 0, label: "" }
  ]);
  const sys = { statuses: { 1: { name: "б" }, 0: { name: "а" } }, aspects: { 0: { name: "Д", scaleText: "1 Хорошо", statusesText: "отец, конкурент" } }, levels: { 0: { name: "Боезапас", value: 2, max: "" } } };
  normalizeLists(sys);
  assert.deepEqual(sys.statuses.map(s => s.name), ["а", "б"]);
  assert.deepEqual(sys.aspects[0].scale, [{ value: 1, label: "Хорошо" }]);
  assert.deepEqual(sys.aspects[0].statuses, ["отец", "конкурент"]);
  assert.equal(sys.levels[0].max, null);
});
