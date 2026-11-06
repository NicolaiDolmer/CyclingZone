// #7733: faste, syntetiske scenarier for et igangvaerende etapeloeb, hvor ryttere er
// forsvundet ud af feltet paa hver sin maade. Delt af startedFieldLock7733Flag.test.js og
// generatoren af den frosne fixture (startedFieldLock7733FlagOff.json). Samme fil koeres i
// merge-basen (foer kontakten) og i den nye kode; kun hashes og antal forlader
// computeOffDigests7733. Ingen prod-data.

import { createHash } from "node:crypto";
import { mock } from "node:test";

import { loadEntrantsForRace, simulateStageByIndex } from "../raceRunner.js";
import { ABILITY_KEYS } from "../raceSimulator.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";

export const POOL_7733 = 21;

/** Scenarierne laeser aldrig vaeguret (hard rule 16): motorens dato-defaults koerer paa dette ur. */
export const NOW_7733 = Date.UTC(2026, 9, 15, 12);

async function atFixedClock7733(run) {
  mock.timers.enable({ apis: ["Date"], now: NOW_7733 });
  try {
    return await run();
  } finally {
    mock.timers.reset();
  }
}

export const RACE_7733 = Object.freeze({
  id: "race-7733-fixture", race_type: "stage_race", race_class: "ProSeries", season_id: "s1",
  name: "Fixture Tour", stages: 3, stages_completed: 1, status: "scheduled",
  league_division_id: POOL_7733, squad: "u23",
});

export const STAGES_7733 = Object.freeze([
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "hilly", demand_vector: DEMAND_VECTORS.hilly },
]);

export const TEAMS_7733 = Object.freeze({
  stable: "team-stable",
  /** Holdet er flyttet ud af loebets pulje midt i loebet. */
  leftPool: "team-left-pool",
  /** Her forsvinder hver sin rytter af sin egen grund. */
  mixed: "team-mixed",
});

/** Ryttere paa team-mixed, der skifter tilstand midt i loebet. */
export const RIDERS_7733 = Object.freeze({
  movedSquad: "mixed-0",
  academy: "mixed-1",
  leftTeam: "mixed-2",
  retired: "mixed-3",
  injured: "mixed-4",
});

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 40 + ((seed * 11 + i * 5) % 45); });
  return a;
}

function riderRow(id, teamId, seed, overrides = {}) {
  return {
    id, team_id: teamId, squad: "u23", is_academy: false, is_retired: false, is_u25: true,
    birthdate: "2005-03-01", firstname: id, lastname: "", ...overrides, seed,
  };
}

function ridersOf(teamId, prefix, seedBase, squad) {
  return Array.from({ length: 6 }, (_, i) => riderRow(`${prefix}-${i}`, teamId, seedBase + i, { squad }));
}

/** Tilstanden i databasen, naar etape 2 eller 3 skal koeres. */
export function worldAfterStart7733({ race = RACE_7733 } = {}) {
  const stable = ridersOf(TEAMS_7733.stable, "stable", 1, race.squad);
  const leftPool = ridersOf(TEAMS_7733.leftPool, "pool", 20, race.squad);
  const mixed = ridersOf(TEAMS_7733.mixed, "mixed", 40, race.squad);
  const entries = [...stable, ...leftPool, ...mixed].map((r, i) => ({
    rider_id: r.id, team_id: r.team_id, race_role: i % 6 === 0 ? "captain" : "helper",
  }));
  const changed = {
    [RIDERS_7733.movedSquad]: { squad: race.squad === "u23" ? "senior" : "u23" },
    [RIDERS_7733.academy]: { squad: race.squad === "u23" ? "junior" : "u23", is_academy: true },
    [RIDERS_7733.leftTeam]: { team_id: null },
    [RIDERS_7733.retired]: { is_retired: true },
  };
  const riders = [...stable, ...leftPool, ...mixed].map((r) => ({ ...r, ...(changed[r.id] ?? {}) }));
  const poolColumn = race.squad === "u23" ? "u23_league_division_id" : "league_division_id";
  const team = (id, pool, isAi) => ({
    id, name: id, is_ai: isAi, league_division_id: 1, u23_league_division_id: null,
    junior_league_division_id: null, [poolColumn]: pool,
  });
  return {
    race_stage_profiles: STAGES_7733.map((s) => ({ ...s })),
    race_entries: entries,
    riders,
    rider_derived_abilities: riders.map((r) => ({ rider_id: r.id, ...abil(r.seed) })),
    rider_condition: [{ rider_id: RIDERS_7733.injured, injured_until: "2026-10-20", form: 50, fatigue: 10 }],
    race_points: [],
    races: [{ ...race }],
    teams: [
      team(TEAMS_7733.stable, race.league_division_id, false),
      team(TEAMS_7733.leftPool, null, true),
      team(TEAMS_7733.mixed, race.league_division_id, false),
    ],
    seasons: [{ id: race.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: entries.map((e) => e.rider_id) }],
    race_withdrawals: [],
    race_incidents: [],
    race_results: [],
  };
}

