import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveStageFit,
  bestFitRiderId,
  selectionComparator,
  selectionDefaultSortDir,
} from "./lineupInsight.js";

const rider = (id, suitability, stageSuitability) => ({ id, suitability, stageSuitability });

test("effectiveStageFit: bruger per-etape når stageIndex sat, ellers løb-snit", () => {
  const r = rider("r1", 70, [40, 90]);
  assert.equal(effectiveStageFit(r, 1), 90);
  assert.equal(effectiveStageFit(r, 0), 40);
  assert.equal(effectiveStageFit(r, null), 70);
});

test("effectiveStageFit: manglende stageSuitability → fald tilbage til løb-snit", () => {
  const r = rider("r1", 70, null);
  assert.equal(effectiveStageFit(r, 1), 70);
});

test("effectiveStageFit: intet fit → null", () => {
  assert.equal(effectiveStageFit(rider("r1", null, null), 0), null);
});

test("bestFitRiderId: id med højest effektiv fit blandt valgte (tiebreak id asc)", () => {
  const riders = [rider("r1", 50, [50, 60]), rider("r2", 50, [50, 80]), rider("r3", 50, [50, 80])];
  assert.equal(bestFitRiderId(riders, ["r1", "r2", "r3"], 1), "r2");
  assert.equal(bestFitRiderId(riders, ["r1"], 1), "r1");
  assert.equal(bestFitRiderId(riders, [], 1), null);
});

// #1951 — sortering på holdudtagelses-panelet.
const sortRider = (id, name, extra = {}) => ({ id, name, ...extra });

test("selectionDefaultSortDir: tekst asc-først, numerisk desc-først", () => {
  assert.equal(selectionDefaultSortDir("name"), "asc");
  assert.equal(selectionDefaultSortDir("primaryType"), "asc");
  assert.equal(selectionDefaultSortDir("routeMatch"), "desc");
  assert.equal(selectionDefaultSortDir("form"), "desc");
  assert.equal(selectionDefaultSortDir("fatigue"), "desc");
});

test("selectionComparator: navn sorteres med locale 'en' (Ä som A-variant, ikke til sidst som i 'da')", () => {
  // I 'en'-collation behandles Ä som en variant af A → mellem Anna og Zoe.
  // I 'da' ville Ä/Å sortere EFTER Z; testen sikrer at vi ikke bruger 'da'.
  const riders = [sortRider("r1", "Zoe"), sortRider("r2", "Anna"), sortRider("r3", "Ärnst")];
  const asc = [...riders].sort(selectionComparator("name", "asc")).map((r) => r.name);
  assert.deepEqual(asc, ["Anna", "Ärnst", "Zoe"]);
});

test("selectionComparator: numerisk form desc sætter højest øverst", () => {
  const riders = [sortRider("r1", "A", { form: 40 }), sortRider("r2", "B", { form: 90 }), sortRider("r3", "C", { form: 70 })];
  const desc = [...riders].sort(selectionComparator("form", "desc")).map((r) => r.id);
  assert.deepEqual(desc, ["r2", "r3", "r1"]);
});

test("selectionComparator: manglende numerisk værdi sorteres altid sidst", () => {
  const riders = [sortRider("r1", "A", { fatigue: 30 }), sortRider("r2", "B", {}), sortRider("r3", "C", { fatigue: 10 })];
  assert.deepEqual([...riders].sort(selectionComparator("fatigue", "asc")).map((r) => r.id), ["r3", "r1", "r2"]);
  assert.deepEqual([...riders].sort(selectionComparator("fatigue", "desc")).map((r) => r.id), ["r1", "r3", "r2"]);
});

test("selectionComparator: routeMatch bruger effektivt fit pr. etape", () => {
  const riders = [
    sortRider("r1", "A", { suitability: 50, stageSuitability: [50, 60] }),
    sortRider("r2", "B", { suitability: 50, stageSuitability: [50, 90] }),
  ];
  assert.deepEqual([...riders].sort(selectionComparator("routeMatch", "desc", 1)).map((r) => r.id), ["r2", "r1"]);
});

test("selectionComparator: stabil tiebreak på id ved lige værdier", () => {
  const riders = [sortRider("r2", "Tie", { form: 50 }), sortRider("r1", "Tie", { form: 50 })];
  assert.deepEqual([...riders].sort(selectionComparator("form", "desc")).map((r) => r.id), ["r1", "r2"]);
});
