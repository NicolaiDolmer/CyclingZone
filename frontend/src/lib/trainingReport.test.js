import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusProgress, isBreakthrough, daySummary, breakthroughJumps, riderHistoryFromRuns,
  todayGainTotal,
  seasonAbilityGains, abilityReceipt, focusAbilityReceipt, abilityYesterdayPct,
  yesterdaySummary, riderDayStories,
  seasonReceiptState,
  SEASON_RECEIPT_UNKNOWN, SEASON_RECEIPT_NOT_STARTED, SEASON_RECEIPT_RUNNING,
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

// ── #4293: kvitteringens tredje tilstand ───────────────────────────────────────
//
// Prod 27/8: sæson 3 stod som `active` med start_date 2026-08-28, altså dagen
// EFTER. Sæson 2 sluttede 23/8, så 24.-27/8 hørte til ingen sæson, og
// træningen kørte videre (354/357/359 kørsler de tre dage). Kvitteringen kendte
// kun to tilstande og viste derfor "+0" på hver evne under overskriften
// "Siden 28. aug".

test("seasonReceiptState: aktiv sæson med start_date i FREMTIDEN er ikke begyndt (#4293)", () => {
  assert.equal(seasonReceiptState("2026-08-28", "2026-08-27"), SEASON_RECEIPT_NOT_STARTED);
});

test("seasonReceiptState: sæsonens FØRSTE dag er i gang (>=, ikke >)", () => {
  // Samme grænse som seasonAbilityGains' tick_date >= seasonStart, så badgen og
  // tallet aldrig kan være uenige om hvorvidt dag 1 tæller.
  assert.equal(seasonReceiptState("2026-08-28", "2026-08-28"), SEASON_RECEIPT_RUNNING);
});

test("seasonReceiptState: en sæson der kører er i gang", () => {
  assert.equal(seasonReceiptState("2026-07-27", "2026-08-27"), SEASON_RECEIPT_RUNNING);
});

test("seasonReceiptState: ingen sæson hentet er ukendt, ikke 'i gang'", () => {
  assert.equal(seasonReceiptState(null, "2026-08-27"), SEASON_RECEIPT_UNKNOWN);
  assert.equal(seasonReceiptState(undefined, "2026-08-27"), SEASON_RECEIPT_UNKNOWN);
  assert.equal(seasonReceiptState("", "2026-08-27"), SEASON_RECEIPT_UNKNOWN);
});

test("seasonReceiptState: ubrugelig dato falder til ukendt, aldrig til et tal", () => {
  // Den tvivlsomme tilstand skal vise "—", ikke et opfundet "+0".
  assert.equal(seasonReceiptState("2026-08-28", null), SEASON_RECEIPT_UNKNOWN);
  assert.equal(seasonReceiptState("2026-08-28", "i morgen"), SEASON_RECEIPT_UNKNOWN);
  assert.equal(seasonReceiptState("28-08-2026", "2026-08-27"), SEASON_RECEIPT_UNKNOWN);
});

test("abilityReceipt: en sæson der ikke er begyndt giver '—', ikke et målt +0 (#4293)", () => {
  // Sådan som fladerne kalder den: seasonGains = null når tilstanden ikke er
  // "running", uanset at der ligger kørsler i vinduet.
  const notStarted = seasonReceiptState("2026-08-28", "2026-08-27");
  const seasonGains = notStarted === SEASON_RECEIPT_RUNNING
    ? seasonAbilityGains(WEBER_RUNS, WEBER, "2026-08-28")
    : null;
  const rows = abilityReceipt(["durability", "sprint"], {
    abilities: { durability: 71, sprint: 64 },
    progress: { durability: 0.4, sprint: 0.1 },
    seasonGains,
  });
  assert.deepEqual(rows.map((r) => r.gained), [null, null]);
  // Nu-værdien og fremdriften er stadig sande og bliver stående: de bærer den
  // træning interregnummet gav.
  assert.deepEqual(rows.map((r) => r.value), [71, 64]);
  assert.deepEqual(rows.map((r) => r.pct), [40, 10]);
});

