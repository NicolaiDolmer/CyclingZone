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
//
// #1598: per-etape result-write går nu via apply_stage_result-RPC. Mocken
// implementerer rpc("apply_stage_result", ...) og registrerer kaldet i __rpcCalls
// + et syntetisk __writes-entry (op: "stage_rpc") så de eksisterende counter/results-
// asserts kan re-pege på RPC-parametrene. lockWon honorerer opts.lockAffected.
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

const NOOP_DEPS = {
  recomputeRaceDays: async () => 12,
  processBoardWeekend: async () => ({}),
  applyFatigue: async () => ({ updated: 0 }),
};

// #1598: helper der capturer rækkerne sendt til den atomære RPC (erstatter den
// gamle applyRaceResults-capture). Returnerer en applyStageResult-stub + en getter.
function captureStageResult() {
  let captured = null;
  const applyStageResult = async (_client, { resultRows }) => {
    captured = resultRows;
    return { lockWon: true, rowsImported: resultRows.length };
  };
  return { applyStageResult, rows: () => captured };
}

// ── #2072 KRITISK: dagens etape simuleres ISOLERET; klassementer AKKUMULERES ────
// fra persisterede etaperækker — kørte etaper re-simuleres ALDRIG.

// Byg canned race_results-etaperækker (som DB'en ville have dem persisteret).
function stageRow(stageNumber, riderId, rank, gapStr, teamId = null) {
  const team = teamId ?? ENTRANTS.find((e) => e.rider_id === riderId)?.team_id ?? null;
  return {
    stage_number: stageNumber, result_type: "stage", rank, rider_id: riderId,
    team_id: team, finish_time: gapStr,
  };
}
function parseGap(s) {
  const m = String(s).match(/^\+?(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

test("#2072 determinisme: dagens etape = isoleret simulateStage (samme seed, nuværende fatigue) — bit-for-bit", async () => {
  // Reference: buildStageRowsAccumulated er den rene kerne simulateStageByIndex
  // SKAL bruge for etapeløb. Med tomme prior-rows (etape 1) verificerer vi at
  // orchestratoren sender præcis kernens rækker til den atomære RPC.
  const { buildStageRowsAccumulated } = await import("./raceRunner.js");
  const expected = buildStageRowsAccumulated({
    race: STAGE_RACE, stagesSorted: STAGES_3, stageIndex: 0, entrants: ENTRANTS,
    pointsLookup: {}, priorStageRows: [],
  });
  const supabase = cannedFor();
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 0,
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });
  assert.ok(cap.rows(), "etape 1: apply_stage_result fik ingen rækker");
  assert.deepEqual(cap.rows(), expected.resultRows, "etape 1: orchestrator != ren kerne (bit-for-bit)");
});

test("#2072: klassementer på mellem-etape = akkumulering af persisterede gaps + dagens etape", async () => {
  // Persisteret etape 1 med håndlavede gaps: b4 fører suverænt, climber er nr. 2.
  const prior = [
    stageRow(1, "b4", 1, "+0:00"),
    stageRow(1, "climber", 2, "+0:10"),
    stageRow(1, "sprinter", 3, "+5:00"),
    stageRow(1, "a3", 4, "+5:00"),
    stageRow(1, "a4", 5, "+5:00"),
    stageRow(1, "b1", 6, "+5:00"),
    stageRow(1, "b2", 7, "+5:00"),
    stageRow(1, "b3", 8, "+5:00"),
  ];
  const race = { ...STAGE_RACE, stages_completed: 1 };
  const supabase = cannedFor(race, STAGES_3, { race_results: prior });
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race, stageIndex: 1, // etape 2 (mellem-etape)
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });
  const rows = cap.rows();
  const leaderRows = rows.filter((r) => r.result_type === "leader").sort((a, b) => a.rank - b.rank);
  // FULDT felt (#2081), ikke kun rank 1.
  assert.equal(leaderRows.length, ENTRANTS.length, "leader-rækker skal dække hele feltet");
  // Løbende GC = persisteret etape-1-gap + dagens etape-2-gap (parsede, afrundede).
  const todayGapById = new Map(rows.filter((r) => r.result_type === "stage").map((r) => [r.rider_id, parseGap(r.finish_time)]));
  const cumById = new Map(prior.map((p) => [p.rider_id, parseGap(p.finish_time) + (todayGapById.get(p.rider_id) || 0)]));
  const minCum = Math.min(...cumById.values());
  for (const lr of leaderRows) {
    assert.equal(parseGap(lr.finish_time), cumById.get(lr.rider_id) - minCum,
      `leader-gap for ${lr.rider_id} skal være summen af publicerede etape-gaps`);
  }
  // Sorteringen følger de akkumulerede gaps (b4 og climber har 4:50+ forspring).
  assert.ok(["b4", "climber"].includes(leaderRows[0].rider_id), "akkumuleret føring skal respekteres");
  // Payout-neutral: rank 2+ dag-rækker har 0 point (cannedFor har tom race_points).
  for (const r of rows.filter((row) => ["leader", "points_day", "mountain_day", "young_day"].includes(row.result_type))) {
    assert.equal(r.stage_number, 2, "klassement-rækker bærer dagens stage_number");
  }
  // INGEN team-rækker på mellem-etape.
  assert.ok(!rows.some((r) => r.result_type === "team"), "mellem-etape må ikke skrive team-rækker");
});

