import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusProgress, isBreakthrough, daySummary, breakthroughJumps, riderHistoryFromRuns,
  todayGainTotal,
  seasonAbilityGains, abilityReceipt, focusAbilityReceipt,
  PEAK_FORM_THRESHOLD, NEAR_BREAKTHROUGH,
} from "./trainingReport.js";

test("focusProgress: vælger fokus-evnen tættest på gennembrud", () => {
  // vo2max = climbing/punch/tempo. tempo er højest → vælges.
  const res = focusProgress("vo2max", { climbing: 0.2, punch: 0.5, tempo: 0.91 });
  assert.deepEqual(res, { ability: "tempo", pct: 91 });
});

test("focusProgress: null uden fokus eller uden data", () => {
  assert.equal(focusProgress(null, { climbing: 0.5 }), null);
  assert.equal(focusProgress("vo2max", null), null);
  assert.equal(focusProgress("vo2max", { sprint: 0.5 }), null); // ingen vo2max-evne i mappet
});

test("focusProgress: clamps og afrunder", () => {
  assert.deepEqual(focusProgress("sprint", { sprint: 0.005, acceleration: 0 }), { ability: "sprint", pct: 1 });
});

test("isBreakthrough: sandt når mindst én gevinst > 0", () => {
  assert.equal(isBreakthrough({ gains: { climbing: 1 } }), true);
  assert.equal(isBreakthrough({ gains: { climbing: 0 } }), false);
  assert.equal(isBreakthrough({ gains: {} }), false);
  assert.equal(isBreakthrough({}), false);
});

test("daySummary: tæller trænede, gennembrud, topform", () => {
  const rows = [
    { intensity: "normal", injured: false, gains: { climbing: 1 }, form: 75 }, // trænet + gennembrud + topform
    { intensity: "rest", injured: false, gains: {}, form: 80 },                // ikke trænet (rest), topform
    { intensity: "hard", injured: true, gains: {}, form: 40 },                 // skadet → ikke trænet
    { intensity: "easy", injured: false, gains: { sprint: 0 }, form: 70 },     // trænet, topform (=70)
  ];
  assert.deepEqual(daySummary(rows), { trained: 2, breakthroughs: 1, peakForm: 3, total: 4 });
});

test("daySummary: tomt input", () => {
  assert.deepEqual(daySummary(null), { trained: 0, breakthroughs: 0, peakForm: 0, total: 0 });
});

test("breakthroughJumps: bruger gains_detail når til stede", () => {
  const jumps = breakthroughJumps({ gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } });
  assert.deepEqual(jumps, [{ ability: "climbing", n: 1, from: 71, to: 72 }]);
});

test("breakthroughJumps: fallback til null from/to uden gains_detail", () => {
  const jumps = breakthroughJumps({ gains: { sprint: 2 } });
  assert.deepEqual(jumps, [{ ability: "sprint", n: 2, from: null, to: null }]);
});

test("konstanter eksporteret", () => {
  assert.equal(PEAK_FORM_THRESHOLD, 70);
  assert.equal(NEAR_BREAKTHROUGH, 0.9);
});

test("riderHistoryFromRuns: plukker rytterens linje pr. dag + bevarer metadata", () => {
  const runs = [
    {
      tick_date: "2026-06-20", executed_by: "manager", bonus_applied: true,
      report: { riders: [
        { rider_id: "r1", focus: "vo2max", intensity: "hard", gains: { climbing: 1 } },
        { rider_id: "r2", focus: "sprint", intensity: "easy", gains: {} },
      ] },
    },
    {
      tick_date: "2026-06-19", executed_by: "assistant", bonus_applied: false,
      report: { riders: [
        { rider_id: "r1", focus: "vo2max", intensity: "normal", gains: {} },
      ] },
    },
  ];
  const out = riderHistoryFromRuns(runs, "r1");
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    tick_date: "2026-06-20", executed_by: "manager", bonus_applied: true,
    row: { rider_id: "r1", focus: "vo2max", intensity: "hard", gains: { climbing: 1 } },
  });
  assert.equal(out[1].tick_date, "2026-06-19");
  assert.equal(out[1].row.intensity, "normal");
});

