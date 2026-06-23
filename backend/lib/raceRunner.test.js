import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRaceResults,
  loadEntrantsForRace,
  simulateRace,
} from "./raceRunner.js";
import { isRaceEngineV2Enabled } from "./raceEngineFlag.js";
import { PRIZE_PER_POINT } from "./economyConstants.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

const ALLOWED_RESULT_TYPES = new Set([
  "stage", "gc", "points", "mountain", "young", "team",
  "leader", "mountain_day", "points_day", "young_day",
]);

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, overrides = {}, is_u25 = false) {
  return { rider_id: id, team_id, rider_name: id, is_u25, abilities: abil(overrides) };
}

// 8 ryttere på 2 hold; én udtalt klatrer, én udtalt sprinter, 2 U25.
const ENTRANTS = [
  entrant("climber", "A", { climbing: 96, endurance: 92, recovery: 84, punch: 72 }, true),
  entrant("sprinter", "A", { sprint: 96, acceleration: 92, positioning: 88 }, false),
  entrant("a3", "A", { endurance: 60, climbing: 55 }, false),
  entrant("a4", "A", { sprint: 60, positioning: 58 }, false),
  entrant("b1", "B", { climbing: 70, endurance: 68 }, false),
  entrant("b2", "B", { sprint: 72, acceleration: 66 }, true),
  entrant("b3", "B", { punch: 64, climbing: 50 }, false),
  entrant("b4", "B", { endurance: 55, recovery: 52 }, false),
];

const STAGE_RACE = { id: "race-stage-1", race_type: "stage_race", race_class: "ProSeries", season_id: "s1" };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];
// Realistisk-formet pointLookup (kun nogle ranks scorer, som race_points).
const POINTS = {
  "stage__1": 43, "stage__2": 30, "stage__3": 20,
  "gc__1": 160, "gc__2": 120, "gc__3": 100,
  "points__1": 40, "mountain__1": 40, "young__1": 40, "team__1": 50, "team__2": 30,
  "leader__1": 10, "points_day__1": 5, "mountain_day__1": 5, "young_day__1": 5,
};

function rowsBy(rows, type) {
  return rows.filter((r) => r.result_type === type);
}

// ── buildRaceResults (ren kerne) ──────────────────────────────────────────────
test("alle emitterede result_types er blandt de 10 tilladte", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  for (const r of resultRows) assert.ok(ALLOWED_RESULT_TYPES.has(r.result_type), `ugyldig type ${r.result_type}`);
});

test("etapeløb: emission matcher PCM (stage hver etape, dag-ledere mellem, fulde trøjer til sidst)", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const N = ENTRANTS.length; // 8
  // 'stage' for alle ryttere på hver af de 3 etaper.
  assert.equal(rowsBy(resultRows, "stage").length, N * 3);
  // Dag-ledere kun på de 2 mellem-etaper (rank 1).
  for (const t of ["leader", "points_day", "mountain_day", "young_day"]) {
    const rows = rowsBy(resultRows, t);
    assert.equal(rows.length, 2, `${t} forventet 2`);
    assert.ok(rows.every((r) => r.rank === 1), `${t} skal være rank 1`);
  }
  // Ingen gc på mellem-etaper — kun fuld gc på slut-etapen.
  assert.equal(rowsBy(resultRows, "gc").length, N);
  assert.equal(rowsBy(resultRows, "points").length, N);
  assert.equal(rowsBy(resultRows, "mountain").length, N);
  assert.equal(rowsBy(resultRows, "young").length, 2); // 2 U25
  assert.equal(rowsBy(resultRows, "team").length, 2);  // 2 hold
});

test("countback: efter en flad etape leder etapevinderen GC (ikke alfabetisk)", () => {
  // Flad stage 1 → feltet deler tid (gap 0); GC-tie brydes på etapeplacering →
  // 'leader'-trøjen efter stage 1 skal være selve etapevinderen.
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
    { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  ];
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages, entrants: ENTRANTS, pointsLookup: POINTS });
  const stage1Winner = resultRows.find((r) => r.result_type === "stage" && r.stage_number === 1 && r.rank === 1);
  const leader1 = resultRows.find((r) => r.result_type === "leader" && r.stage_number === 1);
  assert.equal(leader1.rider_id, stage1Winner.rider_id);
});

test("GC = kumulativ tid: klatreren vinder et bjerg-tungt løb", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const gc1 = rowsBy(resultRows, "gc").find((r) => r.rank === 1);
  assert.equal(gc1.rider_id, "climber");
});