test("abilityReceipt: nu, sæson og fremdrift pr. evne (Weber, målt i prod 14/8)", () => {
  const rows = abilityReceipt(["sprint", "acceleration", "tactics", "durability", "climbing"], {
    abilities: WEBER_ABILITIES,
    progress: WEBER_PROGRESS,
    capped: WEBER_CAPPED,
    seasonGains: { durability: 1 },
  });
  assert.deepEqual(rows, [
    { ability: "sprint", value: 88, gained: 0, pct: null, locked: true, yesterdayPct: null },
    { ability: "acceleration", value: 54, gained: 0, pct: 87, locked: false, yesterdayPct: null },
    { ability: "tactics", value: 50, gained: 0, pct: null, locked: true, yesterdayPct: null },
    { ability: "durability", value: 44, gained: 1, pct: 2, locked: false, yesterdayPct: null },
    { ability: "climbing", value: 21, gained: 0, pct: null, locked: true, yesterdayPct: null },
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
  assert.deepEqual(row, { ability: "tactics", value: null, gained: null, pct: null, locked: false, yesterdayPct: null });
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

// ── #3924 trin 2: gårsdagens bidrag som mørkere segment ─────────────────────

test("abilityYesterdayPct: låst eller ukendt pct → intet segment", () => {
  assert.equal(abilityYesterdayPct({ pct: null, locked: false, rawFrac: 0.5, beforeFrac: 0.3 }), null);
  assert.equal(abilityYesterdayPct({ pct: 40, locked: true, rawFrac: 0.4, beforeFrac: 0.2 }), null);
});

test("abilityYesterdayPct: point landede i går → hele baren er gårsdagens (wrap kan ikke splittes)", () => {
  assert.equal(abilityYesterdayPct({ pct: 5, locked: false, rawFrac: 0.05, beforeFrac: 0.95, gainedToday: 1 }), 5);
});

test("abilityYesterdayPct: manglende progress_before (ældre kørsel) → intet segment, ikke gættet", () => {
  assert.equal(abilityYesterdayPct({ pct: 62, locked: false, rawFrac: 0.62, beforeFrac: NaN }), null);
  assert.equal(abilityYesterdayPct({ pct: 62, locked: false, rawFrac: 0.62, beforeFrac: undefined }), null);
});

test("abilityYesterdayPct: rå fremgang uden wrap, med 1%-gulv så et reelt pas aldrig bliver usynligt", () => {
  // 55% → 62%: 7 procentpoint reel fremgang.
  assert.equal(abilityYesterdayPct({ pct: 62, locked: false, rawFrac: 0.62, beforeFrac: 0.55 }), 7);
  // Et hårdt pas med en meget lille rå delta (0,3 pct-point) runder til 1, ikke 0 —
  // den bindende "aldrig usynligt"-regel fra design-go'et.
  assert.equal(abilityYesterdayPct({ pct: 40, locked: false, rawFrac: 0.403, beforeFrac: 0.4 }), 1);
});

test("abilityYesterdayPct: ingen fremgang siden i går → 0 (intet segment at tegne, men ikke null)", () => {
  assert.equal(abilityYesterdayPct({ pct: 40, locked: false, rawFrac: 0.4, beforeFrac: 0.4 }), 0);
  assert.equal(abilityYesterdayPct({ pct: 40, locked: false, rawFrac: 0.38, beforeFrac: 0.4 }), 0);
});

test("abilityYesterdayPct: segmentet kan aldrig overstige selve baren", () => {
  assert.equal(abilityYesterdayPct({ pct: 1, locked: false, rawFrac: 0.01, beforeFrac: 0 }), 1);
});

test("abilityReceipt: yesterdayPct sendes med når progressBefore/gainsToday leveres", () => {
  const rows = abilityReceipt(["acceleration"], {
    abilities: { acceleration: 54 },
    progress: { acceleration: 0.62 },
    capped: [],
    seasonGains: {},
    progressBefore: { acceleration: 0.55 },
    gainsToday: {},
  });
  assert.equal(rows[0].yesterdayPct, 7);
});

// ── #3924 trin 1: "Yesterday's gains"-resuméet ──────────────────────────────

test("yesterdaySummary: tæller trænet-mod-fokus / hvilet / point landet", () => {
  const rows = [
    { focus: "sprint", intensity: "hard", injured: false, gains: { sprint: 1 } },     // trænet + 1 point
    { focus: "vo2max", intensity: "normal", injured: false, gains: {} },              // trænet, 0 point
    { focus: null, intensity: "rest", injured: false, gains: {} },                    // hvilet
    { focus: "sprint", intensity: "recovery", injured: false, gains: {} },            // hvilet (aktiv restitution)
    { focus: "sprint", intensity: "hard", injured: true, gains: {} },                 // skadet — tæller ingen af delene
  ];
  assert.deepEqual(yesterdaySummary(rows), { trainedFocus: 2, rested: 2, pointsLanded: 1, total: 5 });
});

test("yesterdaySummary: tomt input", () => {
  assert.deepEqual(yesterdaySummary(null), { trainedFocus: 0, rested: 0, pointsLanded: 0, total: 0 });
});

test("riderDayStories: skadet rytter", () => {
  const [story] = riderDayStories([{ rider_id: "r1", name: "Rider One", injured: true }], {});
  assert.deepEqual(story, { riderId: "r1", riderName: "Rider One", type: "injured" });
});

test("riderDayStories: point landet vinder over alt andet", () => {
  const [story] = riderDayStories([
    { rider_id: "r1", name: "Rider One", intensity: "hard", gains: { sprint: 1 }, gains_detail: { sprint: { from: 54, to: 55 } } },
  ], {});
  assert.equal(story.type, "point");
  assert.deepEqual(story.jumps, [{ ability: "sprint", n: 1, from: 54, to: 55 }]);
});

test("riderDayStories: hviledag — frisk igen når træthed faldt", () => {
  const [story] = riderDayStories([
    { rider_id: "r1", name: "Rider One", intensity: "rest", gains: {}, fatigue: 9, fatigue_delta: -15 },
  ], {});
  assert.deepEqual(story, { riderId: "r1", riderName: "Rider One", type: "restFresh", fatigueFrom: 24, fatigueTo: 9 });
});

test("riderDayStories: hviledag — neutral ordlyd når træthed IKKE faldt", () => {
  const [story] = riderDayStories([
    { rider_id: "r1", name: "Rider One", intensity: "rest", gains: {}, fatigue: 20, fatigue_delta: 0 },
  ], {});
  assert.equal(story.type, "rest");
});

test("riderDayStories: aktiv restitution", () => {
  const [story] = riderDayStories([
    { rider_id: "r1", name: "Rider One", intensity: "recovery", gains: {}, fatigue: 12, fatigue_delta: -6 },
  ], {});
  assert.equal(story.type, "recovery");
});

test("riderDayStories: tæt på gennembrud vs. almindelig fremdrift (live progress)", () => {
  const rows = [
    { rider_id: "r1", name: "Near", focus: "sprint", intensity: "hard", gains: {} },
    { rider_id: "r2", name: "Far", focus: "sprint", intensity: "hard", gains: {} },
  ];
  const progressByRider = {
    r1: { sprint: 0.95, acceleration: 0.2 },
    r2: { sprint: 0.3, acceleration: 0.1 },
  };
  const [near, far] = riderDayStories(rows, progressByRider);
  assert.deepEqual(near, { riderId: "r1", riderName: "Near", type: "nearBreakthrough", ability: "sprint", pct: 95 });
  assert.deepEqual(far, { riderId: "r2", riderName: "Far", type: "progressing", ability: "sprint", pct: 30 });
});

test("riderDayStories: trænet uden fokus vs. intet fokus valgt", () => {
  const rows = [
    { rider_id: "r1", name: "NoProgressData", focus: "sprint", intensity: "hard", gains: {} },
    { rider_id: "r2", name: "NoFocus", focus: null, intensity: "hard", gains: {} },
  ];
  const [trained, noFocus] = riderDayStories(rows, {});
  assert.equal(trained.type, "trained");
  assert.equal(noFocus.type, "noFocus");
});
