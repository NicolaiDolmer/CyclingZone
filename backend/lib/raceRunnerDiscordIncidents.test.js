// Race Engine v3 (#2224), slice S4 (#1176) — Discord-notifikationens DNF-linje.
// Dækker raceRunner.js's ansvar for at videregive incidents (med rytternavne
// enrichet via riders-opslag) til notifyDiscord-callbacken, på BEGGE stier:
//   1. simulateRace (hele løbet i ét kald — incidents er allerede fulde).
//   2. simulateStageByIndex (final-etape — incidents-variablen i scope er kun
//      DENNE etapes, så raceRunner.js re-henter race_incidents for hele løbet).
// buildRaceSimEmbed's egen formattering af DNF-linjen dækkes separat i
// adminSimulateRace.test.js.
//
// Race/entrant-fixture genbruger raceRunnerIncidents.test.js's udtømmende-scan-
// fund: RACE_ID "race-stage-search-ab-11" giver deterministisk (usaltet
// testmiljø, #2351) PRÆCIS ét uheld — b4 abandon på stage 2.
import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateRace, simulateStageByIndex } from "./raceRunner.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}
function entrant(id, team_id, overrides = {}, is_u25 = false) {
  return { rider_id: id, team_id, rider_name: id, is_u25, abilities: abil(overrides) };
}
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
const RACE_ID = "race-stage-search-ab-11";
const STAGE_RACE = { id: RACE_ID, race_type: "stage_race", race_class: "ProSeries", season_id: "s1", name: "Incident GP", stages: 3 };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];

// Mock-mønster genbrugt fra raceRunnerIncidents.test.js (ikke eksporteret derfra
// — dupliceret her, samme konvention). riders-tabellen giver enrichIncidentsFor-
// Discord et navn at slå op (firstname=rider_id, lastname="" → name = rider_id).
function makeSupabase(canned = {}, opts = {}) {
  const writes = [];
  const racesRow = (canned.races || [])[0] || {};
  function rpc(name, params) {
    if (name === "apply_stage_result") {
      const lockWon = typeof opts.lockAffected !== "undefined" ? opts.lockAffected > 0 : true;
      writes.push({ table: "races", op: "stage_rpc", params, lockWon });
      return Promise.resolve({ data: { lock_won: lockWon, rows_imported: lockWon ? (params.p_result_rows?.length ?? 0) : 0 }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
  function from(table) {
    if (opts.erroringTables?.includes(table)) {
      return {
        select() { return this; },
        eq() { return this; },
        then(resolve) { return Promise.resolve({ data: null, error: { message: `boom (${table})` } }).then(resolve); },
      };
    }
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      or() { return b; },
      order() { return b; },
      limit() { return b; },
      range() { return b; },
      gte() { return b; },
      lt() { return b; },
      maybeSingle() { return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ error: null }); },
      update(obj) {
        const r = { table, op: "update", obj, eqs: [] };
        writes.push(r);
        function affectedRows() {
          if (table === "races" && typeof opts.lockAffected !== "undefined") {
            const n = typeof opts.lockAffected === "function" ? opts.lockAffected(r.eqs) : opts.lockAffected;
            return Array.from({ length: n }, (_, i) => ({ id: racesRow.id ?? `row${i}` }));
          }
          return [{ id: racesRow.id ?? "row0" }];
        }
        const u = {
          eq(c, v) { r.eqs.push([c, v]); return u; },
          in() { return u; },
          select() { return Promise.resolve({ data: affectedRows(), error: null }); },
          then(res) { return Promise.resolve({ error: null }).then(res); },
        };
        return u;
      },
      delete() {
        const r = { table, op: "delete", eqs: [], ins: [] };
        writes.push(r);
        const d = { eq(c, v) { r.eqs.push([c, v]); return d; }, in(c, v) { r.ins.push([c, v]); return d; }, then(res) { return Promise.resolve({ error: null }).then(res); } };
        return d;
      },
      then(resolve, reject) { return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject); },
    };
    return b;
  }
  return { from, rpc, __writes: writes };
}

function cannedFor(race = STAGE_RACE, stages = STAGES_3, extra = {}, opts = {}) {
  return makeSupabase({
    race_stage_profiles: stages,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    races: [{ id: race.id, ...race }],
    seasons: [{ id: race.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    ...extra,
  }, opts);
}

const NOOP_DEPS = {
  recomputeRaceDays: async () => 12,
  processBoardWeekend: async () => ({}),
  applyFatigue: async () => ({ updated: 0 }),
  checkV3Enabled: async () => true,
};

// ── simulateRace (whole-race, ét kald) ────────────────────────────────────────

test("S4: simulateRace v3=true — notifyDiscord modtager incidents med enrichet rytternavn (b4 abandon)", async () => {
  const supabase = cannedFor();
  let captured = null;
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    ...NOOP_DEPS,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    notifyDiscord: async (payload) => { captured = payload; },
  });

  assert.ok(captured, "notifyDiscord skal kaldes");
  assert.ok(Array.isArray(captured.incidents), "incidents skal være et array");
  assert.equal(captured.incidents.length, 1);
  const inc = captured.incidents[0];
  assert.equal(inc.rider_id, "b4");
  assert.equal(inc.outcome, "abandon");
  assert.equal(inc.stage_number, 2);
  assert.equal(inc.rider_name, "b4", "navn skal være enrichet fra riders-tabellen");
});