test("young-rækker indeholder kun U25 og rangeres 1..M", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const young = rowsBy(resultRows, "young");
  const u25 = new Set(ENTRANTS.filter((e) => e.is_u25).map((e) => e.rider_id));
  assert.ok(young.every((r) => u25.has(r.rider_id)), "ikke-U25 i young");
  assert.deepEqual(young.map((r) => r.rank).sort((a, b) => a - b), [1, 2]);
});

test("hold-rækker: 2 hold, rank 1..2, rider_id null + team_id sat", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const team = rowsBy(resultRows, "team");
  assert.deepEqual(team.map((r) => r.rank).sort((a, b) => a - b), [1, 2]);
  assert.ok(team.every((r) => r.rider_id === null && r.team_id));
});

test("points_earned/prize_money udledes af (result_type, rank) via lookup", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const gc1 = rowsBy(resultRows, "gc").find((r) => r.rank === 1);
  assert.equal(gc1.points_earned, 160);
  assert.equal(gc1.prize_money, 160 * PRIZE_PER_POINT);
  const gcLast = rowsBy(resultRows, "gc").find((r) => r.rank === 8);
  assert.equal(gcLast.points_earned, 0); // rank 8 ikke seedet → 0
});

test("finish_time: sat på stage+gc (display), null på trøje/hold", () => {
  const { resultRows } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  for (const r of rowsBy(resultRows, "stage")) assert.match(r.finish_time, /^\+\d+:\d{2}$/);
  for (const r of rowsBy(resultRows, "gc")) assert.match(r.finish_time, /^\+\d+:\d{2}$/);
  for (const t of ["points", "mountain", "young", "team", "leader"]) {
    for (const r of rowsBy(resultRows, t)) assert.equal(r.finish_time, null);
  }
  // GC-leder har +0:00.
  assert.equal(rowsBy(resultRows, "gc").find((r) => r.rank === 1).finish_time, "+0:00");
});

test("determinisme: samme input → identiske resultRows + runs", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.deepEqual(a.resultRows, b.resultRows);
  assert.deepEqual(a.runs, b.runs);
});

test("træthed akkumulerer over etaper: finalFatigue afspejler entering sidste etape (#1021-hybrid)", () => {
  const { finalFatigue } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  // STAGES_3 = flat(10), mountain(18), high_mountain(20). Frisk rytter (ingen condition):
  // entering sidste etape (idx 2) = 0 + load(flat=10) + load(mountain=18) = 28.
  for (const e of ENTRANTS) assert.equal(finalFatigue[e.rider_id], 28);
});

test("akkumulering bevarer determinisme: finalFatigue identisk på tværs af kald", () => {
  const a = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  const b = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.deepEqual(a.finalFatigue, b.finalFatigue);
});

test("runs: én pr. etape med seed + entrant-snapshot", () => {
  const { runs } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: POINTS });
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.ok(Number.isInteger(r.seed));
    assert.equal(r.entrant_snapshot.length, ENTRANTS.length);
    assert.equal(r.engine_version, 1);
  }
});

test("endagsløb: kun gc(all) + team — ingen stage/dag-ledere", () => {
  const single = { id: "race-single-1", race_type: "single", race_class: "ProSeries", season_id: "s1" };
  const stages = [{ stage_number: 1, profile_type: "hilly", demand_vector: DEMAND_VECTORS.hilly }];
  const { resultRows } = buildRaceResults({ race: single, stages, entrants: ENTRANTS, pointsLookup: POINTS });
  const types = new Set(resultRows.map((r) => r.result_type));
  assert.deepEqual([...types].sort(), ["gc", "team"]);
  assert.equal(rowsBy(resultRows, "gc").length, ENTRANTS.length);
  assert.equal(rowsBy(resultRows, "team").length, 2);
});

test("guards: kaster ved manglende stages/entrants/race.id", () => {
  assert.throws(() => buildRaceResults({ race: STAGE_RACE, stages: [], entrants: ENTRANTS }), /stage profiles/);
  assert.throws(() => buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: [] }), /entrants/);
  assert.throws(() => buildRaceResults({ race: {}, stages: STAGES_3, entrants: ENTRANTS }), /race\.id/);
});