test("riderHistoryFromRuns: springer dage over hvor rytteren ikke indgik", () => {
  const runs = [
    { tick_date: "2026-06-20", executed_by: "manager", bonus_applied: false, report: { riders: [{ rider_id: "r2" }] } },
    { tick_date: "2026-06-19", executed_by: "manager", bonus_applied: false, report: { riders: [{ rider_id: "r1" }] } },
  ];
  const out = riderHistoryFromRuns(runs, "r1");
  assert.equal(out.length, 1);
  assert.equal(out[0].tick_date, "2026-06-19");
});

test("riderHistoryFromRuns: robust mod tomt/uvelformet input", () => {
  assert.deepEqual(riderHistoryFromRuns(null, "r1"), []);
  assert.deepEqual(riderHistoryFromRuns([], "r1"), []);
  assert.deepEqual(riderHistoryFromRuns([{ tick_date: "x", report: null }], "r1"), []);
  assert.deepEqual(riderHistoryFromRuns([{ tick_date: "x", report: { riders: [{ rider_id: "r1" }] } }], null), []);
});

test("todayGainTotal: summerer dagens hele point; tomt/negativt/korrupt → 0", () => {
  assert.equal(todayGainTotal({ gains: { tempo: 2, sprint: 1 } }), 3);
  assert.equal(todayGainTotal({ gains: {} }), 0);
  assert.equal(todayGainTotal({ gains: { tempo: -1, sprint: "x" } }), 0);
  assert.equal(todayGainTotal(null), 0);
});

// ── #3709 trin 1: kvitteringen (point pr. sæson) ──────────────────────────────
//
// Fixturen er ÆGTE prod-data, målt 14/8: Niklas Weber (sprinter/rouleur,
// spillerejet, 18 træningsdage i sæson 2, som startede 2026-07-27).
//   sprint 88        loft 88  → låst,  +0 i sæsonen
//   acceleration 54           → 86,5 % på vej, +0
//   tactics 50       loft 50  → låst,  +0
//   durability 44             → 1,6 % på vej,  +1
//   climbing 21      loft 21  → låst,  +0
// Cap-TALLENE står kun i denne kommentar som dokumentation af målingen; hverken
// helperen eller fladen ser dem nogensinde (#1162 — kun nøgler forlader serveren).
const WEBER = "21e01f90-4350-47e1-8ace-6a290eca6b7a";
const WEBER_ABILITIES = { sprint: 88, acceleration: 54, tactics: 50, durability: 44, climbing: 21 };
const WEBER_PROGRESS = { acceleration: 0.8650647057499097, durability: 0.015982200040609573 };
const WEBER_CAPPED = ["sprint", "tactics", "climbing"];
const SEASON_2_START = "2026-07-27";

// To kørsler INDEN sæsonstart og to i sæsonen. Vinduet er 30 dage, sæsonen 28,
// så forrige sæsons hale ER inde i runs-arrayet og skal skæres fra.
const WEBER_RUNS = [
  { tick_date: "2026-08-02", report: { riders: [{ rider_id: WEBER, gains: { durability: 1 } }] } },
  { tick_date: "2026-08-01", report: { riders: [{ rider_id: WEBER, gains: {} }] } },
  { tick_date: "2026-07-26", report: { riders: [{ rider_id: WEBER, gains: { sprint: 2 } }] } },
  { tick_date: "2026-07-20", report: { riders: [{ rider_id: WEBER, gains: { acceleration: 3 } }] } },
];

test("seasonAbilityGains: kun dage fra sæsonstart og frem tælles med", () => {
  // 18 dage i sæson 2 gav Weber præcis ét point (durability). De 5 point fra
  // sæson 1 må ikke lække ind i sæsonens kvittering.
  assert.deepEqual(seasonAbilityGains(WEBER_RUNS, WEBER, SEASON_2_START), { durability: 1 });
});

test("seasonAbilityGains: sæsonstart lig med kørslens dato er MED (>=, ikke >)", () => {
  const runs = [{ tick_date: "2026-07-27", report: { riders: [{ rider_id: WEBER, gains: { sprint: 1 } }] } }];
  assert.deepEqual(seasonAbilityGains(runs, WEBER, SEASON_2_START), { sprint: 1 });
});