test("#2072 accept: slut-GC = sum af persisterede etape-gaps — modsiger ALDRIG publicerede resultater", async () => {
  // Vuelta Burgalesa-formen: de persisterede etaper siger at 'climber' samlet står
  // LANGT foran alle. En frisk re-simulation (gamle arkitektur) kunne sige noget
  // andet — akkumuleringen SKAL følge de publicerede gaps.
  const prior = [];
  for (const stage of [1, 2]) {
    prior.push(stageRow(stage, "climber", 1, "+0:00"));
    let rank = 2;
    for (const e of ENTRANTS.filter((x) => x.rider_id !== "climber")) {
      prior.push(stageRow(stage, e.rider_id, rank, "+20:00"));
      rank++;
    }
  }
  const race = { ...STAGE_RACE, stages_completed: 2 };
  const supabase = cannedFor(race, STAGES_3, { race_results: prior });
  const cap = captureStageResult();
  await simulateStageByIndex({
    supabase, race, stageIndex: 2, // etape 3 = final
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });
  const gcRows = cap.rows().filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank);
  assert.equal(gcRows.length, ENTRANTS.length);
  // 40 minutters persisteret forspring kan ingen enkelt-etape re-sim udligne.
  assert.equal(gcRows[0].rider_id, "climber", "slut-GC skal følge de persisterede etape-gaps");
  // GC-gap = akkumulerede publicerede gaps (rank 2+ ligger 40:00+ efter minus dagens forskel).
  const todayGapById = new Map(cap.rows().filter((r) => r.result_type === "stage").map((r) => [r.rider_id, parseGap(r.finish_time)]));
  for (const g of gcRows.slice(1)) {
    const expected = (2 * 20 * 60 + (todayGapById.get(g.rider_id) || 0)) - (todayGapById.get("climber") || 0);
    assert.equal(parseGap(g.finish_time), expected, `gc-gap for ${g.rider_id} = sum af publicerede gaps`);
  }
});

