import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRaceResults,
  simulateStageByIndex,
} from "./raceRunner.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";

// Genbruger raceRunner.test.js-fixturerne (samme ryttere/stages/points) så
// determinisme-asserts kan sammenligne stage-by-stage mod helt-løb bit-for-bit.
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
const STAGE_RACE = { id: "race-stage-1", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", name: "Test GP", stages: 3 };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];
// Mock-supabase: udvider raceRunner.test.js-mocken med selektiv race_results-read
// (Discord-embed på final stage genlæser HELE løbets race_results fra DB).
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
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ error: null }); },
      update(obj) {
        const r = { table, op: "update", obj, eqs: [] };
        writes.push(r);
        const u = { eq(c, v) { r.eqs.push([c, v]); return u; }, in() { return u; }, then(res) { return Promise.resolve({ error: null }).then(res); } };
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
  return { from, __writes: writes };
}

function cannedFor(race = STAGE_RACE, stages = STAGES_3, extra = {}) {
  return makeSupabase({
    race_stage_profiles: stages,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: race.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    ...extra,
  });
}

const NOOP_DEPS = {
  applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
  recomputeRaceDays: async () => 12,
  processBoardWeekend: async () => ({}),
  applyFatigue: async () => ({ updated: 0 }),
};

// ── Determinisme (KRITISK): stage-N-via-index == samme stage fra helt-løb ──────
test("determinisme: simulateStageByIndex persisterer PRÆCIS de rækker helt-løbet ville for samme etape", async () => {
  // Reference: helt-løbets rækker filtreret til hver etape. cannedFor() har
  // race_points: [] → tom pointsLookup, så referencen bygges med samme tomme
  // lookup (points_earned/prize_money er afledte; row-identiteten er determinisme-
  // egenskaben vi beviser bit-for-bit).
  const whole = buildRaceResults({ race: STAGE_RACE, stages: STAGES_3, entrants: ENTRANTS, pointsLookup: {} });
  for (let idx = 0; idx < STAGES_3.length; idx++) {
    const stageNumber = idx + 1;
    const supabase = cannedFor();
    let applied = null;
    await simulateStageByIndex({
      supabase, race: STAGE_RACE, stageIndex: idx,
      ...NOOP_DEPS,
      applyRaceResults: async ({ resultRows }) => { applied = resultRows; return { rowsImported: resultRows.length }; },
    });
    const expected = whole.resultRows.filter((r) => r.stage_number === stageNumber);
    assert.ok(applied, `etape ${stageNumber}: applyRaceResults fik ingen rækker`);
    assert.deepEqual(applied, expected, `etape ${stageNumber}: stage-by-stage != helt-løb (bit-for-bit)`);
  }
});

// ── Fatigue: PRÆCIS ét applyFatigue-kald pr. invokation (ingen dobbelt-akkumulering) ──
test("fatigue: PRÆCIS ét applyFatigue-kald pr. invokation, med DENNE etapes profil", async () => {
  for (let idx = 0; idx < STAGES_3.length; idx++) {
    const supabase = cannedFor();
    const fatigueCalls = [];
    await simulateStageByIndex({
      supabase, race: STAGE_RACE, stageIndex: idx,
      ...NOOP_DEPS,
      applyFatigue: async ({ profileType }) => { fatigueCalls.push(profileType); return { updated: 0 }; },
    });
    assert.equal(fatigueCalls.length, 1, `etape ${idx + 1}: forventet præcis 1 fatigue-kald, fik ${fatigueCalls.length}`);
    assert.equal(fatigueCalls[0], STAGES_3[idx].profile_type, `etape ${idx + 1}: forkert profil til fatigue`);
  }
});

// ── Persist: KUN etape N's race_results (idempotent delete pr. etape) ──────────
test("persist: kun etape N skrives — idempotent delete på (race_id, stage_number=N)", async () => {
  const supabase = cannedFor();
  let applied = null;
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1, // etape 2
    ...NOOP_DEPS,
    applyRaceResults: async ({ resultRows }) => { applied = resultRows; return { rowsImported: resultRows.length }; },
  });
  // Alle persisterede rækker er etape 2.
  assert.ok(applied.length > 0);
  assert.ok(applied.every((r) => r.stage_number === 2), "ikke-etape-2-rækker lækkede");
  // Idempotent delete på race_results for præcis stage_number=2.
  const del = supabase.__writes.find((w) => w.table === "race_results" && w.op === "delete");
  assert.ok(del, "ingen idempotent delete af race_results");
  assert.ok(del.eqs.some(([c, v]) => c === "race_id" && v === STAGE_RACE.id), "delete mangler race_id-filter");
  assert.ok(del.eqs.some(([c, v]) => c === "stage_number" && v === 2), "delete mangler stage_number=2-filter");
});

// ── stages_completed-counter ──────────────────────────────────────────────────
test("counter: stages_completed sættes til stageNumber; status IKKE completed på mellem-etape", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 0, ...NOOP_DEPS }); // etape 1 (af 3)
  const upd = supabase.__writes.find((w) => w.table === "races" && w.op === "update");
  assert.ok(upd, "races ikke opdateret");
  assert.equal(upd.obj.stages_completed, 1);
  assert.notEqual(upd.obj.status, "completed", "mellem-etape må ikke sætte completed");
});

test("counter: final-etape sætter stages_completed = stages OG status=completed", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 2, ...NOOP_DEPS }); // etape 3 = final
  const upd = supabase.__writes.find((w) => w.table === "races" && w.op === "update");
  assert.equal(upd.obj.stages_completed, 3);
  assert.equal(upd.obj.status, "completed");
});

