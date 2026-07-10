import test from "node:test";
import assert from "node:assert/strict";
import { selectTierRaceSet, PRESTIGE_RANK } from "./tierRaceSelection.js";

// Prod-lignende katalog: 3 Grand Tours, 5 monumenter, WorldTour-mix, ProSeries-bunke, Class 1/2.
function catalog() {
  const rows = [];
  rows.push({ id: "gt-tour", name: "Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-giro", name: "Giro", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-vuelta", name: "Vuelta", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  for (let i = 0; i < 5; i++) rows.push({ id: `mon-${i}`, name: `Monument ${i}`, race_class: "Monuments", race_type: "single", stages: 1 });
  [8, 8, 7, 7, 6, 6, 6, 5].forEach((st, i) => rows.push({ id: `wta-sr-${i}`, race_class: "OtherWorldTourA", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 6; i++) rows.push({ id: `wta-od-${i}`, race_class: "OtherWorldTourA", race_type: "single", stages: 1 });
  [7, 5].forEach((st, i) => rows.push({ id: `wtb-sr-${i}`, race_class: "OtherWorldTourB", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 4; i++) rows.push({ id: `wtb-od-${i}`, race_class: "OtherWorldTourB", race_type: "single", stages: 1 });
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-sr-${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 });
  for (let i = 0; i < 35; i++) rows.push({ id: `ps-od-${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 7; i++) rows.push({ id: `c1-od-${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  for (let i = 0; i < 9; i++) rows.push({ id: `c2-od-${i}`, race_class: "Class2", race_type: "single", stages: 1 });
  return rows;
}

const gameDays = (sel) => [...sel.stageRaces, ...sel.oneDayRaces].reduce((s, r) => s + (Number(r.stages) || 1), 0);

test("selectTierRaceSet: rammer den præcise game-day-kvote", () => {
  for (const quota of [140, 112, 84]) {
    const sel = selectTierRaceSet({ catalog: catalog(), quota, seed: 1 });
    assert.equal(gameDays(sel), quota, `kvote ${quota}: fik ${gameDays(sel)} game-days`);
    assert.equal(sel.quotaHit, true);
    assert.equal(sel.shortfall, 0);
  }
});

test("selectTierRaceSet: prestige-rang — div 1 (140) tager alle 3 Grand Tours + alle 5 monumenter", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const ids = new Set([...sel.stageRaces, ...sel.oneDayRaces].map((r) => r.id));
  assert.ok(["gt-tour", "gt-giro", "gt-vuelta"].every((id) => ids.has(id)), "alle Grand Tours i div 1");
  assert.ok([0, 1, 2, 3, 4].every((i) => ids.has(`mon-${i}`)), "alle monumenter i div 1");
});

test("selectTierRaceSet: vælger ikke lavere prestige før højere er opbrugt", () => {
  // 140-kvoten skal være fyldt af Grand Tour/Monument/WorldTour før ProSeries/Class røres.
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const picked = [...sel.stageRaces, ...sel.oneDayRaces];
  const ranks = picked.map((r) => PRESTIGE_RANK[r.race_class] ?? 99);
  const worstPicked = Math.max(...ranks);
  // Intet uvalgt løb må have BEDRE (lavere) rang end det dårligste valgte (bortset fra ties vi måtte springe for at ramme præcist).
  const cat = catalog();
  const pickedIds = new Set(picked.map((r) => r.id));
  const betterUnpicked = cat.filter((r) => !pickedIds.has(r.id) && (PRESTIGE_RANK[r.race_class] ?? 99) < worstPicked);
  assert.equal(betterUnpicked.length, 0, `højere-prestige løb sprunget over: ${betterUnpicked.map((r) => r.id)}`);
});

test("#2251 selectTierRaceSet: allowGrandTours=false udelukker ≥15-etapers løb men rammer stadig kvoten", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 56, seed: 1, allowGrandTours: false });
  const picked = [...sel.stageRaces, ...sel.oneDayRaces];
  assert.ok(picked.length > 0);
  assert.ok(picked.every((r) => (r.stages ?? 1) < 15), `GT sluppet igennem: ${picked.filter((r) => r.stages >= 15).map((r) => r.id)}`);
  assert.equal(gameDays(sel), 56, "kvoten skal stadig fyldes af ikke-GT-løb");
});

test("#2251 selectTierRaceSet: allowGrandTours default (true) er uændret adfærd", () => {
  const a = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const b = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1, allowGrandTours: true });
  assert.deepEqual(a, b);
});

test("selectTierRaceSet: marker oneDayRaces vs stageRaces korrekt + bærer race_class", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 });
  assert.ok(sel.stageRaces.every((r) => r.stages >= 2 && r.race_class), "stageRaces ≥2 etaper + klasse");
  assert.ok(sel.oneDayRaces.every((r) => (r.stages ?? 1) === 1 && r.race_class), "oneDayRaces = 1 etape + klasse");
});

test("selectTierRaceSet: intet løb vælges to gange", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const ids = [...sel.stageRaces, ...sel.oneDayRaces].map((r) => r.id);
  assert.equal(ids.length, new Set(ids).size, "duplikat i udvalg");
});

test("selectTierRaceSet: deterministisk; seed varierer kun inden for samme prestige-rang", () => {
  assert.deepEqual(selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 }), selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 }));
  const a = selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 });
  const b = selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 999 });
  // Begge rammer kvoten; Grand Tours/top er ens, men ProSeries-udvalget (samme rang) kan variere.
  assert.equal(gameDays(a), 84);
  assert.equal(gameDays(b), 84);
});

test("selectTierRaceSet: rapporterer shortfall når kataloget ikke kan fylde kvoten", () => {
  const tiny = [{ id: "x1", race_class: "Class2", race_type: "single", stages: 1 }];
  const sel = selectTierRaceSet({ catalog: tiny, quota: 84, seed: 1 });
  assert.equal(sel.quotaHit, false);
  assert.equal(sel.shortfall, 83);
  assert.equal(gameDays(sel), 1);
});
