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
// opts.lockAffected: override antal ramte rækker for races stages_completed-låsen
//   (FIX 5) — number eller funktion(eqs)=>number. Default: lås matcher (1 ramt række)
//   medmindre en .eq("stages_completed", v) er angivet og v != canned races stages_completed.
function makeSupabase(canned = {}, opts = {}) {
  const writes = [];
  const racesRow = (canned.races || [])[0] || {};
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
        // Modellér optimistisk lås: .update().eq().eq().select("id") → ramte rækker.
        // Default: låsen vinder (1 ramt række) — det normale enkelt-run-tilfælde.
        // opts.lockAffected overstyrer KUN for races-tabellen (konkurrence-test).
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
  return { from, __writes: writes };
}

function cannedFor(race = STAGE_RACE, stages = STAGES_3, extra = {}, opts = {}) {
  return makeSupabase({
    race_stage_profiles: stages,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    races: [{ id: race.id, ...race }],
    seasons: [{ id: race.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    ...extra,
  }, opts);
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
test("counter: stages_completed sættes til stageNumber via lås; status IKKE completed på mellem-etape", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 0, ...NOOP_DEPS }); // etape 1 (af 3)
  const raceUpdates = supabase.__writes.filter((w) => w.table === "races" && w.op === "update");
  // Mellem-etape: PRÆCIS én races-update (den optimistiske lås) — ingen status-flip.
  assert.equal(raceUpdates.length, 1, "mellem-etape skal kun lave lås-update'n");
  const lock = raceUpdates[0];
  assert.equal(lock.obj.stages_completed, 1);
  assert.ok(lock.eqs.some(([c, v]) => c === "stages_completed" && v === 0), "lås mangler WHERE stages_completed = stageIndex");
  assert.notEqual(lock.obj.status, "completed", "mellem-etape må ikke sætte completed");
});

test("counter: final-etape sætter stages_completed = stages OG status=completed (status SIDST)", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 2, ...NOOP_DEPS }); // etape 3 = final
  const raceUpdates = supabase.__writes.filter((w) => w.table === "races" && w.op === "update");
  // To updates: (1) lås stages_completed=3 uden status, (2) final status=completed.
  assert.equal(raceUpdates.length, 2, "final-etape: lås + status-flip = 2 races-updates");
  const lock = raceUpdates[0];
  assert.equal(lock.obj.stages_completed, 3);
  assert.equal(lock.obj.status, undefined, "lås må IKKE sætte status (FIX 1: status sidst)");
  const finalUpd = raceUpdates[1];
  assert.equal(finalUpd.obj.status, "completed");
  assert.equal(finalUpd.obj.stages_completed, 3);
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

// ── FIX 3: status-guard (defense-in-depth) ────────────────────────────────────
test("FIX 3: status=completed på final-etape → kaster (gen-afvikling blokeret)", async () => {
  // Et FÆRDIGT løb: status completed + alle etaper kørt. Ikke recovery (stages_completed
  // == stages OG completed) → ægte gen-afvikling skal afvises.
  const completedRace = { ...STAGE_RACE, status: "completed", stages_completed: 3 };
  const supabase = cannedFor(completedRace);
  await assert.rejects(
    () => simulateStageByIndex({ supabase, race: completedRace, stageIndex: 2, ...NOOP_DEPS }),
    /allerede afviklet/,
  );
  // Ingen side-effekter: ingen races-update, ingen applyRaceResults.
  assert.ok(!supabase.__writes.some((w) => w.table === "races" && w.op === "update"), "completed-løb må ikke skrive races");
});

test("FIX 3: status=completed på mellem-etape → kaster også", async () => {
  const completedRace = { ...STAGE_RACE, status: "completed", stages_completed: 1 };
  const supabase = cannedFor(completedRace);
  await assert.rejects(
    () => simulateStageByIndex({ supabase, race: completedRace, stageIndex: 1, ...NOOP_DEPS }),
    /allerede afviklet/,
  );
});

