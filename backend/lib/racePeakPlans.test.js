// Race Engine v3 (#2224), slice S5 — racePeakPlans I/O + ordinal-konvertering.
import test from "node:test";
import assert from "node:assert/strict";

import {
  dateStringToOrdinal,
  ordinalToDateString,
  scheduledAtToOrdinal,
  loadStageDayOrdinals,
  loadPeakPlans,
  serializePeakInputs,
  summarizeLeadupTraining,
  aggregateDemandVector,
  resolvePeakTrainingQualities,
} from "./racePeakPlans.js";
import { RACE_V3_TUNING as T } from "./raceRoles.js";
import { TRAINING_FOCUSES } from "./training.js";

const DAY_MS = 86_400_000;

// ── dateStringToOrdinal ───────────────────────────────────────────────────────

test("dateStringToOrdinal: epoch-dagen 1970-01-01 = 0, efterfølgende dage +1", () => {
  assert.equal(dateStringToOrdinal("1970-01-01"), 0);
  assert.equal(dateStringToOrdinal("1970-01-02"), 1);
  assert.equal(dateStringToOrdinal("2026-07-13"), Date.parse("2026-07-13T00:00:00Z") / DAY_MS);
});

test("dateStringToOrdinal: to nabo-datoer er præcis 1 fra hinanden", () => {
  assert.equal(dateStringToOrdinal("2026-07-14") - dateStringToOrdinal("2026-07-13"), 1);
});

test("dateStringToOrdinal: accepterer timestamptz-lignende input (slicer til 10 tegn)", () => {
  assert.equal(dateStringToOrdinal("2026-07-13T23:59:00Z"), dateStringToOrdinal("2026-07-13"));
});

test("dateStringToOrdinal: null/tom/ugyldig → null", () => {
  assert.equal(dateStringToOrdinal(null), null);
  assert.equal(dateStringToOrdinal(undefined), null);
  assert.equal(dateStringToOrdinal(""), null);
  assert.equal(dateStringToOrdinal("ikke-en-dato"), null);
});

// ── scheduledAtToOrdinal ──────────────────────────────────────────────────────

test("scheduledAtToOrdinal: et sent CET-tidspunkt lander på den DANSKE kalenderdag", () => {
  // 2026-07-13 22:30 UTC = 2026-07-14 00:30 CEST (dansk sommertid, +2) → dansk dag 14/7.
  assert.equal(scheduledAtToOrdinal("2026-07-13T22:30:00Z"), dateStringToOrdinal("2026-07-14"));
  // Midt på dagen UTC = samme danske dag.
  assert.equal(scheduledAtToOrdinal("2026-07-13T10:00:00Z"), dateStringToOrdinal("2026-07-13"));
});

test("scheduledAtToOrdinal: ugyldig → null", () => {
  assert.equal(scheduledAtToOrdinal("nope"), null);
  assert.equal(scheduledAtToOrdinal(null), null);
});

// ── ordinalToDateString (invers af dateStringToOrdinal) ───────────────────────

test("ordinalToDateString: rundtur med dateStringToOrdinal", () => {
  assert.equal(ordinalToDateString(dateStringToOrdinal("2026-07-13")), "2026-07-13");
  assert.equal(ordinalToDateString(0), "1970-01-01");
});

test("ordinalToDateString: ugyldig → null", () => {
  assert.equal(ordinalToDateString(null), null);
  assert.equal(ordinalToDateString(NaN), null);
});

// ── summarizeLeadupTraining (report.riders-dag-entries → konsistens + fokus) ───

test("summarizeLeadupTraining: tæller trænede dage (status != rest) + fokus-fordeling", () => {
  const out = summarizeLeadupTraining([
    { status: "trained", focus: "vo2max" },
    { status: "trained", focus: "vo2max" },
    { status: "rest", focus: "vo2max" },      // rest tæller ikke
    { status: "breakthrough", focus: "sprint" },
  ]);
  assert.equal(out.trainedDays, 3);
  assert.deepEqual(out.focusCounts, { vo2max: 2, sprint: 1 });
});