test("seasonAbilityGains: summerer over dage og ignorerer nul/negativt/korrupt", () => {
  const runs = [
    { tick_date: "2026-08-03", report: { riders: [{ rider_id: WEBER, gains: { tempo: 1, flat: 0 } }] } },
    { tick_date: "2026-08-02", report: { riders: [{ rider_id: WEBER, gains: { tempo: 2, punch: -1, sprint: "x" } }] } },
  ];
  assert.deepEqual(seasonAbilityGains(runs, WEBER, SEASON_2_START), { tempo: 3 });
});

test("seasonAbilityGains: ingen sæsonstart → null, ikke et opfundet nul", () => {
  assert.equal(seasonAbilityGains(WEBER_RUNS, WEBER, null), null);
  assert.equal(seasonAbilityGains(WEBER_RUNS, WEBER, undefined), null);
  assert.equal(seasonAbilityGains(null, WEBER, SEASON_2_START), null);
  assert.equal(seasonAbilityGains(WEBER_RUNS, null, SEASON_2_START), null);
});

test("seasonAbilityGains: rytter uden linje i kørslen giver tom kvittering, ikke fejl", () => {
  const runs = [{ tick_date: "2026-08-02", report: { riders: [{ rider_id: "anden", gains: { sprint: 5 } }] } }];
  assert.deepEqual(seasonAbilityGains(runs, WEBER, SEASON_2_START), {});
});

test("abilityReceipt: nu, sæson og fremdrift pr. evne (Weber, målt i prod 14/8)", () => {
  const rows = abilityReceipt(["sprint", "acceleration", "tactics", "durability", "climbing"], {
    abilities: WEBER_ABILITIES,
    progress: WEBER_PROGRESS,
    capped: WEBER_CAPPED,
    seasonGains: { durability: 1 },
  });
  assert.deepEqual(rows, [
    { ability: "sprint", value: 88, gained: 0, pct: null, locked: true },
    { ability: "acceleration", value: 54, gained: 0, pct: 87, locked: false },
    { ability: "tactics", value: 50, gained: 0, pct: null, locked: true },
    { ability: "durability", value: 44, gained: 1, pct: 2, locked: false },
    { ability: "climbing", value: 21, gained: 0, pct: null, locked: true },
  ]);
});

test("abilityReceipt: en låst evne får ALDRIG en fremdriftsprocent", () => {
  // Rod-årsagen bag #3639: den døde bar. En låst evne skal sige "færdig",
  // ikke stå og vise en procent der aldrig rykker.
  const [row] = abilityReceipt(["sprint"], {
    abilities: { sprint: 88 }, progress: { sprint: 0.97 }, capped: ["sprint"], seasonGains: {},
  });
  assert.equal(row.locked, true);
  assert.equal(row.pct, null);
});

test("abilityReceipt: fremdrift klippes ved 99 — en fuld bar der ikke springer læses som gået i stå", () => {
  const [row] = abilityReceipt(["tempo"], { abilities: { tempo: 40 }, progress: { tempo: 0.999 }, seasonGains: {} });
  assert.equal(row.pct, 99);
  const [neg] = abilityReceipt(["tempo"], { abilities: { tempo: 40 }, progress: { tempo: -0.2 }, seasonGains: {} });
  assert.equal(neg.pct, 0);
});

test("abilityReceipt: manglende data giver null, ikke nul", () => {
  const [row] = abilityReceipt(["tactics"], { abilities: {}, progress: {}, capped: [], seasonGains: null });
  assert.deepEqual(row, { ability: "tactics", value: null, gained: null, pct: null, locked: false });
});

test("focusAbilityReceipt: fokussets egne evner, i fokussets rækkefølge", () => {
  // sprint-fokus = sprint + acceleration. Præcis Webers sag: sprint er låst,
  // acceleration er 87 % på vej. Den gamle ene bar viste kun acceleration, så
  // den låste sprint var usynlig (#3639).
  const rows = focusAbilityReceipt("sprint", {
    abilities: WEBER_ABILITIES, progress: WEBER_PROGRESS, capped: WEBER_CAPPED, seasonGains: { durability: 1 },
  });
  assert.deepEqual(rows.map((r) => r.ability), ["sprint", "acceleration"]);
  assert.equal(rows[0].locked, true);
  assert.equal(rows[1].pct, 87);
});

test("focusAbilityReceipt: intet/ukendt fokus → null", () => {
  assert.equal(focusAbilityReceipt(null, {}), null);
  assert.equal(focusAbilityReceipt("ikke-et-fokus", {}), null);
});