/** Kaeden respekterer .in(); alt andet ignoreres, de cannede raekker er skaaret til scenariet. */
export function makeSupabase7733(canned, { flag } = {}) {
  const tables = { ...canned, app_config: flag === undefined ? [] : [{ value: flag }] };
  const writes = [];
  function from(table) {
    const filters = [];
    const rows = () => (tables[table] || []).filter((row) => filters.every(([col, vals]) => !(col in row) || vals.includes(row[col])));
    const b = {
      select() { return b; }, eq() { return b; }, in(col, vals) { filters.push([col, vals]); return b; }, or() { return b; }, is() { return b; },
      order() { return b; }, limit() { return b; }, gte() { return b; }, lt() { return b; }, neq() { return b; },
      range() { return b; },
      maybeSingle() { return Promise.resolve({ data: (tables[table] || [])[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: (tables[table] || [])[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ error: null }); },
      update(obj) {
        writes.push({ table, op: "update", obj });
        const u = {
          eq() { return u; }, in() { return u; }, is() { return u; },
          select() { return Promise.resolve({ data: [{ id: "row0" }], error: null }); },
          then(res) { return Promise.resolve({ error: null }).then(res); },
        };
        return u;
      },
      delete() {
        writes.push({ table, op: "delete" });
        const d = { eq() { return d; }, in() { return d; }, then(res) { return Promise.resolve({ error: null }).then(res); } };
        return d;
      },
      then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
    };
    return b;
  }
  return { from, rpc: () => Promise.resolve({ data: null, error: null }), __writes: writes };
}

const NOOP_DEPS_7733 = {
  recomputeRaceDays: async () => 12,
  processBoardWeekend: async () => ({}),
  applyFatigue: async () => ({ updated: 0 }),
  checkV3Enabled: async () => true,
  checkV4Enabled: async () => false,
};

/** Koer en etape og returnér raekkerne til apply_stage_result og sim-runnets felt. */
export async function runStage7733({ race = RACE_7733, stageIndex = 1, flag, extraDeps = {} } = {}) {
  // #7733: "on" betyder her et loeb der blev stemplet ved start; kontakten alene goer intet.
  const world = worldAfterStart7733({ race });
  const supabase = makeSupabase7733(flag === "on" ? { ...world, races: [{ ...race, started_field_lock_7733: true }] } : world, { flag });
  let rows = null;
  await atFixedClock7733(() => simulateStageByIndex({
    supabase, race, stageIndex, ...NOOP_DEPS_7733,
    applyStageResult: async (_client, { resultRows }) => {
      rows = resultRows;
      return { lockWon: true, rowsImported: resultRows.length };
    },
    ...extraDeps,
  }));
  const stageRiderIds = (rows ?? []).filter((r) => r.result_type === "stage").map((r) => r.rider_id).sort();
  return { rows: rows ?? [], stageRiderIds, supabase };
}

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function sortedRows(rows) {
  return [...rows].map((r) => JSON.stringify(r)).sort();
}

export const OFF_DIGEST_CASES_7733 = Object.freeze([
  { key: "u23:stage2", race: RACE_7733, stageIndex: 1 },
  { key: "u23:stage3", race: { ...RACE_7733, stages_completed: 2 }, stageIndex: 2 },
  { key: "senior:stage2", race: { ...RACE_7733, id: "race-7733-senior", squad: "senior" }, stageIndex: 1 },
]);

/** Kun hashes og antal: det der sammenlignes med merge-basens fixture. */
export async function computeOffDigests7733() {
  const out = {};
  for (const { key, race, stageIndex } of OFF_DIGEST_CASES_7733) {
    const { rows, stageRiderIds } = await runStage7733({ race, stageIndex });
    const entrants = await loadEntrantsForRace({
      supabase: makeSupabase7733(worldAfterStart7733({ race })), race, stages: STAGES_7733,
      persist: false, allowAutofill: false, today: "2026-10-15",
    });
    out[key] = {
      stageRiders: stageRiderIds.length,
      stageRidersSha256: sha(stageRiderIds),
      resultRowsSha256: sha(sortedRows(rows)),
      entrants: entrants.length,
      entrantsSha256: sha(sortedRows(entrants)),
    };
  }
  return out;
}