// ── #2072 accept/regression: feltet ændrer sig mellem etaper (Vuelta Burgalesa) ──
test("#2072 regression: solgt/slettet rytter beholder kørte etaper men udgår af slut-GC; feltets øvrige GC er ren gap-sum", async () => {
  // 'leaver' kørte etape 1-2 (persisteret), men er væk fra feltet før etape 3
  // (solgt/slettet — ikke længere i race_entries/riders). #1844-frysningen
  // rapporterer ham missing; akkumuleringen skal (a) IKKE slette hans etaperækker,
  // (b) udelade ham af slut-klassementerne, (c) beregne de øvriges GC som ren gap-sum.
  const leaver = { rider_id: "leaver", team_id: "B" };
  const prior = [];
  for (const stage of [1, 2]) {
    prior.push(stageRow(stage, "leaver", 1, "+0:00", "B"));
    let rank = 2;
    for (const e of ENTRANTS) {
      prior.push(stageRow(stage, e.rider_id, rank, `+${rank}:00`));
      rank++;
    }
  }
  const race = { ...STAGE_RACE, stages_completed: 2 };
  const supabase = makeSupabase({
    race_stage_profiles: STAGES_3,
    // Feltet NU: kun ENTRANTS — leaver er væk (solgt/slettet).
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    races: [{ id: race.id, ...race }],
    seasons: [{ id: race.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    // Etape-1-snapshot INKLUDERER leaver (han var i startfeltet).
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: [...ENTRANTS.map((e) => e.rider_id), "leaver"] }],
    race_results: prior,
  });
  let capturedArgs = null;
  const rpc = await simulateStageByIndex({
    supabase, race, stageIndex: 2, // final
    ...NOOP_DEPS,
    applyStageResult: async (_client, args) => {
      capturedArgs = args;
      return { lockWon: true, rowsImported: args.resultRows.length };
    },
  });
  assert.equal(rpc.isFinalStage, true);
  const rows = capturedArgs.resultRows;
  // (b) leaver optræder IKKE i nogen slut-klassement-række (gc/points/mountain/young/team).
  for (const t of ["gc", "points", "mountain", "young", "stage"]) {
    assert.ok(!rows.some((r) => r.result_type === t && r.rider_id === "leaver"),
      `leaver må ikke optræde i ${t}-rækker for etape 3`);
  }
  // (a) hans persisterede etaperækker røres ikke: skrivningen er afgrænset til etape 3
  // (RPC'ens idempotente delete-then-insert scoper på stageNumber).
  assert.equal(capturedArgs.stageNumber, 3, "kun etape 3 skrives/slettes");
  assert.ok(rows.every((r) => r.stage_number === 3), "ingen rækker uden for etape 3");
  // (c) slut-GC for de tilbageværende = ren sum af publicerede gaps.
  const gcRows = rows.filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank);
  assert.equal(gcRows.length, ENTRANTS.length, "alle fuldførende ryttere er i slut-GC");
  const todayGapById = new Map(rows.filter((r) => r.result_type === "stage").map((r) => [r.rider_id, parseGap(r.finish_time)]));
  const priorSumById = new Map(ENTRANTS.map((e) => {
    const sum = prior.filter((p) => p.rider_id === e.rider_id).reduce((s, p) => s + parseGap(p.finish_time), 0);
    return [e.rider_id, sum];
  }));
  const cumById = new Map(ENTRANTS.map((e) => [e.rider_id, priorSumById.get(e.rider_id) + (todayGapById.get(e.rider_id) || 0)]));
  const minCum = Math.min(...cumById.values());
  for (const g of gcRows) {
    assert.equal(parseGap(g.finish_time), cumById.get(g.rider_id) - minCum,
      `slut-GC-gap for ${g.rider_id} skal være summen af hans publicerede etape-gaps`);
  }
  // young-klassementet er fortsat kun U25 blandt de fuldførende.
  const young = rows.filter((r) => r.result_type === "young");
  assert.deepEqual(young.map((r) => r.rider_id).sort(), ["b2", "climber"], "young = de 2 fuldførende U25");
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

// ── Persist: KUN etape N's race_results via atomær RPC (idempotent delete+insert) ──
test("persist: kun etape N skrives — atomær RPC med race_id + stage_number=N + kun etape-N-rækker", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1, // etape 2
    ...NOOP_DEPS,
  });
  // #1598: counter-bump + delete + insert sker nu atomisk i apply_stage_result-RPC.
  const rpc = supabase.__rpcCalls.find((c) => c.name === "apply_stage_result");
  assert.ok(rpc, "ingen apply_stage_result-RPC-kald");
  assert.equal(rpc.params.p_race_id, STAGE_RACE.id, "RPC mangler race_id");
  assert.equal(rpc.params.p_stage_number, 2, "RPC mangler stage_number=2 (idempotent delete-scope)");
  assert.equal(rpc.params.p_stage_index, 1, "RPC mangler lås-prædikat stageIndex=1");
  // Alle persisterede rækker er etape 2.
  assert.ok(rpc.params.p_result_rows.length > 0);
  assert.ok(rpc.params.p_result_rows.every((r) => r.stage_number === 2), "ikke-etape-2-rækker lækkede");
});