// ── Mock-supabase ─────────────────────────────────────────────────────────────
function makeSupabase(canned = {}) {
  const writes = [];
  function from(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      or() { return b; },
      order() { return b; },
      gte() { return b; },
      maybeSingle() { return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      update(obj) {
        const rec = { table, op: "update", obj, eqs: [] };
        writes.push(rec);
        const u = { eq(c, v) { rec.eqs.push([c, v]); return u; }, in() { return u; }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return u;
      },
      delete() {
        const rec = { table, op: "delete", eqs: [], ins: [] };
        writes.push(rec);
        const d = { eq(c, v) { rec.eqs.push([c, v]); return d; }, in(c, v) { rec.ins.push([c, v]); return d; }, then(r) { return Promise.resolve({ error: null }).then(r); } };
        return d;
      },
      then(resolve, reject) { return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject); },
    };
    return b;
  }
  return { from, __writes: writes };
}

// ── Flag ──────────────────────────────────────────────────────────────────────
test("flag: true KUN når app_config.value === true; ellers false", async () => {
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: true }] })), true);
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: false }] })), false);
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [] })), false);
  assert.equal(await isRaceEngineV2Enabled(null), false);
});

test("flag: DB-fejl → false (fail-safe)", async () => {
  const errMock = { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle() { return Promise.resolve({ data: null, error: { message: "boom" } }); } }) };
  assert.equal(await isRaceEngineV2Enabled(errMock), false);
});

test("flag: beta-stage kun for beta-testere", async () => {
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: "beta" }] }), { isBetaTester: true }), true);
  assert.equal(await isRaceEngineV2Enabled(makeSupabase({ app_config: [{ value: "beta" }] })), false);
});