test("S4: simulateRace v3=false — notifyDiscord modtager incidents:[] (dormant)", async () => {
  const supabase = cannedFor();
  let captured = null;
  await simulateRace({
    supabase,
    race: STAGE_RACE,
    ...NOOP_DEPS,
    checkV3Enabled: async () => false,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    notifyDiscord: async (payload) => { captured = payload; },
  });
  assert.ok(captured, "notifyDiscord skal stadig kaldes");
  assert.deepEqual(captured.incidents, [], "v3=false → aldrig incidents, uanset motor-output");
});

// ── simulateStageByIndex (final-etape) ────────────────────────────────────────
// Genbruger raceRunnerIncidents.test.js' stage-3-opsætning: b4 udgik allerede på
// (den tidligere kørte) stage 2, race_incidents bærer derfor hans rækker fra det
// tidligere kald. Her tester vi at DISCORD-linjen re-henter dem for hele løbet
// og enricher navnet — ikke selve exclusion-logikken (dækket andetsteds).
function stage3Fixture() {
  const priorStage1 = ENTRANTS.map((e, i) => ({
    stage_number: 1, result_type: "stage", rank: i + 1, rider_id: e.rider_id, team_id: e.team_id, finish_time: `+${i}:00`,
  }));
  const priorStage2 = ENTRANTS.filter((e) => e.rider_id !== "b4").map((e, i) => ({
    stage_number: 2, result_type: "stage", rank: i + 1, rider_id: e.rider_id, team_id: e.team_id, finish_time: `+${i}:00`,
  }));
  const race = { ...STAGE_RACE, stages_completed: 2 };
  return { race, priorStage1, priorStage2 };
}

test("S4: simulateStageByIndex final-etape — notifyDiscord modtager HELE løbets incidents (re-hentet), enrichet navn", async () => {
  const { race, priorStage1, priorStage2 } = stage3Fixture();
  const supabase = cannedFor(race, STAGES_3, {
    race_results: [...priorStage1, ...priorStage2],
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: ENTRANTS.map((e) => e.rider_id) }],
    // Persisteret på et TIDLIGERE kald (stage 2) — DNF-linjens forespørgsel
    // re-henter denne, samme graceful-degradation-regel som frontend/embed.
    race_incidents: [{ stage_number: 2, rider_id: "b4", kind: "crash", outcome: "abandon" }],
  });

  let captured = null;
  await simulateStageByIndex({
    supabase, race, stageIndex: 2, // final
    ...NOOP_DEPS,
    applyStageResult: async (_client, { resultRows }) => ({ lockWon: true, rowsImported: resultRows.length }),
    notifyDiscord: async (payload) => { captured = payload; },
  });

  assert.ok(captured, "notifyDiscord skal kaldes på final-etapen");
  assert.equal(captured.incidents.length, 1);
  assert.equal(captured.incidents[0].rider_id, "b4");
  assert.equal(captured.incidents[0].outcome, "abandon");
  assert.equal(captured.incidents[0].rider_name, "b4");
});

// v3=false her — isolerer testen til raceRunner.js's EGEN nye Discord-fetch
// (linje ~1553): raceIncidents.js's loadAbandonedRiderIds (cross-invokation-
// eksklusion, kaldt tidligere i flowet) er selv IKKE graceful (kaster på DB-fejl)
// men er v3-gated og køres derfor slet ikke her — ikke en regression i denne
// slice, den funktion er uændret af S4-UI-arbejdet.
test("S4: simulateStageByIndex final-etape — race_incidents-fejl (tabel ikke migreret) → incidents:[], notifyDiscord kaldes stadig", async () => {
  const { race, priorStage1, priorStage2 } = stage3Fixture();
  const supabase = cannedFor(race, STAGES_3, {
    race_results: [...priorStage1, ...priorStage2],
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: ENTRANTS.map((e) => e.rider_id) }],
  }, { erroringTables: ["race_incidents"] });

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let captured = null;
  try {
    await simulateStageByIndex({
      supabase, race, stageIndex: 2,
      ...NOOP_DEPS,
      checkV3Enabled: async () => false,
      applyStageResult: async (_client, { resultRows }) => ({ lockWon: true, rowsImported: resultRows.length }),
      notifyDiscord: async (payload) => { captured = payload; },
    });
  } finally {
    console.warn = origWarn;
  }

  assert.ok(captured, "notifyDiscord skal kaldes selvom race_incidents-forespørgslen fejler");
  assert.deepEqual(captured.incidents, [], "graceful degradation → tom liste, ingen kast");
  assert.ok(warnings.some((w) => w.includes("race_incidents")), "en advarsel skal logges (uden at vælte afviklingen)");
});
