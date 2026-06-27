import test from "node:test";
import assert from "node:assert/strict";
import { selectTierRaceSet, DEFAULT_TIER_CALENDAR } from "./tierRaceSelection.js";
import { packDivisionCalendar } from "./raceCalendarPacker.js";

// Syntetisk katalog: tier 3 = ProSeries + Class1; Class2 må IKKE vælges.
function catalog() {
  const rows = [];
  [8, 8, 8, 6, 5, 5, 5, 5, 5, 4, 4].forEach((st, i) => rows.push({ id: `ps-sr-${i}`, race_class: "ProSeries", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 35; i++) rows.push({ id: `ps-od-${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 7; i++) rows.push({ id: `c1-od-${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  rows.push({ id: "c2-sr-0", race_class: "Class2", race_type: "stage_race", stages: 3 });
  for (let i = 0; i < 9; i++) rows.push({ id: `c2-od-${i}`, race_class: "Class2", race_type: "single", stages: 1 });
  return rows;
}
const TIER3 = { catalog: catalog(), raceClasses: ["ProSeries", "Class1"], seed: 6, ...DEFAULT_TIER_CALENDAR[3] };

test("selectTierRaceSet: vælger det konfigurerede antal etapeløb + endagsløb", () => {
  const r = selectTierRaceSet(TIER3);
  assert.equal(r.stageRaceCount, 9);
  assert.equal(r.singleCount, 20);
});

test("selectTierRaceSet: vælger KUN løb fra tierens klasser (ingen Class2)", () => {
  const r = selectTierRaceSet(TIER3);
  const all = [...r.stageRaces, ...r.oneDayRaces].map((x) => x.id);
  assert.ok(all.every((id) => !id.startsWith("c2-")), `Class2-løb lækkede: ${all.filter((id) => id.startsWith("c2-"))}`);
});

test("selectTierRaceSet: markerer soloStageCount solo-løb = de største", () => {
  const r = selectTierRaceSet(TIER3);
  const solo = r.stageRaces.filter((s) => s.solo);
  assert.equal(solo.length, 3);
  const minSolo = Math.min(...solo.map((s) => s.stages));
  const maxNonSolo = Math.max(...r.stageRaces.filter((s) => !s.solo).map((s) => s.stages));
  assert.ok(minSolo >= maxNonSolo, "solo-løb skal være de største");
});

test("selectTierRaceSet: forcedOverlaps refererer kun valgte ikke-solo etapeløb", () => {
  const r = selectTierRaceSet(TIER3);
  const nonSolo = new Set(r.stageRaces.filter((s) => !s.solo).map((s) => s.id));
  assert.equal(r.forcedOverlaps.length, 2);
  for (const [a, b] of r.forcedOverlaps) {
    assert.ok(nonSolo.has(a) && nonSolo.has(b), `overlap-par ${a}/${b} ikke begge ikke-solo valgte`);
  }
});

test("selectTierRaceSet: deterministisk (samme seed) + seed-følsom", () => {
  assert.deepEqual(selectTierRaceSet(TIER3), selectTierRaceSet(TIER3));
  const other = selectTierRaceSet({ ...TIER3, seed: 999 });
  const a = selectTierRaceSet(TIER3).stageRaces.map((s) => s.id).join(",");
  const b = other.stageRaces.map((s) => s.id).join(",");
  assert.notEqual(a, b, "forskellig seed bør give forskelligt udvalg");
});

test("selectTierRaceSet: beskærer + rapporterer når kataloget er for lille (tier 4-loft)", () => {
  const small = { catalog: catalog(), raceClasses: ["Class2"], seed: 1, stageRaceCount: 8, singleCount: 16, soloStageCount: 2, overlapPairCount: 1 };
  const r = selectTierRaceSet(small);
  assert.equal(r.stageRaceCount, 1, "Class2 har kun 1 etapeløb i kataloget");
  assert.equal(r.truncatedStages, 7);
  assert.equal(r.singleCount, 9);
  assert.equal(r.truncatedSingles, 7);
});

test("integration: selectTierRaceSet → packDivisionCalendar fylder hver dag uden uplacerede", () => {
  const sel = selectTierRaceSet(TIER3);
  const packed = packDivisionCalendar({
    stageRaces: sel.stageRaces, oneDayRaces: sel.oneDayRaces, forcedOverlaps: sel.forcedOverlaps,
    realDays: 28, maxStagesPerRealDay: 5, maxConcurrentStageRaces: 2,
  });
  assert.equal(packed.emptyDays, 0, `tomme dage: load=${packed.load.join(",")}`);
  assert.deepEqual(packed.unplacedStages, []);
  assert.ok(packed.stageLoad.some((c) => c >= 2), "mindst ét etapeløb-på-etapeløb overlap");
});