// ── loadEntrantsForRace ───────────────────────────────────────────────────────
test("loadEntrantsForRace: beriger entries med navn, is_u25 + abilities", async () => {
  const supabase = makeSupabase({
    race_entries: [{ rider_id: "r1", team_id: "T1" }, { rider_id: "r2", team_id: "T1" }],
    riders: [
      { id: "r1", firstname: "Anna", lastname: "Berg", is_u25: true },
      { id: "r2", firstname: "Bo", lastname: "Dahl", is_u25: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r1", ...abil({ climbing: 80 }) },
      { rider_id: "r2", ...abil({ sprint: 80 }) },
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  assert.equal(entrants.length, 2);
  const r1 = entrants.find((e) => e.rider_id === "r1");
  assert.equal(r1.rider_name, "Anna Berg");
  assert.equal(r1.is_u25, true);
  assert.equal(r1.team_id, "T1");
  assert.equal(r1.abilities.climbing, 80);
});

test("loadEntrantsForRace: tomt felt → auto-fill skriver race_entries", async () => {
  const supabase = makeSupabase({
    race_entries: [], // tomt → auto-fill
    teams: [{ id: "T1", is_test_account: false, is_frozen: false }, { id: "T2", is_test_account: false, is_frozen: true }],
    riders: [{ id: "r1", team_id: "T1", firstname: "A", lastname: "A", is_u25: false }],
    rider_derived_abilities: [{ rider_id: "r1", ...abil() }],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  const inserted = supabase.__writes.find((w) => w.table === "race_entries" && w.op === "insert");
  assert.ok(inserted, "auto-fill skrev ikke race_entries");
  assert.ok(entrants.length >= 1);
});

// ── loadEntrantsForRace: condition-merge (B2 #1306) ──────────────────────────
test("loadEntrantsForRace: form/fatigue merges fra rider_condition når rækker findes", async () => {
  const supabase = makeSupabase({
    race_entries: [{ rider_id: "r1", team_id: "T1" }, { rider_id: "r2", team_id: "T1" }],
    riders: [
      { id: "r1", firstname: "Anna", lastname: "Berg", is_u25: false },
      { id: "r2", firstname: "Bo", lastname: "Dahl", is_u25: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r1", ...abil() },
      { rider_id: "r2", ...abil() },
    ],
    rider_condition: [
      { rider_id: "r1", form: 8, fatigue: 30 },
      // r2 har ingen condition-række
    ],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-x" } });
  const r1 = entrants.find((e) => e.rider_id === "r1");
  const r2 = entrants.find((e) => e.rider_id === "r2");
  // r1 får form/fatigue merged.
  assert.equal(r1.form, 8);
  assert.equal(r1.fatigue, 30);
  // r2 mangler condition-række → form/fatigue sættes IKKE (undefined → neutral i simulatoren).
  assert.equal(r2.form, undefined);
  assert.equal(r2.fatigue, undefined);
});

// ── fillMissingTeamEntries: skadefilter (B2 #1306) ───────────────────────────────────
test("fillMissingTeamEntries: skadede ryttere (injured_until >= i dag) udelukkes fra auto-entry; udløbet skade + ingen condition inkluderes", async () => {
  // Mocken returnerer rider_condition ufiltreret (gte simuleres ikke) — vi lægger
  // kun den aktive skade i canned for at simulere DB's gte-filter. r-injured udelades
  // fra rider_derived_abilities så auto-fill-eksklusionen er den eneste guard der
  // testes (ingen abilities-fallback der ville skjule eventuel fejl i eksklusionen).
  const supabase = makeSupabase({
    race_entries: [], // tomt → auto-fill
    teams: [{ id: "T1", is_test_account: false, is_frozen: false }],
    riders: [
      { id: "r-injured", team_id: "T1" },
      { id: "r-expired", team_id: "T1" },
      { id: "r-none",    team_id: "T1" },
    ],
    rider_derived_abilities: [
      // r-injured mangler abilities bevidst: er ekskluderet af injury-filter
      // → bør aldrig nå enrichment-loop. Test ville stadig grønne via ab-guard,
      // men det ville skjule en regressi i injury-eksklusionen.
      { rider_id: "r-expired", ...abil() },
      { rider_id: "r-none",    ...abil() },
    ],
    // Kun r-injured returneres fra gte-query (simulerer DB-filter med >= i dag).
    rider_condition: [{ rider_id: "r-injured" }],
  });
  const entrants = await loadEntrantsForRace({ supabase, race: { id: "race-y" } });
  const ids = entrants.map((e) => e.rider_id);
  // Skadet rytter (returneret af gte-query) udelukkes fra auto-fill → ikke i startfeltet.
  assert.ok(!ids.includes("r-injured"), "skadet rytter må ikke auto-fyldes");
  // Rytter med udløbet skade (ikke i gte-resultatet) inkluderes.
  assert.ok(ids.includes("r-expired"), "rytter med udløbet skade skal med");
  // Rytter uden condition-række (ikke i gte-resultatet) inkluderes.
  assert.ok(ids.includes("r-none"), "rytter uden condition skal med");
});

// ── simulateRace (I/O-orchestrator, smoke) ────────────────────────────────────
test("simulateRace: bygger rækker, sletter idempotent pr. etape, kalder applyRaceResults, sætter completed", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  let appliedRows = null;
  const report = await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => { appliedRows = resultRows; return { rowsImported: resultRows.length }; },
    recomputeRaceDays: async () => {},
  });
  assert.ok(appliedRows && appliedRows.length > 0, "applyRaceResults fik ingen rækker");
  assert.equal(report.stages, 3);
  // Idempotent delete på race_results pr. etape-numre.
  const del = supabase.__writes.find((w) => w.table === "race_results" && w.op === "delete");
  assert.ok(del, "ingen idempotent delete af race_results");
  // status=completed sat.
  const upd = supabase.__writes.find((w) => w.table === "races" && w.op === "update");
  assert.equal(upd.obj.status, "completed");
  // run-snapshot persisteret.
  assert.ok(supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert"));
});

// #1187 · Board-weekend-wiring: simulateRace kalder processBoardWeekend med
// race-days FØR (checkpoint-udgangspunkt) og EFTER (ny værdi fra recompute).
test("simulateRace: kalder processBoardWeekend med prev/ny race-days (#1187)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  });
  const boardCalls = [];
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async (args) => { boardCalls.push(args); return { boards_updated: 1 }; },
  });
  assert.equal(boardCalls.length, 1, "processBoardWeekend skal kaldes når sæsonen findes");
  assert.equal(boardCalls[0].previousRaceDaysCompleted, 9);
  assert.equal(boardCalls[0].season.race_days_completed, 12, "ny værdi fra recompute");
  assert.equal(boardCalls[0].season.id, STAGE_RACE.season_id);
  // #1451 · race-kontekst til event-loggen.
  assert.equal(boardCalls[0].race.id, STAGE_RACE.id);
});

test("simulateRace: processBoardWeekend-fejl vælter ikke afviklingen (#1187)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  });
  const report = await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => { throw new Error("board boom"); },
  });
  assert.ok(report.rowsImported > 0, "afviklingen skal fuldføre selv om board-wiring fejler");
});

// ── simulateRace dryRun (#1102) ───────────────────────────────────────────────
test("simulateRace dryRun: returnerer preview uden DB-writes", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
  });
  const result = await simulateRace({
    supabase,
    race: STAGE_RACE,
    dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
    recomputeRaceDays: async () => { throw new Error("må ikke kaldes i dryRun"); },
    processBoardWeekend: async () => { throw new Error("må ikke kaldes i dryRun"); },
  });
  // Korrekt preview-form.
  assert.equal(result.dryRun, true);
  assert.ok(result.rows > 0, "rows skal være > 0");
  assert.ok(Array.isArray(result.stageWinners) && result.stageWinners.length === 3, "3 etapevindere");
  assert.ok(Array.isArray(result.gcPodium) && result.gcPodium.length === 3, "3 gc-podium");
  assert.equal(result.gcPodium[0].rank, 1);
  // NULPUNKT: ingen muterende DB-operationer (delete/insert/update).
  const mutating = supabase.__writes.filter((w) => ["insert", "update", "delete"].includes(w.op));
  assert.equal(mutating.length, 0, `dryRun må ikke skrive til DB — fandt: ${JSON.stringify(mutating)}`);
});