test("summarizeLeadupTraining: tom/manglende → 0 trænede dage", () => {
  assert.deepEqual(summarizeLeadupTraining([]), { trainedDays: 0, focusCounts: {} });
  assert.deepEqual(summarizeLeadupTraining(null), { trainedDays: 0, focusCounts: {} });
});

// ── aggregateDemandVector (gennemsnit af mål-løbets etape-demand-vektorer) ─────

test("aggregateDemandVector: gennemsnitter etape-vektorer nøgle for nøgle", () => {
  const dv = aggregateDemandVector([
    { demand_vector: { climbing: 0.6, flat: 0.2 } },
    { demand_vector: { climbing: 0.4, sprint: 0.4 } },
  ]);
  assert.ok(Math.abs(dv.climbing - 0.5) < 1e-9);
  assert.ok(Math.abs(dv.flat - 0.1) < 1e-9);   // 0.2/2
  assert.ok(Math.abs(dv.sprint - 0.2) < 1e-9); // 0.4/2
});

test("aggregateDemandVector: ingen gyldige profiler → null", () => {
  assert.equal(aggregateDemandVector([]), null);
  assert.equal(aggregateDemandVector([{ demand_vector: null }]), null);
});

// ── Fake supabase (samme mønster som raceFatigue.test.js) ─────────────────────
// Bygger en thenable query-builder; det sidste led i kæden resolves med { data }.
function makeSupabase(tables = {}) {
  function from(table) {
    const rows = tables[table] ?? [];
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      then(resolve, reject) {
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

// ── loadStageDayOrdinals ──────────────────────────────────────────────────────

test("loadStageDayOrdinals: mapper stage_number → CET-ordinal, springer ugyldige datoer over", async () => {
  const supabase = makeSupabase({
    race_stage_schedule: [
      { stage_number: 1, scheduled_at: "2026-07-13T10:00:00Z" },
      { stage_number: 2, scheduled_at: "2026-07-14T10:00:00Z" },
      { stage_number: 3, scheduled_at: null }, // udelades
    ],
  });
  const map = await loadStageDayOrdinals({ supabase, raceId: "race-1" });
  assert.equal(map.get(1), dateStringToOrdinal("2026-07-13"));
  assert.equal(map.get(2), dateStringToOrdinal("2026-07-14"));
  assert.equal(map.has(3), false);
});

test("loadStageDayOrdinals: DB-fejl → throw", async () => {
  const supabase = {
    from() {
      return { select() { return this; }, eq() { return this; },
        then(res) { return Promise.resolve({ data: null, error: { message: "boom" } }).then(res); } };
    },
  };
  await assert.rejects(() => loadStageDayOrdinals({ supabase, raceId: "r" }), /race_stage_schedule.*boom/);
});

// ── loadPeakPlans ─────────────────────────────────────────────────────────────

test("loadPeakPlans: grupperer pr. rytter, konverterer datoer → ordinaler", async () => {
  const supabase = makeSupabase({
    rider_peak_plans: [
      { rider_id: "r1", window_start: "2026-07-10", window_end: "2026-07-14", target_race_id: "tdf" },
      { rider_id: "r1", window_start: "2026-08-01", window_end: "2026-08-05", target_race_id: "vuelta" },
      { rider_id: "r2", window_start: "2026-07-12", window_end: "2026-07-16", target_race_id: null },
    ],
  });
  const map = await loadPeakPlans({ supabase, seasonId: "s1", riderIds: ["r1", "r2"] });
  assert.equal(map.get("r1").length, 2);
  assert.deepEqual(map.get("r1")[0], {
    start: dateStringToOrdinal("2026-07-10"),
    end: dateStringToOrdinal("2026-07-14"),
    targetRaceId: "tdf",
  });
  assert.equal(map.get("r2")[0].targetRaceId, null);
});

test("loadPeakPlans: tom sæson/rytterliste → tom map (ingen DB-kald nødvendigt)", async () => {
  const supabase = makeSupabase({});
  assert.equal((await loadPeakPlans({ supabase, seasonId: null, riderIds: ["r1"] })).size, 0);
  assert.equal((await loadPeakPlans({ supabase, seasonId: "s1", riderIds: [] })).size, 0);
});

test("loadPeakPlans: ugyldig dato på en plan → planen udelades", async () => {
  const supabase = makeSupabase({
    rider_peak_plans: [{ rider_id: "r1", window_start: "kaputt", window_end: "2026-07-14", target_race_id: null }],
  });
  const map = await loadPeakPlans({ supabase, seasonId: "s1", riderIds: ["r1"] });
  assert.equal(map.has("r1"), false);
});

// ── serializePeakInputs (checksum-determinisme) ───────────────────────────────

test("serializePeakInputs: kun entrants med vinduer, per-vindue tq, sorteret deterministisk", () => {
  const a = serializePeakInputs([
    { rider_id: "r2", peakWindows: [{ start: 5, end: 9, trainingQuality: 1 }] },
    { rider_id: "r1", peakWindows: [{ start: 20, end: 24, trainingQuality: 0.8 }, { start: 3, end: 7, trainingQuality: 0.5 }] },
    { rider_id: "r3", peakWindows: [] }, // udelades
  ]);
  assert.deepEqual(a, [
    ["r1", [[3, 7, 0.5], [20, 24, 0.8]]],
    ["r2", [[5, 9, 1]]],
  ]);
  // Input-orden må ikke ændre output (deterministisk nøgle).
  const b = serializePeakInputs([
    { rider_id: "r1", peakWindows: [{ start: 3, end: 7, trainingQuality: 0.5 }, { start: 20, end: 24, trainingQuality: 0.8 }] },
    { rider_id: "r2", peakWindows: [{ start: 5, end: 9, trainingQuality: 1 }] },
  ]);
  assert.deepEqual(a, b);
});

test("serializePeakInputs: manglende per-vindue tq → 1 (afrundet, float-stabil nøgle)", () => {
  const a = serializePeakInputs([{ rider_id: "r1", peakWindows: [{ start: 3, end: 7 }] }]);
  assert.deepEqual(a, [["r1", [[3, 7, 1]]]]);
});

// ── resolvePeakTrainingQualities (orkestrator: loader + per-vindue tq) ─────────

// Injicér fake sub-loadere, så orkestreringen testes uden DB-mock. Fælles felt:
// climber med ét vindue [start=114, end=118] mod et bjerg-mål-løb; optaktsvindue
// = [114 - PEAK_LEADUP_DAYS, 114).
const LEADUP = T.PEAK_LEADUP_DAYS;
// Ægte ordinal (fra en dato) — rider_condition.injured_until er en DATE-streng der
// konverteres via dateStringToOrdinal, så vindue + skade skal ligge på samme skala.
const WIN_START = dateStringToOrdinal("2026-08-01");
const HIGH_MOUNTAIN = { climbing: 0.52, endurance: 0.18, tempo: 0.08, recovery: 0.06, punch: 0.04, randomness: 0.10 };

test("resolvePeakTrainingQualities: perfekt optakt → per-vindue tq = 1", async () => {
  const entrants = [{ rider_id: "climber", team_id: "teamA" }];
  const peakPlansByRider = new Map([
    ["climber", [{ start: WIN_START, end: WIN_START + 4, targetRaceId: "mtn" }]],
  ]);
  // Alle LEADUP optakts-dage trænet med vo2max (bedst match for bjerg).
  const runs = [];
  for (let d = WIN_START - LEADUP; d < WIN_START; d++) {
    runs.push({ team_id: "teamA", ord: d, riderMap: new Map([["climber", { status: "trained", focus: "vo2max" }]]) });
  }
  await resolvePeakTrainingQualities({
    supabase: null, entrants, peakPlansByRider, focusAbilitiesMap: TRAINING_FOCUSES,
    loadTeamTrainingRuns: async () => runs,
    loadRiderConditions: async () => new Map([["climber", { injured_until: null, fatigue: 0 }]]),
    loadTargetRaceDemands: async () => new Map([["mtn", HIGH_MOUNTAIN]]),
  });
  assert.equal(peakPlansByRider.get("climber")[0].trainingQuality, 1);
});

test("resolvePeakTrainingQualities: elendig optakt (intet trænet, skadet, udmattet, forkert fokus) → gulvet", async () => {
  const entrants = [{ rider_id: "climber", team_id: "teamA" }];
  const peakPlansByRider = new Map([
    ["climber", [{ start: WIN_START, end: WIN_START + 4, targetRaceId: "mtn" }]],
  ]);
  await resolvePeakTrainingQualities({
    supabase: null, entrants, peakPlansByRider, focusAbilitiesMap: TRAINING_FOCUSES,
    loadTeamTrainingRuns: async () => [], // ingen træning
    loadRiderConditions: async () => new Map([["climber", { injured_until: ordinalToDateString(WIN_START - 1), fatigue: 100 }]]),
    loadTargetRaceDemands: async () => new Map([["mtn", HIGH_MOUNTAIN]]),
  });
  assert.equal(peakPlansByRider.get("climber")[0].trainingQuality, T.PEAK_TQ_FLOOR);
});

test("resolvePeakTrainingQualities: 'on track' > 'behind' (koblingen skalerer)", async () => {
  const entrants = [
    { rider_id: "onTrack", team_id: "teamA" },
    { rider_id: "behind", team_id: "teamB" },
  ];
  const peakPlansByRider = new Map([
    ["onTrack", [{ start: WIN_START, end: WIN_START + 4, targetRaceId: "mtn" }]],
    ["behind", [{ start: WIN_START, end: WIN_START + 4, targetRaceId: "mtn" }]],
  ]);
  const runs = [];
  for (let d = WIN_START - LEADUP; d < WIN_START; d++) {
    runs.push({ team_id: "teamA", ord: d, riderMap: new Map([["onTrack", { status: "trained", focus: "vo2max" }]]) });
    // behind trænede kun halvdelen af dagene, forkert fokus
    if (d % 2 === 0) runs.push({ team_id: "teamB", ord: d, riderMap: new Map([["behind", { status: "trained", focus: "sprint" }]]) });
  }
  await resolvePeakTrainingQualities({
    supabase: null, entrants, peakPlansByRider, focusAbilitiesMap: TRAINING_FOCUSES,
    loadTeamTrainingRuns: async () => runs,
    loadRiderConditions: async () => new Map([
      ["onTrack", { injured_until: null, fatigue: 10 }],
      ["behind", { injured_until: null, fatigue: 70 }],
    ]),
    loadTargetRaceDemands: async () => new Map([["mtn", HIGH_MOUNTAIN]]),
  });
  const on = peakPlansByRider.get("onTrack")[0].trainingQuality;
  const beh = peakPlansByRider.get("behind")[0].trainingQuality;
  assert.ok(on > beh, `on track (${on}) skal have højere tq end behind (${beh})`);
});

test("resolvePeakTrainingQualities: intet at gøre (ingen vinduer) → ingen loader-kald", async () => {
  let called = false;
  await resolvePeakTrainingQualities({
    supabase: null, entrants: [{ rider_id: "x", team_id: "t" }], peakPlansByRider: new Map(),
    loadTeamTrainingRuns: async () => { called = true; return []; },
    loadRiderConditions: async () => new Map(),
    loadTargetRaceDemands: async () => new Map(),
  });
  assert.equal(called, false);
});
