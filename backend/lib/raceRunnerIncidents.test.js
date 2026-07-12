// Race Engine v3 (#2224), slice S4 (#1176) — raceRunner.js's I/O-orkestrering
// af uheld/DNF: cross-invokation abandon-eksklusion (simulateStageByIndex),
// persistens (race_incidents + rider_condition.injured_until), og whole-race-
// stiens (buildRaceResults) in-memory paritet med samme adfærd.
//
// Race-id'et er valgt ved udtømmende scan (se udviklings-noter i PR'en) så
// stage 2 (mountain, #2351-usaltet i testmiljø uden RACE_ENGINE_SEED_SALT)
// deterministisk giver PRÆCIS ét uheld: b4 abandon, injury_days=3.
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
// Race-id gated til at trigge et deterministisk abandon (b4) på stage 2.
const RACE_ID = "race-stage-search-ab-11";
const STAGE_RACE = { id: RACE_ID, race_type: "stage_race", race_class: "ProSeries", season_id: "s1", name: "Incident GP", stages: 3 };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];

// Minimal mock-supabase (mønster genbrugt fra raceRunnerStage.test.js — ikke
// eksporteret derfra, så dupliceret her). `.eq()`/`.in()` er no-ops (kæden
// ignorerer filtre); canned data må derfor være PRÆ-FILTRERET til det scenarie
// testen simulerer (samme konvention som raceRunnerStage.test.js's priorStageRows).
function makeSupabase(canned = {}, opts = {}) {
  const writes = [];
  const rpcCalls = [];
  const racesRow = (canned.races || [])[0] || {};
  function rpc(name, params) {
    rpcCalls.push({ name, params });
    if (name === "apply_stage_result") {
      const lockWon = typeof opts.lockAffected !== "undefined" ? opts.lockAffected > 0 : true;
      writes.push({ table: "races", op: "stage_rpc", params, lockWon });
      return Promise.resolve({
        data: { lock_won: lockWon, rows_imported: lockWon ? (params.p_result_rows?.length ?? 0) : 0 },
        error: null,
      });
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
  return { from, rpc, __writes: writes, __rpcCalls: rpcCalls };
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

// ── Stage 2: uheldet OPSTÅR (b4 abandon), persisteres + skader rytteren ───────

test("S4: stage 2 (v3=true) — b4 udgår, ingen 'stage'-række for ham, race_incidents + rider_condition persisteres", async () => {
  const supabase = cannedFor();
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1, // etape 2
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });

  const rows = cap.rows();
  assert.ok(!rows.some((r) => r.result_type === "stage" && r.rider_id === "b4"),
    "b4 udgik PÅ denne etape — ingen 'stage'-række for ham");
  // De øvrige 7 ryttere fik stadig deres stage-række.
  assert.equal(rows.filter((r) => r.result_type === "stage").length, ENTRANTS.length - 1);

  const incidentIns = supabase.__writes.find((w) => w.table === "race_incidents" && w.op === "insert");
  assert.ok(incidentIns, "race_incidents blev ikke persisteret");
  assert.equal(incidentIns.rows.length, 1);
  const row = incidentIns.rows[0];
  assert.equal(row.race_id, RACE_ID);
  assert.equal(row.stage_number, 2);
  assert.equal(row.rider_id, "b4");
  assert.equal(row.outcome, "abandon");
  assert.equal(row.injury_days, 3);
  assert.equal(row.time_loss_seconds, null);

  // Idempotent delete-then-insert scoped til DENNE etape (spejler persistRuns).
  const incidentDel = supabase.__writes.find((w) => w.table === "race_incidents" && w.op === "delete");
  assert.ok(incidentDel, "race_incidents delete (idempotens) mangler");
  assert.deepEqual(incidentDel.ins, [["stage_number", [2]]]);

  const conditionUpsert = supabase.__writes.find((w) => w.table === "rider_condition" && w.op === "upsert");
  assert.ok(conditionUpsert, "rider_condition upsert (skade) mangler");
  assert.equal(conditionUpsert.rows.length, 1);
  const cond = conditionUpsert.rows[0];
  assert.equal(cond.rider_id, "b4");
  assert.equal(cond.injury_cause, "race_crash");
  assert.match(cond.injured_until, /^\d{4}-\d{2}-\d{2}$/, "injured_until skal være en YYYY-MM-DD-dato");
  // rider_condition-upserten rører KUN rider_id/injured_until/injury_cause —
  // form/fatigue må ALDRIG være med (ville clobbre dem via upsert-semantikken).
  assert.deepEqual(Object.keys(cond).sort(), ["injured_until", "injury_cause", "rider_id"]);
});

test("S4: stage 2 (v3=false) — INGEN race_incidents/rider_condition-skrivning, ingen ryttere ekskluderet", async () => {
  const supabase = cannedFor();
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => ({ updated: 0 }),
    checkV3Enabled: async () => false,
    applyStageResult: cap.applyStageResult,
  });
  assert.equal(cap.rows().filter((r) => r.result_type === "stage").length, ENTRANTS.length, "v3=false: alle 8 ryttere kører videre");
  assert.ok(!supabase.__writes.some((w) => w.table === "race_incidents"), "v3=false må IKKE skrive race_incidents");
  assert.ok(!supabase.__writes.some((w) => w.table === "rider_condition"), "v3=false må IKKE skrive rider_condition");
});