test("simulateRace dryRun: tomt startfelt auto-fills i hukommelse uden insert (#1102)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: [], // tomt → auto-fill-sti
    teams: [
      { id: "T1", is_test_account: false, is_frozen: false },
      { id: "T2", is_test_account: false, is_frozen: false },
    ],
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.rider_id.startsWith("b") ? "T2" : "T1", firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  const result = await simulateRace({
    supabase,
    race: STAGE_RACE,
    dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
    recomputeRaceDays: async () => { throw new Error("må ikke kaldes i dryRun"); },
  });
  assert.equal(result.dryRun, true);
  assert.ok(result.rows > 0, "rows skal være > 0 selv med auto-fill");
  // NULPUNKT: ingen race_entries insert — hverken auto-fill eller andet.
  const inserts = supabase.__writes.filter((w) => w.table === "race_entries" && w.op === "insert");
  assert.equal(inserts.length, 0, "dryRun må ikke indsætte i race_entries");
  // Ingen muterende operationer overhovedet.
  const mutating = supabase.__writes.filter((w) => ["insert", "update", "delete"].includes(w.op));
  assert.equal(mutating.length, 0, `dryRun-auto-fill må ikke skrive til DB — fandt: ${JSON.stringify(mutating)}`);
});

// ── simulateRace race fatigue (#1306 B3) ─────────────────────────────────────

test("simulateRace: dryRun=true → applyFatigue kaldes IKKE", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  let fatigueCalls = 0;
  const result = await simulateRace({
    supabase,
    race: STAGE_RACE,
    dryRun: true,
    applyRaceResults: async () => { throw new Error("må ikke kaldes i dryRun"); },
    recomputeRaceDays: async () => { throw new Error("må ikke kaldes i dryRun"); },
    applyFatigue: async () => { fatigueCalls++; return { updated: 0 }; },
  });
  assert.equal(result.dryRun, true);
  assert.equal(fatigueCalls, 0, "applyFatigue må ikke kaldes ved dryRun=true");
});

test("simulateRace: persisted run → applyFatigue kaldt én gang pr. etape med korrekt profileType", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 5, race_days_total: 60 }],
  });
  const fatigueCalls = [];
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 8,
    applyFatigue: async ({ riderIds, profileType }) => {
      fatigueCalls.push({ riderIds: riderIds.slice().sort(), profileType });
      return { updated: riderIds.length };
    },
  });
  // Ét kald pr. etape (3 etaper i STAGES_3).
  assert.equal(fatigueCalls.length, STAGES_3.length, `forventet ${STAGES_3.length} fatigue-kald, fik ${fatigueCalls.length}`);
  // Profile-typer matcher STAGES_3 i rækkefølge.
  const expectedProfiles = STAGES_3.map((s) => s.profile_type);
  assert.deepEqual(fatigueCalls.map((c) => c.profileType), expectedProfiles);
  // Alle entrant-ryttere er med i hvert kald.
  const expectedIds = ENTRANTS.map((e) => e.rider_id).sort();
  for (const call of fatigueCalls) {
    assert.deepEqual(call.riderIds, expectedIds, "riderIds matcher ikke entrants");
  }
});

test("simulateRace: applyFatigue-fejl vælter ikke afviklingen (#1306)", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
  });
  const report = await simulateRace({
    supabase,
    race: STAGE_RACE,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 8,
    applyFatigue: async () => { throw new Error("fatigue boom"); },
  });
  assert.ok(report.rowsImported > 0, "finalization skal fuldføre selv om applyFatigue kaster");
});