// ── FIX 5: optimistisk lås — konkurrerende run taber → ingen dobbelt-anvendelse ──
test("FIX 5: konkurrent vinder låsen (0 ramte rækker) → afbryd FØR applyRaceResults/standings", async () => {
  let appliedCalled = 0;
  let standingsCalled = 0;
  const supabase = cannedFor(STAGE_RACE, STAGES_3, {}, { lockAffected: 0 }); // låsen taber
  const r = await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    applyRaceResults: async ({ resultRows }) => { appliedCalled++; return { rowsImported: resultRows.length }; },
    updateStandings: async () => { standingsCalled++; },
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.equal(r.skipped, "concurrent_lock_lost", "tabt lås skal rapporteres");
  assert.equal(appliedCalled, 0, "applyRaceResults må IKKE køre når låsen tabes");
  assert.equal(standingsCalled, 0, "standings må IKKE dobbelt-anvendes");
  // Ingen race_results-delete, ingen run-insert (alle side-effekter sprunget over).
  assert.ok(!supabase.__writes.some((w) => w.table === "race_results"), "ingen race_results-skriv ved tabt lås");
  assert.ok(!supabase.__writes.some((w) => w.table === "race_simulation_runs"), "ingen run-insert ved tabt lås");
});

test("FIX 5: vinder af låsen kører fuldt (1 ramt række) — normal sti uændret", async () => {
  let appliedCalled = 0;
  const supabase = cannedFor(STAGE_RACE, STAGES_3, {}, { lockAffected: 1 }); // låsen vinder
  const r = await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    ...NOOP_DEPS,
    applyRaceResults: async ({ resultRows }) => { appliedCalled++; return { rowsImported: resultRows.length }; },
  });
  assert.equal(r.skipped, undefined, "vinder må ikke rapportere skip");
  assert.equal(appliedCalled, 1, "vinder skal anvende resultater");
});

test("FIX 1: resultat-skriv-fejl efter lås → counter rulles tilbage til stageIndex (etape kan gen-køres)", async () => {
  // applyRaceResults kaster (simulér crash midt i resultat-skriv). Vi forventer:
  //   (1) fejlen propagerer (caller ser den), (2) en races-update der ruller
  //   stages_completed TILBAGE til stageIndex (=1), så en gen-afvikling re-kører etapen.
  const supabase = cannedFor();
  await assert.rejects(() => simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    ...NOOP_DEPS,
    applyRaceResults: async () => { throw new Error("DB boom midt i skriv"); },
  }), /DB boom/);
  const raceUpdates = supabase.__writes.filter((w) => w.table === "races" && w.op === "update");
  // (1) lås-update stages_completed=2, derefter (2) rollback til stageIndex=1.
  assert.equal(raceUpdates.length, 2, "forventet lås + rollback");
  assert.equal(raceUpdates[0].obj.stages_completed, 2, "lås bumper til stageNumber");
  assert.equal(raceUpdates[1].obj.stages_completed, 1, "rollback sætter counter tilbage til stageIndex");
});

