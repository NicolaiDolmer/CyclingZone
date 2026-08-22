// #3750/#4000 — tests for den rene logik bag admin-siden "Værdi-overgangen".
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  C_PRESETS,
  buildValueRows,
  buildSalaryRows,
  deltaPct,
  filterRows,
  sortRows,
  summarize,
  typeOptions,
} from "./adminValueTransitionShape.js";

const ROWS = [
  { riderId: "a", name: "Andrea Riva", teamName: "Aquila", teamIsAi: false, valuationType: "puncheur", primaryType: "puncheur", valueNow: 23756219, valueDamped: 5129549, salaryNow: 538476, salaryExpected: 116311, salaryExpectedNoDamp: 538476 },
  { riderId: "b", name: "Berta Klatre", teamName: "Bjergholdet", teamIsAi: false, valuationType: "climber", primaryType: "rouleur", valueNow: 100000, valueDamped: 121900, salaryNow: 1000, salaryExpected: 1100, salaryExpectedNoDamp: 1050 },
  { riderId: "c", name: "Carl Cpu", teamName: "AI-holdet", teamIsAi: true, valuationType: "tt", primaryType: "tt", valueNow: 50000, valueDamped: 61850, salaryNow: 500, salaryExpected: null, salaryExpectedNoDamp: 600 },
];

test("deltaPct: procent mod før-værdien; null når før mangler/er 0 eller efter mangler", () => {
  assert.equal(deltaPct(100, 89), -11);
  assert.equal(deltaPct(0, 50), null);
  assert.equal(deltaPct(null, 50), null);
  assert.equal(deltaPct(100, null), null);
});

test("buildValueRows: efter = round(dæmpet × c); delta regnes mod værdien i dag", () => {
  const [riva] = buildValueRows(ROWS, C_PRESETS.fresh);
  assert.equal(riva.valueAfter, Math.round(5129549 * 0.894));
  assert.ok(riva.valueDeltaPct < -80 && riva.valueDeltaPct > -81);
  const [, klatre] = buildValueRows(ROWS, C_PRESETS.fresh);
  assert.ok(klatre.valueDeltaPct > 8 && klatre.valueDeltaPct < 10, "almindelig type stiger let under c=0,894");
});

test("buildValueRows: valueDamped=null ⇒ efter/delta = null (aldrig et gættet tal)", () => {
  const rows = buildValueRows([{ valueNow: 1000, valueDamped: null }], 0.9);
  assert.equal(rows[0].valueAfter, null);
  assert.equal(rows[0].valueDeltaPct, null);
});

test("buildSalaryRows: delta for både dæmpet og u-dæmpet forventning; null bevares", () => {
  const [riva, , cpu] = buildSalaryRows(ROWS);
  assert.ok(riva.salaryDeltaPct < -78);
  assert.equal(riva.salaryDeltaNoDampPct, 0);
  assert.equal(cpu.salaryDeltaPct, null);
});

test("filterRows: includeAcademy=false holder akademiryttere ude (værdi-fanen), default tager dem med (løn-fanen)", () => {
  const rows = [...ROWS, { riderId: "d", name: "Ditte Akademi", teamName: "Aquila", teamIsAi: false, isAcademy: true, valuationType: "climber", valueNow: 3000, valueDamped: null, salaryNow: 900, salaryExpected: 2100, salaryExpectedNoDamp: 2100 }];
  assert.deepEqual(filterRows(rows, { includeAcademy: false }).map((r) => r.riderId), ["a", "b"]);
  assert.deepEqual(filterRows(rows).map((r) => r.riderId), ["a", "b", "d"]);
});

test("filterRows: humanOnly frasorterer AI-hold; type og søgning (navn ELLER hold) filtrerer", () => {
  assert.equal(filterRows(ROWS, { humanOnly: true }).length, 2);
  assert.equal(filterRows(ROWS, { humanOnly: false }).length, 3);
  assert.deepEqual(filterRows(ROWS, { humanOnly: false, type: "tt" }).map((r) => r.riderId), ["c"]);
  assert.deepEqual(filterRows(ROWS, { q: "bjerg" }).map((r) => r.riderId), ["b"]);
  assert.deepEqual(filterRows(ROWS, { q: "riva" }).map((r) => r.riderId), ["a"]);
});

test("sortRows: numerisk begge retninger, null altid sidst, strenge med da-collation", () => {
  const rows = buildValueRows(ROWS, 0.9);
  const desc = sortRows(rows, "valueNow", "desc").map((r) => r.riderId);
  assert.deepEqual(desc, ["a", "b", "c"]);
  const asc = sortRows(rows, "valueNow", "asc").map((r) => r.riderId);
  assert.deepEqual(asc, ["c", "b", "a"]);
  const salary = sortRows(buildSalaryRows(ROWS), "salaryExpected", "desc").map((r) => r.riderId);
  assert.equal(salary[salary.length - 1], "c", "null sorteres sidst");
  const byName = sortRows(rows, "name", "asc").map((r) => r.name);
  assert.deepEqual(byName, ["Andrea Riva", "Berta Klatre", "Carl Cpu"]);
});

test("summarize: summer før/efter over filtrerede rækker og regner samlet delta", () => {
  const s = summarize(buildValueRows(ROWS.slice(1, 2), 1), { beforeKey: "valueNow", afterKey: "valueAfter" });
  assert.equal(s.n, 1);
  assert.equal(s.before, 100000);
  assert.equal(s.after, 121900);
  assert.ok(Math.abs(s.deltaPct - 21.9) < 0.001);
});

test("typeOptions: unikke frosne typer, sorteret", () => {
  assert.deepEqual(typeOptions(ROWS), ["climber", "puncheur", "tt"]);
});
