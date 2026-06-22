import { test } from "node:test";
import assert from "node:assert/strict";

import { runStageScheduler, MAX_STAGES_PER_DAY } from "./stageScheduler.js";

// Mock-supabase med tabel-specifikke svar via en resolver-funktion. Hver from(table)
// returnerer en kæde-bygger der ved .then() resolver canned[table] (efter at have
// registreret de anvendte filtre, så tests kan inspicere queries).
function makeSupabase(tables = {}) {
  function from(table) {
    const state = { table, eqs: [], ltes: [], gtes: [], neqs: [] };
    const b = {
      select() { return b; },
      eq(c, v) { state.eqs.push([c, v]); return b; },
      neq(c, v) { state.neqs.push([c, v]); return b; },
      lte(c, v) { state.ltes.push([c, v]); return b; },
      gte(c, v) { state.gtes.push([c, v]); return b; },
      lt(c, v) { state.ltes.push([c, v]); return b; },
      in() { return b; },
      order() { return b; },
      maybeSingle() {
        const rows = resolve(table, state);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(res, rej) {
        const rows = resolve(table, state);
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return b;
  }
  function resolve(table, state) {
    const src = tables[table];
    if (typeof src === "function") return src(state) || [];
    return src || [];
  }
  return { from };
}

const NOW = new Date("2026-06-21T13:00:00Z"); // efter 12:30 CEST-slot (10:30Z)

// Default flag-states: stage_scheduler ON, race_engine_v2 ON.
const ENABLED = async () => true;

test("flag OFF → skip uden side-effekter", async () => {
  let ran = 0;
  const r = await runStageScheduler({
    supabase: makeSupabase(),
    now: NOW,
    isStageSchedulerEnabled: async () => false,
    isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { ran++; },
  });
  assert.equal(r.skipped, "flag_off");
  assert.equal(ran, 0);
});

test("race_engine_v2 OFF → skip (ekstra lag)", async () => {
  let ran = 0;
  const r = await runStageScheduler({
    supabase: makeSupabase(),
    now: NOW,
    isStageSchedulerEnabled: ENABLED,
    isRaceEngineV2Enabled: async () => false,
    runStageFn: async () => { ran++; },
  });
  assert.equal(r.skipped, "engine_off");
  assert.equal(ran, 0);
});

test("daglig cap: >= MAX_STAGES_PER_DAY etaper kørt i dag → skip", async () => {
  let ran = 0;
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    // countStagesDoneToday: MAX_STAGES_PER_DAY scheduler-runs siden midnat CET → cap nået.
    race_simulation_runs: Array.from({ length: MAX_STAGES_PER_DAY }, (_, i) => ({ id: i + 1 })),
  });
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { ran++; },
  });
  assert.equal(r.skipped, "daily_cap_reached");
  assert.equal(ran, 0);
});

test("daglig cap > 5: per-division-cadence afvikler mange etaper/dag (op til MAX_STAGES_PER_DAY)", async () => {
  // 6 forskellige løb, hver med en forfalden etape 1. Med det gamle globale cap=5 ville kun
  // 5 køre — den hævede cap (tæt-pakket 2/dag × op til 15 puljer) lader alle 6 afvikles.
  assert.ok(MAX_STAGES_PER_DAY > 5, "cap skal dække per-division-cadencen, ikke det gamle globale 5");
  const races = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, season_id: "s1", name: `Race ${i}`, stages: 1, stages_completed: 0, status: "scheduled" }));
  const schedule = races.map((r) => ({ race_id: r.id, stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" }));
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    race_simulation_runs: [],
    races,
    race_stage_schedule: () => schedule,
  });
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => ({}),
  });
  assert.equal(r.ran, 6, "alle 6 due løb afvikles (cap > 5)");
});

test("FIX 4: daglig cap tæller KUN source='scheduler'-runs (admin-fuld-sim-runs ignoreres)", async () => {
  // DB indeholder 5 race_simulation_runs siden midnat, men kun 1 er scheduler-drevet
  // (de øvrige 4 er en admin-fuld-sim af et 5-etapers løb, source=NULL). Cap'en må KUN
  // tælle scheduler-runen → budget = 5 - 1 = 4, så et due løb afvikles (ikke cap-blokeret).
  let capQueryFilteredSource = false;
  const races = [{ id: "rA", season_id: "s1", name: "Alfa", stages: 1, stages_completed: 0, status: "scheduled" }];
  const schedule = [{ race_id: "rA", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" }];
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    race_simulation_runs: (state) => {
      // countStagesDoneToday SKAL filtrere på source='scheduler'.
      if (state.eqs.some(([c, v]) => c === "source" && v === "scheduler")) {
        capQueryFilteredSource = true;
        return [{ id: "sched1" }]; // kun 1 scheduler-run i dag
      }
      // Uden source-filter ville det være alle 5 (det FORKERTE pre-FIX-tal).
      return [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    },
    races,
    race_stage_schedule: () => schedule,
  });
  let ran = 0;
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { ran++; return {}; },
  });
  assert.ok(capQueryFilteredSource, "cap-query skal filtrere på source='scheduler'");
  assert.equal(ran, 1, "med kun 1 scheduler-run i dag er der budget tilbage → due løb afvikles");
  assert.equal(r.ran, 1);
});