// ── Stage 3: cross-invokation-eksklusion af den TIDLIGERE abandon ────────────

test("S4: stage 3 (final, v3=true) — b4 (abandon på stage 2) EKSKLUDERES fra feltet, INGEN #1844-missing-advarsel", async () => {
  const priorStage1 = ENTRANTS.map((e, i) => ({
    stage_number: 1, result_type: "stage", rank: i + 1, rider_id: e.rider_id, team_id: e.team_id, finish_time: `+${i}:00`,
  }));
  const priorStage2 = ENTRANTS.filter((e) => e.rider_id !== "b4").map((e, i) => ({
    stage_number: 2, result_type: "stage", rank: i + 1, rider_id: e.rider_id, team_id: e.team_id, finish_time: `+${i}:00`,
  }));
  const race = { ...STAGE_RACE, stages_completed: 2 };
  const supabase = cannedFor(race, STAGES_3, {
    race_results: [...priorStage1, ...priorStage2],
    // Etape-1-snapshot (start-felt, #1844) INKLUDERER b4 — han var med fra start.
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: ENTRANTS.map((e) => e.rider_id) }],
    // Kun b4's abandon-række — mock-.eq() er en no-op, så canned data må allerede
    // afspejle "outcome='abandon' AND race_id=RACE_ID"-filteret.
    race_incidents: [{ rider_id: "b4" }],
  });

  const errors = [];
  const origError = console.error;
  console.error = (...args) => { errors.push(args.join(" ")); };
  let cap;
  try {
    cap = captureStageResult();
    await simulateStageByIndex({
      supabase, race, stageIndex: 2, // final
      ...NOOP_DEPS,
      applyStageResult: cap.applyStageResult,
    });
  } finally {
    console.error = origError;
  }

  const rows = cap.rows();
  assert.ok(!rows.some((r) => r.rider_id === "b4"), "b4 må IKKE optræde i nogen etape-3-række (tidligere abandon)");
  assert.equal(rows.filter((r) => r.result_type === "stage").length, ENTRANTS.length - 1);
  assert.equal(rows.filter((r) => r.result_type === "gc").length, ENTRANTS.length - 1, "b4 udgår også af slut-GC");

  // #1844's missing-advarsel må IKKE fyre for b4 — han er korrekt DNF'et, ikke
  // "forsvundet" (raceRunner.js filtrerer start-felt-snapshottet FØR frysningen).
  assert.ok(!errors.some((e) => e.includes("forsvundet") && e.includes("b4")),
    `#1844-missing-advarsel fyrede fejlagtigt for b4: ${JSON.stringify(errors)}`);
});

// ── Whole-race-sti paritet (buildRaceResults, pure, ingen DB) ────────────────

test("S4: buildRaceResults (whole-race, pure) — SAMME abandon-adfærd som stage-by-stage: b4 udgår fra stage 2 og frem, GC/points/team ekskluderer ham", () => {
  const { resultRows, incidents } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: {}, v3: true });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].rider_id, "b4");
  assert.equal(incidents[0].outcome, "abandon");
  assert.equal(incidents[0].stage_number, 2);

  const stageRows = resultRows.filter((r) => r.result_type === "stage");
  assert.ok(stageRows.some((r) => r.stage_number === 1 && r.rider_id === "b4"), "b4 KØRTE stage 1 — den række skal bevares");
  assert.ok(!stageRows.some((r) => r.stage_number === 2 && r.rider_id === "b4"), "b4 udgik PÅ stage 2 — ingen stage-2-række");
  assert.ok(!stageRows.some((r) => r.stage_number === 3 && r.rider_id === "b4"), "b4 er væk resten af løbet — ingen stage-3-række");

  for (const t of ["gc", "points", "mountain", "young", "team"]) {
    assert.ok(!resultRows.some((r) => r.result_type === t && r.rider_id === "b4"),
      `b4 må ikke optræde i slut-klassementet '${t}'`);
  }
  // De øvrige 7 ryttere er fuldt til stede i slut-GC.
  assert.equal(resultRows.filter((r) => r.result_type === "gc").length, ENTRANTS.length - 1);
});

test("S4: buildRaceResults v3=false — b4 er MED hele vejen (ingen abandon-effekt uden flaget)", () => {
  const { resultRows, incidents } = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: {}, v3: false });
  assert.deepEqual(incidents, []);
  const stageRows = resultRows.filter((r) => r.result_type === "stage");
  for (const stage of [1, 2, 3]) {
    assert.ok(stageRows.some((r) => r.stage_number === stage && r.rider_id === "b4"), `v3=false: b4 skal have en stage-${stage}-række`);
  }
  assert.ok(resultRows.some((r) => r.result_type === "gc" && r.rider_id === "b4"), "v3=false: b4 skal være i slut-GC");
});
