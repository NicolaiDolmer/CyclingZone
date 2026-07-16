// Race Engine v3 (#2224), slice S6 (#2355) — raceRunner.js's I/O-orkestrering af
// why-rapport-momenter: persistens (race_stage_moments), v3=false-dormancy, og
// graceful degradation når tabellen ikke er migreret endnu (v3 er allerede ON i
// prod, så persistStageMoments begynder at kalde ind FØR ejeren har nået at
// anvende migrationen manuelt — se raceRunner.js's persistStageMoments-kommentar).
//
// Samme fixture/mock-mønster som raceRunnerIncidents.test.js (duplikeret bevidst,
// samme begrundelse: ikke eksporteret derfra).
import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageByIndex, buildRaceResults } from "./raceRunner.js";
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
// Samme race-id som raceRunnerIncidents.test.js — verificeret deterministisk
// output (b4 abandon på stage 2, ægte moment-vokabular fyrer for feltet).
const RACE_ID = "race-stage-search-ab-11";
const STAGE_RACE = { id: RACE_ID, race_type: "stage_race", race_class: "ProSeries", season_id: "s1", name: "Moments GP", stages: 3 };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];

function makeSupabase(canned = {}, opts = {}) {
  const writes = [];
  function rpc(name, params) {
    if (name === "apply_stage_result") {
      writes.push({ table: "races", op: "stage_rpc", params, lockWon: true });
      return Promise.resolve({ data: { lock_won: true, rows_imported: params.p_result_rows?.length ?? 0 }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
  function from(table) {
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
      insert(rows) {
        writes.push({ table, op: "insert", rows });
        if (opts.failInsertTable === table) {
          return Promise.resolve({ error: { message: `relation "${table}" does not exist` } });
        }
        return Promise.resolve({ error: null });
      },
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ error: null }); },
      update(obj) {
        const r = { table, op: "update", obj, eqs: [] };
        writes.push(r);
        const u = {
          eq(c, v) { r.eqs.push([c, v]); return u; },
          in() { return u; },
          select() { return Promise.resolve({ data: [{ id: (canned.races?.[0]?.id) ?? "row0" }], error: null }); },
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

const V3_ON = async () => true;
const NOOP_DEPS = {
  recomputeRaceDays: async () => 12,
  processBoardWeekend: async () => ({}),
  applyFatigue: async () => ({ updated: 0 }),
  checkV3Enabled: V3_ON,
};

function captureStageResult() {
  let captured = null;
  const applyStageResult = async (_client, { resultRows }) => {
    captured = resultRows;
    return { lockWon: true, rowsImported: resultRows.length };
  };
  return { applyStageResult, rows: () => captured };
}

// ── buildRaceResults (whole-race, pure) ─────────────────────────────────────

test("S6: buildRaceResults v3=true — moments er en ikke-tom, stage_number-stemplet liste", () => {
  const { moments } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: {}, v3: true });
  assert.ok(moments.length > 0, "fixturen forventes at producere why-rapport-momenter");
  for (const m of moments) {
    assert.ok(Number.isInteger(m.stage_number));
    assert.equal(typeof m.moment_key, "string");
    assert.ok(m.significance >= 0 && m.significance <= 100);
    assert.ok(Array.isArray(m.rider_ids));
    assert.ok(Array.isArray(m.team_ids));
  }
});

test("S6: buildRaceResults v3=false — moments er ALTID [] (dormant, samme mønster som incidents)", () => {
  const { moments } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: {}, v3: false });
  assert.deepEqual(moments, []);
});

// ── simulateStageByIndex (I/O, stage-by-stage produktionssti) ──────────────

test("S6: stage 1 (v3=true) — race_stage_moments persisteres (idempotent delete-then-insert scoped til denne etape)", async () => {
  const supabase = cannedFor();
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 0,
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });

  const ins = supabase.__writes.find((w) => w.table === "race_stage_moments" && w.op === "insert");
  assert.ok(ins, "race_stage_moments blev ikke persisteret");
  assert.ok(ins.rows.length > 0);
  for (const row of ins.rows) {
    assert.equal(row.race_id, RACE_ID);
    assert.equal(row.stage_number, 1);
    assert.equal(typeof row.moment_key, "string");
  }

  const del = supabase.__writes.find((w) => w.table === "race_stage_moments" && w.op === "delete");
  assert.ok(del, "race_stage_moments delete (idempotens) mangler");
  assert.deepEqual(del.ins, [["stage_number", [1]]]);
});

test("S6: stage 1 (v3=false) — INGEN race_stage_moments-skrivning", async () => {
  const supabase = cannedFor();
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 0,
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => ({ updated: 0 }),
    checkV3Enabled: async () => false,
    applyStageResult: cap.applyStageResult,
  });
  assert.ok(!supabase.__writes.some((w) => w.table === "race_stage_moments"), "v3=false må IKKE skrive race_stage_moments");
});

test("S6: graceful degradation — race_stage_moments-tabel mangler (insert-fejl) vælter IKKE etape-afviklingen", async () => {
  const supabase = cannedFor(STAGE_RACE, STAGES_3, {}, { failInsertTable: "race_stage_moments" });
  const cap = captureStageResult();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let result;
  try {
    result = await simulateStageByIndex({
      supabase, race: STAGE_RACE, stageIndex: 0,
      ...NOOP_DEPS,
      applyStageResult: cap.applyStageResult,
    });
  } finally {
    console.warn = origWarn;
  }
  assert.ok(result, "simulateStageByIndex skal fuldføre selvom race_stage_moments-insert fejler");
  assert.equal(cap.rows().filter((r) => r.result_type === "stage").length, ENTRANTS.length, "resultat-rækkerne er upåvirkede af moments-persisteringsfejlen");
  assert.ok(warnings.some((w) => w.includes("race_stage_moments")), "graceful-degradation-warning forventet");
});