test("forfaldne etaper: kører næste etape for hvert due løb (scheduled_at <= now AND stage_number = stages_completed+1)", async () => {
  // To løb hvis næste etape er forfalden.
  const races = [
    { id: "rA", season_id: "s1", name: "Alfa", stages: 3, stages_completed: 0, status: "scheduled" },
    { id: "rB", season_id: "s1", name: "Beta", stages: 2, stages_completed: 1, status: "scheduled" },
  ];
  const schedule = [
    { race_id: "rA", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" }, // forfalden (næste for rA: stages_completed+1=1)
    { race_id: "rB", stage_number: 2, scheduled_at: "2026-06-21T12:00:00Z" }, // forfalden (næste for rB: 2)
  ];
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    race_simulation_runs: [],
    races,
    race_stage_schedule: (state) => {
      // Returnér kun forfaldne rækker (scheduled_at <= now) — simulerer DB-filteret.
      const lteNow = state.ltes.some(([c]) => c === "scheduled_at");
      return lteNow ? schedule : schedule;
    },
  });
  const ranIndexes = [];
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async ({ raceId, stageIndex }) => { ranIndexes.push({ raceId, stageIndex }); return { stageNumber: stageIndex + 1 }; },
  });
  assert.equal(r.ran, 2, "begge due løb skal køre én etape");
  // stageIndex = stages_completed.
  assert.deepEqual(
    ranIndexes.sort((a, b) => a.raceId.localeCompare(b.raceId)),
    [{ raceId: "rA", stageIndex: 0 }, { raceId: "rB", stageIndex: 1 }],
  );
});

test("kun forfaldne etaper for NÆSTE etape afvikles (skip hvis schedule-rækken ikke matcher stages_completed+1)", async () => {
  const races = [
    { id: "rA", season_id: "s1", name: "Alfa", stages: 3, stages_completed: 1, status: "scheduled" },
  ];
  // Schedule har KUN etape 1 forfalden — men rA's næste etape er 2. Ingen due-match → skip.
  const schedule = [{ race_id: "rA", stage_number: 1, scheduled_at: "2026-06-20T10:30:00Z" }];
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    race_simulation_runs: [],
    races,
    race_stage_schedule: () => schedule,
  });
  let ran = 0;
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { ran++; },
  });
  assert.equal(ran, 0, "ingen due-match → ingen afvikling");
  assert.equal(r.ran, 0);
});

test("awaiting-time: etape hvis scheduled_at > now afvikles ikke", async () => {
  const races = [{ id: "rA", season_id: "s1", name: "Alfa", stages: 3, stages_completed: 0, status: "scheduled" }];
  // Etape 1 ligger i fremtiden → DB-filteret (scheduled_at <= now) ville udelukke den.
  const schedule = [{ race_id: "rA", stage_number: 1, scheduled_at: "2026-06-21T18:00:00Z" }];
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    race_simulation_runs: [],
    races,
    // Simulér DB's scheduled_at <= now-filter: returnér tom hvis now < scheduled_at.
    race_stage_schedule: (state) => {
      const nowIso = state.ltes.find(([c]) => c === "scheduled_at")?.[1];
      return schedule.filter((s) => new Date(s.scheduled_at) <= new Date(nowIso));
    },
  });
  let ran = 0;
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { ran++; },
  });
  assert.equal(ran, 0, "fremtidig etape må ikke afvikles");
  assert.equal(r.ran, 0);
  assert.equal(r.skipped, "no_due_stages");
});

test("daglig cap respekteres MIDT i kørsel: kører kun op til resterende budget (incl. allerede kørte i dag)", async () => {
  // (MAX_STAGES_PER_DAY - 1) kørt i dag → kun 1 plads tilbage; 3 due løb → kun 1 afvikles.
  const races = [
    { id: "rA", season_id: "s1", name: "Alfa", stages: 1, stages_completed: 0, status: "scheduled" },
    { id: "rB", season_id: "s1", name: "Beta", stages: 1, stages_completed: 0, status: "scheduled" },
    { id: "rC", season_id: "s1", name: "Charlie", stages: 1, stages_completed: 0, status: "scheduled" },
  ];
  const schedule = [
    { race_id: "rA", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" },
    { race_id: "rB", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" },
    { race_id: "rC", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" },
  ];
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    // MAX_STAGES_PER_DAY - 1 kørt i dag → 1 plads tilbage.
    race_simulation_runs: Array.from({ length: MAX_STAGES_PER_DAY - 1 }, (_, i) => ({ id: i + 1 })),
    races,
    race_stage_schedule: () => schedule,
  });
  let ran = 0;
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { ran++; return {}; },
  });
  assert.equal(ran, 1, "kun 1 plads tilbage under daglig cap");
  assert.equal(r.ran, 1);
});

test("ingen aktiv sæson → skip", async () => {
  const supabase = makeSupabase({ seasons: [] });
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.equal(r.skipped, "no_active_season");
});

test("én løbs-fejl isolerer ikke de andre (per-løb try/catch)", async () => {
  const races = [
    { id: "rA", season_id: "s1", name: "Alfa", stages: 1, stages_completed: 0, status: "scheduled" },
    { id: "rB", season_id: "s1", name: "Beta", stages: 1, stages_completed: 0, status: "scheduled" },
  ];
  const schedule = [
    { race_id: "rA", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" },
    { race_id: "rB", stage_number: 1, scheduled_at: "2026-06-21T10:30:00Z" },
  ];
  const supabase = makeSupabase({
    seasons: [{ id: "s1" }],
    race_simulation_runs: [],
    races,
    race_stage_schedule: () => schedule,
  });
  let ok = 0;
  const r = await runStageScheduler({
    supabase, now: NOW,
    isStageSchedulerEnabled: ENABLED, isRaceEngineV2Enabled: ENABLED,
    runStageFn: async ({ raceId }) => {
      if (raceId === "rA") throw new Error("rA boom");
      ok++; return {};
    },
  });
  assert.equal(ok, 1, "rB skal køre selvom rA fejlede");
  assert.equal(r.errors, 1);
  assert.equal(r.ran, 1);
});