// ── stages_completed-counter ──────────────────────────────────────────────────
test("counter: stages_completed bumpes til stageNumber via atomær RPC; status IKKE completed på mellem-etape", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 0, ...NOOP_DEPS }); // etape 1 (af 3)
  // #1598: counter-bump sker nu i apply_stage_result-RPC (lås-prædikat stages_completed=stageIndex).
  const rpc = supabase.__rpcCalls.find((c) => c.name === "apply_stage_result");
  assert.ok(rpc, "ingen apply_stage_result-RPC-kald");
  assert.equal(rpc.params.p_stage_number, 1, "RPC bumper stages_completed til stageNumber");
  assert.equal(rpc.params.p_stage_index, 0, "RPC's lås-prædikat = stageIndex");
  // Mellem-etape: INGEN races-table .update() (counter-bump er i RPC, ingen status-flip).
  const raceUpdates = supabase.__writes.filter((w) => w.table === "races" && w.op === "update");
  assert.equal(raceUpdates.length, 0, "mellem-etape må ikke lave nogen races .update() (counter er i RPC)");
});

test("counter: final-etape — RPC bumper stages_completed=stageNumber, derefter ÉN status=completed-update (status SIDST)", async () => {
  const supabase = cannedFor();
  await simulateStageByIndex({ supabase, race: STAGE_RACE, stageIndex: 2, ...NOOP_DEPS }); // etape 3 = final
  // RPC bumper counter til 3 (final-etapens stageNumber).
  const rpc = supabase.__rpcCalls.find((c) => c.name === "apply_stage_result");
  assert.ok(rpc, "ingen apply_stage_result-RPC-kald");
  assert.equal(rpc.params.p_stage_number, 3, "RPC bumper counter til final-etapens stageNumber");
  // Final-etape: PRÆCIS én races .update() = status-flip (FIX 1: status sidst, efter finalization).
  const raceUpdates = supabase.__writes.filter((w) => w.table === "races" && w.op === "update");
  assert.equal(raceUpdates.length, 1, "final-etape: kun status-flip-update (counter-bump er i RPC)");
  const finalUpd = raceUpdates[0];
  assert.equal(finalUpd.obj.status, "completed");
  assert.equal(finalUpd.obj.stages_completed, 3);
});

// ── Finalization-gating ───────────────────────────────────────────────────────
test("gating: mellem-etape kalder IKKE recompute/board/discord", async () => {
  const supabase = cannedFor();
  let recompute = 0, board = 0, discord = 0;
  await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 0, // etape 1
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

  // stageIndex=1: feltet er allerede persisteret (etape 0). #1844: ingen auto-fill og
  // intet race_entries-insert ved etape>0 — feltet er låst.
  const stageOneSb = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.filter((e) => e.team_id === "A").map((e) => ({ rider_id: e.rider_id, team_id: "A" })),
    teams: [{ id: "A", is_test_account: false, is_frozen: false }],
    riders: ENTRANTS.filter((e) => e.team_id === "A").map((e) => ({ id: e.rider_id, team_id: "A", firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9 }],
  });
  await simulateStageByIndex({ supabase: stageOneSb, race: STAGE_RACE, stageIndex: 1, ...NOOP_DEPS });
  const insertedAt1 = stageOneSb.__writes.find((w) => w.table === "race_entries" && w.op === "insert");
  assert.equal(insertedAt1, undefined, "stageIndex=1: må IKKE persistere/auto-fylde race_entries (felt låst, #1844)");
});