// ── Finalization-gating ───────────────────────────────────────────────────────
test("gating: mellem-etape kalder IKKE recompute/board/discord", async () => {
  const supabase = cannedFor();
  let recompute = 0, board = 0, discord = 0;
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 0, // etape 1
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => { recompute++; return 12; },
    processBoardWeekend: async () => { board++; return {}; },
    notifyDiscord: async () => { discord++; },
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.equal(recompute, 0, "recompute må ikke kaldes på mellem-etape");
  assert.equal(board, 0, "board må ikke kaldes på mellem-etape");
  assert.equal(discord, 0, "discord må ikke kaldes på mellem-etape");
});

test("gating: final-etape kalder recompute + board + discord", async () => {
  const supabase = cannedFor();
  let recompute = 0; const boardCalls = []; let discordPayload = null;
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 2, // etape 3 = final
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => { recompute++; return 12; },
    processBoardWeekend: async (args) => { boardCalls.push(args); return {}; },
    notifyDiscord: async (payload) => { discordPayload = payload; },
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.equal(recompute, 1, "recompute skal kaldes på final-etape");
  assert.equal(boardCalls.length, 1, "board skal kaldes på final-etape");
  assert.equal(boardCalls[0].previousRaceDaysCompleted, 9);
  assert.equal(boardCalls[0].season.race_days_completed, 12);
  assert.ok(discordPayload, "discord skal kaldes på final-etape");
});

test("gating: final-etape Discord-embed = HELE løbets race_results genlæst fra DB", async () => {
  // canned race_results = en simuleret 'hele løbet i DB'-payload med flere etaper.
  const wholeRows = [
    { result_type: "gc", rank: 1, rider_name: "DB-GC", stage_number: 3 },
    { result_type: "stage", rank: 1, rider_name: "DB-Stage1", stage_number: 1 },
  ];
  const supabase = cannedFor(STAGE_RACE, STAGES_3, { race_results: wholeRows });
  let discordPayload = null;
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 2,
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    notifyDiscord: async (payload) => { discordPayload = payload; },
    applyFatigue: async () => ({ updated: 0 }),
  });
  // resultRows i discord-payload = de DB-genlæste rækker, IKKE kun final-etapens nybyggede.
  assert.deepEqual(discordPayload.resultRows, wholeRows, "Discord-embed skal bruge HELE løbets race_results fra DB");
  assert.equal(discordPayload.race.id, STAGE_RACE.id);
});

// ── Entries auto-fill kun ved første etape ────────────────────────────────────
test("entries: persist=true KUN ved stageIndex=0 (auto-fill skriver entries kun på etape 1)", async () => {
  // Tomt felt → auto-fill ville skrive race_entries hvis persist=true.
  const stageZeroSb = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: [],
    teams: [{ id: "A", is_test_account: false, is_frozen: false }],
    riders: ENTRANTS.filter((e) => e.team_id === "A").map((e) => ({ id: e.rider_id, team_id: "A", firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9 }],
  });
  await simulateStageByIndex({ supabase: stageZeroSb, race: STAGE_RACE, stageIndex: 0, ...NOOP_DEPS });
  const insertedAt0 = stageZeroSb.__writes.find((w) => w.table === "race_entries" && w.op === "insert");
  assert.ok(insertedAt0, "etape 1 (stageIndex=0): auto-fill skal persistere race_entries");

  // Samme felt, stageIndex=1: ingen race_entries-insert (persist=false).
  const stageOneSb = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: [],
    teams: [{ id: "A", is_test_account: false, is_frozen: false }],
    riders: ENTRANTS.filter((e) => e.team_id === "A").map((e) => ({ id: e.rider_id, team_id: "A", firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9 }],
  });
  await simulateStageByIndex({ supabase: stageOneSb, race: STAGE_RACE, stageIndex: 1, ...NOOP_DEPS });
  const insertedAt1 = stageOneSb.__writes.find((w) => w.table === "race_entries" && w.op === "insert");
  assert.equal(insertedAt1, undefined, "stageIndex=1: må IKKE persistere race_entries (persist=false)");
});

// ── Returkontrakt ─────────────────────────────────────────────────────────────
test("retur: { stageNumber, isFinalStage, rowsImported, entrants, stages }", async () => {
  const supabase = cannedFor();
  const r = await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 1, ...NOOP_DEPS });
  assert.equal(r.stageNumber, 2);
  assert.equal(r.isFinalStage, false);
  assert.equal(r.stages, 3);
  assert.equal(r.entrants, ENTRANTS.length);
  assert.ok(typeof r.rowsImported === "number");
});

// ── run-snapshot kun etape N ──────────────────────────────────────────────────
test("runs: persisterer KUN etape N's run-snapshot", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 1, ...NOOP_DEPS });
  const runIns = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  assert.ok(runIns, "run-snapshot ikke persisteret");
  assert.ok(runIns.rows.every((row) => row.stage_number === 2), "run-snapshot indeholdt andre etaper end 2");
});

// ── Guard: stageIndex uden for [0, stages-1] ──────────────────────────────────
test("guard: stageIndex uden for rækkevidde → kaster", async () => {
  const supabase = cannedFor();
  await assert.rejects(() => simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 3, ...NOOP_DEPS }));
  await assert.rejects(() => simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: -1, ...NOOP_DEPS }));
});