// ── FIX 1: status sættes EFTER finalization (crash-safe rækkefølge) ───────────
test("FIX 1: final-etape kører finalization FØR status=completed (rækkefølge)", async () => {
  const order = [];
  const supabase = {
    from(table) {
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
        order() { return b; }, gte() { return b; },
        maybeSingle() {
          const data = table === "seasons"
            ? { id: "s1", number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }
            : null;
          return Promise.resolve({ data, error: null });
        },
        insert() { return Promise.resolve({ error: null }); },
        upsert() { return Promise.resolve({ error: null }); },
        update(obj) {
          if (table === "races" && obj.status === "completed") order.push("status_completed");
          const u = {
            eq() { return u; }, in() { return u; },
            select() { return Promise.resolve({ data: [{ id: STAGE_RACE.id }], error: null }); },
            then(res) { return Promise.resolve({ error: null }).then(res); },
          };
          return u;
        },
        delete() {
          const d = { eq() { return d; }, in() { return d; }, then(res) { return Promise.resolve({ error: null }).then(res); } };
          return d;
        },
        then(resolve) {
          const map = {
            race_stage_profiles: STAGES_3,
            race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
            riders: ENTRANTS.map((e) => ({ id: e.rider_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
            rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
            race_points: [],
            race_results: [],
          };
          return Promise.resolve({ data: map[table] || [], error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 2, // final
    applyRaceResults: async ({ resultRows }) => ({ rowsImported: resultRows.length }),
    recomputeRaceDays: async () => { order.push("recompute"); return 12; },
    processBoardWeekend: async () => { order.push("board"); },
    notifyDiscord: async () => { order.push("discord"); },
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.deepEqual(order, ["recompute", "board", "discord", "status_completed"],
    "finalization (recompute→board→discord) skal køre FØR status=completed");
});

// ── FIX 1: recovery — stages_completed >= stages men status != completed ───────
test("FIX 1 recovery: finalization-pending løb re-kører finalization til completed", async () => {
  // Et crash mellem stages_completed-bump og finalization: stages_completed=3 (alle kørt),
  // men status stadig scheduled. En ny invokation (stageIndex=2 = final) skal IDEMPOTENT
  // genoptage finalization OG IKKE genberegne resultater/standings.
  const pendingRace = { ...STAGE_RACE, status: "scheduled", stages_completed: 3 };
  let applied = 0, recompute = 0, board = 0, discord = 0, entriesLoaded = 0;
  const supabase = {
    from(table) {
      if (table === "race_entries") entriesLoaded++;
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
        order() { return b; }, gte() { return b; },
        maybeSingle() {
          const data = table === "seasons"
            ? { id: "s1", number: 2, status: "active", race_days_completed: 9, race_days_total: 60 } : null;
          return Promise.resolve({ data, error: null });
        },
        insert() { return Promise.resolve({ error: null }); },
        upsert() { return Promise.resolve({ error: null }); },
        update(obj) {
          const u = {
            eq() { return u; }, in() { return u; },
            select() { return Promise.resolve({ data: [{ id: pendingRace.id }], error: null }); },
            then(res) { return Promise.resolve({ error: null }).then(res); },
          };
          if (table === "races" && obj.status === "completed") u.__statusFlip = true;
          return u;
        },
        delete() { const d = { eq() { return d; }, in() { return d; }, then(res) { return Promise.resolve({ error: null }).then(res); } }; return d; },
        then(resolve) {
          const map = { race_stage_profiles: STAGES_3, race_results: [] };
          return Promise.resolve({ data: map[table] || [], error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  const r = await simulateStageByIndex({
    supabase, race: pendingRace, stageIndex: 2,
    applyRaceResults: async () => { applied++; return { rowsImported: 0 }; },
    recomputeRaceDays: async () => { recompute++; return 12; },
    processBoardWeekend: async () => { board++; },
    notifyDiscord: async () => { discord++; },
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.equal(r.recovered, true, "recovery skal markeres");
  assert.equal(applied, 0, "recovery må IKKE genanvende resultater");
  assert.equal(entriesLoaded, 0, "recovery må IKKE genindlæse startfeltet");
  assert.equal(recompute, 1, "recovery skal køre recompute");
  assert.equal(board, 1, "recovery skal køre board-weekend");
  assert.equal(discord, 0, "recovery må IKKE gen-sende Discord (dobbelt-send-guard)");
});

// ── FIX 4: scheduler-drevne runs stemples med source='scheduler' ──────────────
test("FIX 4: runSource='scheduler' stempler race_simulation_runs.source", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 1, runSource: "scheduler", ...NOOP_DEPS });
  const runIns = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  assert.ok(runIns, "run-snapshot ikke persisteret");
  assert.ok(runIns.rows.every((row) => row.source === "scheduler"), "scheduler-runs skal have source='scheduler'");
});

test("FIX 4: uden runSource → source=null (admin/manuel run tælles ikke i cap)", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 1, ...NOOP_DEPS });
  const runIns = supabase.__writes.find((w) => w.table === "race_simulation_runs" && w.op === "insert");
  assert.ok(runIns.rows.every((row) => row.source === null), "manuel run skal have source=null");
});