test("#1844: mid-race-intruder (i entries men ikke i etape-1-snapshot) ekskluderes fra resultater", async () => {
  // Boucles-scenariet: en rytter blev tilføjet entries efter etape 1. Feltet er låst til
  // etape-1-snapshot'et → intruderen må ikke simuleres/optræde i senere etapers resultater.
  const intruder = { rider_id: "intruder", team_id: "A" };
  const allEntries = [...ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })), intruder];
  const sb = makeSupabase({
    race_stage_profiles: STAGES_3,
    race_entries: allEntries,
    riders: [...ENTRANTS, { rider_id: "intruder", team_id: "A", is_u25: false }]
      .map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: [...ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })), { rider_id: "intruder", ...abil() }],
    race_points: [],
    races: [{ id: STAGE_RACE.id, ...STAGE_RACE }],
    seasons: [{ id: STAGE_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    // Etape-1-snapshot UDEN intruder → feltet er låst til disse ryttere.
    race_simulation_runs: [{ stage_number: 1, entrant_snapshot: ENTRANTS.map((e) => e.rider_id) }],
  });
  const cap = captureStageResult();
  await simulateStageByIndex({ supabase: sb, race: STAGE_RACE, stageIndex: 1, ...NOOP_DEPS, applyStageResult: cap.applyStageResult });
  const riderIdsInResult = new Set((cap.rows() || []).filter((r) => r.rider_id).map((r) => r.rider_id));
  assert.ok(!riderIdsInResult.has("intruder"), "mid-race-intruder må IKKE optræde i etape-resultater (#1844)");
  assert.ok(riderIdsInResult.has("climber"), "start-feltets ryttere er stadig med");
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
    /already simulated/,
  );
  // Ingen side-effekter: ingen races-update, ingen apply_stage_result-RPC.
  assert.ok(!supabase.__writes.some((w) => w.table === "races" && w.op === "update"), "completed-løb må ikke skrive races");
  assert.ok(!supabase.__rpcCalls.some((c) => c.name === "apply_stage_result"), "completed-løb må ikke kalde apply_stage_result");
});

test("FIX 3: status=completed på mellem-etape → kaster også", async () => {
  const completedRace = { ...STAGE_RACE, status: "completed", stages_completed: 1 };
  const supabase = cannedFor(completedRace);
  await assert.rejects(
    () => simulateStageByIndex({ supabase, race: completedRace, stageIndex: 1, ...NOOP_DEPS }),
    /already simulated/,
  );
});

// ── FIX 5: optimistisk lås — konkurrerende run taber → ingen dobbelt-anvendelse ──
test("FIX 5: konkurrent vinder låsen (RPC lockWon=false) → afbryd FØR standings", async () => {
  let standingsCalled = 0;
  const supabase = cannedFor(STAGE_RACE, STAGES_3, {}, { lockAffected: 0 }); // RPC taber låsen
  const r = await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    updateStandings: async () => { standingsCalled++; },
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.equal(r.skipped, "concurrent_lock_lost", "tabt lås skal rapporteres");
  assert.equal(standingsCalled, 0, "standings må IKKE dobbelt-anvendes ved tabt lås");
  // RPC blev kaldt (med lås-prædikatet), men kørte ingen side-effekter (lockWon=false).
  assert.ok(supabase.__rpcCalls.some((c) => c.name === "apply_stage_result"), "RPC skal forsøges (låsen evalueres i RPC)");
  // Ingen run-insert (alle post-RPC side-effekter sprunget over).
  assert.ok(!supabase.__writes.some((w) => w.table === "race_simulation_runs"), "ingen run-insert ved tabt lås");
});

test("FIX 5: vinder af låsen kører fuldt (RPC lockWon=true) — normal sti uændret", async () => {
  const supabase = cannedFor(STAGE_RACE, STAGES_3, {}, { lockAffected: 1 }); // RPC vinder låsen
  const cap = captureStageResult();
  const r = await simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    ...NOOP_DEPS,
    applyStageResult: cap.applyStageResult,
  });
  assert.equal(r.skipped, undefined, "vinder må ikke rapportere skip");
  assert.ok(cap.rows(), "vinder skal sende resultater til den atomære RPC");
  assert.ok(r.rowsImported > 0, "vinder skal rapportere rowsImported");
});

test("#1598: result-write-fejl i RPC propagerer (transaktion ruller ALT tilbage — ingen JS-rollback)", async () => {
  // RPC'en wrapper counter-bump + delete + insert atomisk. En fejl ruller HELE
  // transaktionen tilbage I POSTGRES — der er INTET JS-counter-rollback-trin mere
  // (den gamle FIX-1-rollback er overflødiggjort). Vi verificerer at fejlen
  // propagerer OG at JS IKKE laver nogen kompenserende races-update.
  const supabase = cannedFor();
  await assert.rejects(() => simulateStageByIndex({
    supabase, race: STAGE_RACE, stageIndex: 1,
    ...NOOP_DEPS,
    applyStageResult: async () => { throw new Error("DB boom i atomær RPC"); },
  }), /DB boom/);
  // INGEN kompenserende races-update i JS — atomiciteten ligger i Postgres-transaktionen.
  const raceUpdates = supabase.__writes.filter((w) => w.table === "races" && w.op === "update");
  assert.equal(raceUpdates.length, 0, "ingen JS-counter-rollback (RPC-transaktionen ruller selv tilbage)");
});

// ── FIX 1: status sættes EFTER finalization (crash-safe rækkefølge) ───────────
test("FIX 1: final-etape kører finalization FØR status=completed (rækkefølge)", async () => {
  const order = [];
  const supabase = {
    rpc(name) {
      // #1598: result-write (counter+results) via atomær RPC — committer FØR standings.
      if (name === "apply_stage_result") order.push("stage_rpc");
      return Promise.resolve({ data: { lock_won: true, rows_imported: 1 }, error: null });
    },
    from(table) {
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
        order() { return b; }, limit() { return b; }, range() { return b; }, gte() { return b; }, lt() { return b; },
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
            riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
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
    recomputeRaceDays: async () => { order.push("recompute"); return 12; },
    processBoardWeekend: async () => { order.push("board"); },
    notifyDiscord: async () => { order.push("discord"); },
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.deepEqual(order, ["stage_rpc", "recompute", "board", "discord", "status_completed"],
    "atomær result-write (stage_rpc) → finalization (recompute→board→discord) → status=completed");
});

// ── FIX 1: recovery — stages_completed >= stages men status != completed ───────
test("FIX 1 recovery: finalization-pending løb re-kører finalization til completed", async () => {
  // Et crash mellem stages_completed-bump og finalization: stages_completed=3 (alle kørt),
  // men status stadig scheduled. En ny invokation (stageIndex=2 = final) skal IDEMPOTENT
  // genoptage finalization OG IKKE genberegne resultater/standings.
  const pendingRace = { ...STAGE_RACE, status: "scheduled", stages_completed: 3 };
  let rpcCalled = 0, recompute = 0, board = 0, discord = 0, entriesLoaded = 0;
  const supabase = {
    from(table) {
      if (table === "race_entries") entriesLoaded++;
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; },
        order() { return b; }, limit() { return b; }, range() { return b; }, gte() { return b; }, lt() { return b; },
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
    applyStageResult: async () => { rpcCalled++; return { lockWon: true, rowsImported: 0 }; },
    recomputeRaceDays: async () => { recompute++; return 12; },
    processBoardWeekend: async () => { board++; },
    notifyDiscord: async () => { discord++; },
    applyFatigue: async () => ({ updated: 0 }),
  });
  assert.equal(r.recovered, true, "recovery skal markeres");
  assert.equal(rpcCalled, 0, "recovery må IKKE kalde den atomære result-write-RPC");
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
