// #1187 · Tests for live-wiring af løbende bestyrelses-tilfredshed.
// =============================================================================
// Dækker:
//   - resolveCrossedCheckpoint (pure: mid-season-krydsning af race-days-midpoint)
//   - processBoardWeekendFinalization orchestrator:
//       · persisterer satisfaction + budget_modifier + sæson-anker på board_profiles
//       · anker genbruges fra weekend 2 (target-tracking, ingen dobbelt-drift)
//       · selv-healer anker ved sæson-skift (anchor-season-mismatch)
//       · ekskluderer AI-/bank-/test-/frosne hold (match-UI-filter-reglen)
//       · skipper baseline- og pending-planer
//       · hårde konsekvens-lag kun ved mid-season-checkpoint-krydsning
//       · board_test_mode: satisfaction bevæger sig stadig, men konsekvens-
//         motoren får boardTestMode=true (lag 4/5 suppress dér)
//       · ikke-aktiv sæson → no-op (historiske re-imports)
// Selve clamp-/target-mekanikken er dækket i boardWeekendUpdate.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import {
  processBoardWeekendFinalization,
  resolveCrossedCheckpoint,
} from "./boardWeekendFinalization.js";
import { CHECKPOINT_KINDS } from "./boardWeekendUpdate.js";

// ─── Fake supabase (select/in/eq/order/limit + update.eq) ─────────────────────

function makeFakeSupabase(state, opts = {}) {
  const updates = []; // { table, payload, filters }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function tableRows(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function makeQuery(table, action, payload = null) {
    const filters = [];
    let order = null;
    let limit = null;

    function matches(row) {
      return filters.every((f) => {
        if (f.type === "eq") return row[f.column] === f.value;
        if (f.type === "in") return f.values.includes(row[f.column]);
        return true;
      });
    }

    function execute() {
      const rows = tableRows(table);
      if (action === "select") {
        let result = rows.filter(matches);
        if (order) {
          result = [...result].sort((a, b) => {
            const av = a[order.column];
            const bv = b[order.column];
            if (av === bv) return 0;
            const cmp = av < bv ? -1 : 1;
            return order.ascending ? cmp : -cmp;
          });
        }
        if (limit != null) result = result.slice(0, limit);
        return Promise.resolve({ data: clone(result), error: null });
      }
      if (action === "update") {
        const hit = rows.filter(matches);
        for (const row of hit) Object.assign(row, clone(payload));
        updates.push({ table, payload: clone(payload), filters: clone(filters) });
        return Promise.resolve({ data: clone(hit), error: null });
      }
      if (action === "upsert") {
        if (opts.errorTables?.[table]) {
          return Promise.resolve({ data: null, error: { message: opts.errorTables[table] } });
        }
        const payloadArr = Array.isArray(payload) ? payload : [payload];
        for (const row of payloadArr) rows.push(clone(row));
        updates.push({ table, action: "upsert", payload: clone(payload) });
        return Promise.resolve({ data: clone(payloadArr), error: null });
      }
      if (action === "insert") {
        const newRows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
          id: row.id || `${table}-${Math.random().toString(36).slice(2, 8)}`,
          ...clone(row),
        }));
        rows.push(...newRows);
        return Promise.resolve({ data: clone(newRows), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      in(column, values) { filters.push({ type: "in", column, values }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select() { return query; },
      single() { return execute().then((r) => ({ data: r.data?.[0] || null, error: r.error })); },
      maybeSingle() { return execute().then((r) => ({ data: r.data?.[0] || null, error: r.error })); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }

  return {
    updates,
    from(table) {
      tableRows(table);
      return {
        select() { return makeQuery(table, "select"); },
        update(payload) { return makeQuery(table, "update", payload); },
        insert(payload) { return makeQuery(table, "insert", payload); },
        upsert(payload, _opts) { return makeQuery(table, "upsert", payload); },
      };
    },
  };
}

// ─── State-fixture ────────────────────────────────────────────────────────────

const SEASON = { id: "season-2", number: 2, status: "active", race_days_completed: 12, race_days_total: 60 };

function makeState(overrides = {}) {
  return {
    teams: [
      {
        id: "team-1", user_id: "user-1", name: "Human Hold", division: 1,
        sponsor_income: 2_500_000, season_1_identity_basis: null, team_dna_key: null,
        is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "board-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
        satisfaction: 50, budget_modifier: 1.0, current_goals: [],
        negotiation_status: "completed", is_baseline: false,
        seasons_completed: 0, cumulative_stage_wins: 0, cumulative_gc_wins: 0,
        plan_start_season_number: 2, plan_start_sponsor_income: 2_500_000,
        season_start_satisfaction: null, season_start_anchor_season_id: null,
      },
    ],
    season_standings: [
      {
        team_id: "team-1", season_id: "season-2", division: 1, rank_in_division: 4,
        total_points: 120, stage_wins: 1, gc_wins: 0, team: { is_ai: false },
      },
    ],
    riders: [
      { id: "rider-1", team_id: "team-1", firstname: "Test", lastname: "Rytter", is_u25: false, popularity: 10, market_value: 100_000, salary: 10_000 },
    ],
    loans: [],
    board_plan_snapshots: [],
    ...overrides,
  };
}

// Stub-mekanik: deterministisk bevægelse uafhængig af mål-evaluering.
function stubComputeUpdate({ newSatisfaction = 45, newModifier = 1.0, goalsMet = 0, goalsTotal = 0 } = {}) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    return {
      previousSatisfaction: args.board.satisfaction,
      seasonStartSatisfaction: args.seasonStartSatisfaction,
      newSatisfaction,
      newModifier,
      goalsMet,
      goalsTotal,
      appliedDelta: newSatisfaction - args.board.satisfaction,
    };
  };
  fn.calls = calls;
  return fn;
}

function baseDeps(overrides = {}) {
  return {
    isBoardTestModeActive: async () => false,
    loadGoalContext: async () => ({ divisionManagerCount: 1 }),
    evaluateAndApplyConsequences: async () => ({ applied: [], skipped: [] }),
    notifyTeamOwner: async () => ({ delivered: true }),
    ...overrides,
  };
}

// ─── resolveCrossedCheckpoint (pure) ──────────────────────────────────────────

test("resolveCrossedCheckpoint: krydsning af midpoint → mid_season", () => {
  assert.equal(
    resolveCrossedCheckpoint({ previousRaceDaysCompleted: 24, raceDaysCompleted: 30, raceDaysTotal: 60 }),
    CHECKPOINT_KINDS.MID_SEASON,
  );
  // Spring HEN OVER midpoint tæller også som krydsning.
  assert.equal(
    resolveCrossedCheckpoint({ previousRaceDaysCompleted: 28, raceDaysCompleted: 36, raceDaysTotal: 60 }),
    CHECKPOINT_KINDS.MID_SEASON,
  );
});

test("resolveCrossedCheckpoint: ingen krydsning → null", () => {
  // Før midpoint
  assert.equal(resolveCrossedCheckpoint({ previousRaceDaysCompleted: 6, raceDaysCompleted: 12, raceDaysTotal: 60 }), null);
  // Allerede forbi midpoint (idempotens ved re-import: prev == new)
  assert.equal(resolveCrossedCheckpoint({ previousRaceDaysCompleted: 30, raceDaysCompleted: 30, raceDaysTotal: 60 }), null);
  assert.equal(resolveCrossedCheckpoint({ previousRaceDaysCompleted: 36, raceDaysCompleted: 42, raceDaysTotal: 60 }), null);
});

test("resolveCrossedCheckpoint: sæson-slut håndteres IKKE her (processSeasonEnd ejer det)", () => {
  assert.equal(resolveCrossedCheckpoint({ previousRaceDaysCompleted: 54, raceDaysCompleted: 60, raceDaysTotal: 60 }), null);
});

test("resolveCrossedCheckpoint: ukendt udgangspunkt (prev=null) → aldrig checkpoint", () => {
  assert.equal(resolveCrossedCheckpoint({ previousRaceDaysCompleted: null, raceDaysCompleted: 30, raceDaysTotal: 60 }), null);
});

// ─── Orchestrator ─────────────────────────────────────────────────────────────

test("weekend-finalization persisterer satisfaction + modifier + anker på board_profiles", async () => {
  const state = makeState();
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 45, newModifier: 1.0 });

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 6,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  assert.equal(summary.boards_updated, 1);
  assert.equal(summary.errors, 0);
  const board = state.board_profiles[0];
  assert.equal(board.satisfaction, 45);
  assert.equal(board.budget_modifier, 1.0);
  // Første weekend i sæsonen: anker = den uberørte start-værdi + sæson-id.
  assert.equal(board.season_start_satisfaction, 50);
  assert.equal(board.season_start_anchor_season_id, "season-2");
});

test("weekend 2+: gemt anker genbruges som target-anker (ingen dobbelt-drift)", async () => {
  const state = makeState();
  // Weekend 1 har allerede flyttet værdien og skrevet ankeret.
  state.board_profiles[0].satisfaction = 45;
  state.board_profiles[0].season_start_satisfaction = 50;
  state.board_profiles[0].season_start_anchor_season_id = "season-2";
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 40 });

  await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 12,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  assert.equal(compute.calls.length, 1);
  assert.equal(compute.calls[0].seasonStartSatisfaction, 50, "ankeret skal være sæson-START-værdien, ikke den løbende");
  assert.equal(state.board_profiles[0].season_start_satisfaction, 50, "ankeret må ikke re-ankres midt i sæsonen");
});

test("sæson-skift selv-healer ankeret (anchor-season-mismatch → re-anker)", async () => {
  const state = makeState();
  state.board_profiles[0].satisfaction = 38;
  state.board_profiles[0].season_start_satisfaction = 50;
  state.board_profiles[0].season_start_anchor_season_id = "season-1"; // GAMMEL sæson
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 40 });

  await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 0,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  assert.equal(compute.calls[0].seasonStartSatisfaction, 38, "ny sæson → anker = aktuel (uberørt) værdi");
  assert.equal(state.board_profiles[0].season_start_anchor_season_id, "season-2");
  assert.equal(state.board_profiles[0].season_start_satisfaction, 38);
});

test("AI-/bank-/test-/frosne hold ekskluderes (match-UI-filter)", async () => {
  const state = makeState();
  state.teams.push(
    { id: "team-ai", user_id: null, name: "AI", division: 1, sponsor_income: 0, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
    { id: "team-test", user_id: "u-t", name: "Testkonto", division: 1, sponsor_income: 0, is_ai: false, is_bank: false, is_frozen: false, is_test_account: true },
    { id: "team-frozen", user_id: "u-f", name: "Frossen", division: 1, sponsor_income: 0, is_ai: false, is_bank: false, is_frozen: true, is_test_account: false },
  );
  for (const teamId of ["team-ai", "team-test", "team-frozen"]) {
    state.board_profiles.push({
      id: `board-${teamId}`, team_id: teamId, plan_type: "1yr", focus: "balanced",
      satisfaction: 50, budget_modifier: 1.0, current_goals: [],
      negotiation_status: "completed", is_baseline: false, seasons_completed: 0,
      cumulative_stage_wins: 0, cumulative_gc_wins: 0,
    });
    state.season_standings.push({
      team_id: teamId, season_id: "season-2", division: 1, rank_in_division: 9,
      total_points: 1, stage_wins: 0, gc_wins: 0, team: { is_ai: teamId === "team-ai" },
    });
  }
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 45 });

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 6,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  assert.equal(summary.boards_updated, 1, "kun det rigtige human-hold opdateres");
  assert.equal(state.board_profiles.find((b) => b.team_id === "team-ai").satisfaction, 50);
  assert.equal(state.board_profiles.find((b) => b.team_id === "team-test").satisfaction, 50);
  assert.equal(state.board_profiles.find((b) => b.team_id === "team-frozen").satisfaction, 50);
});

test("pending-planer skippes fortsat; baseline-boards deltager nu (#2521)", async () => {
  const state = makeState();
  state.teams[0].balance = 100_000;
  state.board_profiles.push(
    { id: "board-baseline", team_id: "team-1", plan_type: "baseline", is_baseline: true, negotiation_status: "completed", satisfaction: 50, budget_modifier: 1.0, current_goals: [] },
    { id: "board-pending", team_id: "team-1", plan_type: "3yr", is_baseline: false, negotiation_status: "pending", satisfaction: 50, current_goals: [] },
  );
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 45 });

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 6,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  // team-1's negotiated 1yr-board + dens baseline-søster-row opdateres begge.
  // Den PENDING 3yr-forhandling ("ikke-signeret endnu") skippes fortsat.
  assert.equal(summary.boards_updated, 2);
  assert.equal(summary.baseline_boards_updated, 1);
  assert.notEqual(state.board_profiles.find((b) => b.id === "board-baseline").satisfaction, 50,
    "baseline-satisfaction skal bevæge sig — den er ikke længere låst på 50");
  assert.equal(state.board_profiles.find((b) => b.id === "board-baseline").budget_modifier, 1.0,
    "budget_modifier ændres ALDRIG for baseline");
  assert.equal(state.board_profiles.find((b) => b.id === "board-pending").satisfaction, 50);
});

// ─── #2521 · Baseline-bestyrelsen lever ────────────────────────────────────────

test("#2521 · baseline-boards bevæger sig mod percentil+økonomi-target, ALDRIG budget_modifier eller hårde konsekvenser", async () => {
  const state = makeState(); // team-1: negotiated 1yr-board, uændret sti
  state.teams.push(
    { id: "team-base-a", user_id: "u-a", name: "Baseline A", division: 1, sponsor_income: 100, balance: 100_000, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    { id: "team-base-b", user_id: "u-b", name: "Baseline B", division: 1, sponsor_income: 100, balance: 100_000, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
  );
  state.board_profiles.push(
    { id: "board-base-a", team_id: "team-base-a", plan_type: "baseline", is_baseline: true, negotiation_status: "completed", satisfaction: 50, budget_modifier: 1.0, current_goals: [] },
    { id: "board-base-b", team_id: "team-base-b", plan_type: "baseline", is_baseline: true, negotiation_status: "completed", satisfaction: 50, budget_modifier: 1.0, current_goals: [] },
  );
  state.season_standings.push(
    { team_id: "team-base-a", season_id: "season-2", division: 1, league_division_id: 9, rank_in_division: 1, stage_wins: 0, gc_wins: 0, team: { is_ai: false, is_bank: false, is_frozen: false, is_test_account: false } },
    { team_id: "team-base-b", season_id: "season-2", division: 1, league_division_id: 9, rank_in_division: 2, stage_wins: 0, gc_wins: 0, team: { is_ai: false, is_bank: false, is_frozen: false, is_test_account: false } },
  );
  const supabase = makeFakeSupabase(state);
  const consequenceCalls = [];

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON, race_days_completed: 30 }, // krydser midpoint (60/2=30) fra 24
    previousRaceDaysCompleted: 24,
    deps: baseDeps({
      computeWeekendUpdate: stubComputeUpdate({ newSatisfaction: 45 }),
      evaluateAndApplyConsequences: async (args) => { consequenceCalls.push(args); return { applied: [{ layer: 2 }] }; },
    }),
  });

  assert.equal(summary.checkpoint, CHECKPOINT_KINDS.MID_SEASON);
  const boardA = state.board_profiles.find((b) => b.id === "board-base-a"); // rank 1 → percentil 1
  const boardB = state.board_profiles.find((b) => b.id === "board-base-b"); // rank 2 → percentil 0
  // target A = 50 + 18 (percentil 1) + 5 (sund saldo) = 73 → op-clamp 8 → 58.
  // target B = 50 − 18 (percentil 0) + 5 (sund saldo) = 37 → ned-clamp 5 → 45.
  assert.equal(boardA.satisfaction, 58);
  assert.equal(boardB.satisfaction, 45);
  assert.equal(boardA.budget_modifier, 1.0, "budget_modifier RØRES ikke af baseline-mekanikken");
  assert.equal(boardB.budget_modifier, 1.0);

  // Kun team-1's NEGOTIEREDE board må ramme evaluateAndApplyConsequences ved
  // checkpointet — baseline-boards springes eksplicit over (design-krav #2521 pkt 3).
  assert.equal(consequenceCalls.length, 1);
  assert.equal(consequenceCalls[0].board.id, "board-1");
  assert.ok(!consequenceCalls.some((call) => call.board.is_baseline), "baseline-boards får ALDRIG hårde konsekvens-lag");
  assert.equal(summary.baseline_boards_updated, 2);
  assert.equal(summary.boards_updated, 3); // 1 negotieret + 2 baseline
});

test("#2521 · baseline-boards skriver board_satisfaction_events uden goals (0/0, reason_category null)", async () => {
  const season = { id: "s2", number: 2, status: "active", race_days_completed: 10, race_days_total: 40 };
  const state = {
    teams: [{ id: "t1", user_id: "u1", name: "Baseline-hold", balance: 5000, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    board_profiles: [{ id: "b1", team_id: "t1", plan_type: "baseline", is_baseline: true, negotiation_status: "completed", satisfaction: 50, budget_modifier: 1.0, current_goals: [] }],
    season_standings: [{ team_id: "t1", season_id: "s2", division: 1, rank_in_division: 1, stage_wins: 0, gc_wins: 0, team: { is_ai: false } }],
    riders: [], loans: [], board_plan_snapshots: [], board_satisfaction_events: [],
  };
  const supabase = makeFakeSupabase(state);

  const summary = await processBoardWeekendFinalization({
    supabase, season, previousRaceDaysCompleted: 8,
    race: { id: "r9", name: "Baseline-testløb" },
    deps: { isBoardTestModeActive: async () => false, notifyTeamOwner: async () => ({}) },
  });

  assert.equal(summary.baseline_boards_updated, 1);
  assert.equal(state.board_satisfaction_events.length, 1);
  const ev = state.board_satisfaction_events[0];
  assert.equal(ev.board_id, "b1");
  assert.equal(ev.goals_met, 0);
  assert.equal(ev.goals_total, 0);
  assert.equal(ev.reason_category, null);
  assert.equal(state.board_profiles[0].budget_modifier, 1.0);
});

test("hårde konsekvens-lag kører KUN ved mid-season-krydsning", async () => {
  // 1) Ingen krydsning → ingen konsekvens-evaluering
  {
    const state = makeState();
    const supabase = makeFakeSupabase(state);
    const consequenceCalls = [];
    await processBoardWeekendFinalization({
      supabase,
      season: { ...SEASON, race_days_completed: 12 },
      previousRaceDaysCompleted: 6,
      deps: baseDeps({
        computeWeekendUpdate: stubComputeUpdate({ newSatisfaction: 10 }), // langt under alle tærskler
        evaluateAndApplyConsequences: async (args) => { consequenceCalls.push(args); return { applied: [] }; },
      }),
    });
    assert.equal(consequenceCalls.length, 0, "satisfaction under tærskel mellem checkpoints må IKKE udløse hårde lag");
  }

  // 2) Krydsning af midpoint → konsekvens-evaluering med den nye satisfaction
  {
    const state = makeState();
    const supabase = makeFakeSupabase(state);
    const consequenceCalls = [];
    const summary = await processBoardWeekendFinalization({
      supabase,
      season: { ...SEASON, race_days_completed: 30 },
      previousRaceDaysCompleted: 24,
      deps: baseDeps({
        computeWeekendUpdate: stubComputeUpdate({ newSatisfaction: 35, goalsMet: 1, goalsTotal: 4 }),
        evaluateAndApplyConsequences: async (args) => { consequenceCalls.push(args); return { applied: [{ layer: 2 }] }; },
      }),
    });
    assert.equal(summary.checkpoint, CHECKPOINT_KINDS.MID_SEASON);
    assert.equal(consequenceCalls.length, 1);
    assert.equal(consequenceCalls[0].newSatisfaction, 35);
    assert.equal(consequenceCalls[0].planIsComplete, false);
    assert.equal(consequenceCalls[0].boardTestMode, false);
    assert.equal(summary.consequences_applied, 1);
  }
});

test("board_test_mode: satisfaction bevæger sig stadig, men konsekvens-motoren får boardTestMode=true", async () => {
  const state = makeState();
  const supabase = makeFakeSupabase(state);
  const consequenceCalls = [];

  await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON, race_days_completed: 30 },
    previousRaceDaysCompleted: 24,
    deps: baseDeps({
      isBoardTestModeActive: async () => true,
      computeWeekendUpdate: stubComputeUpdate({ newSatisfaction: 14, newModifier: 0.8 }),
      evaluateAndApplyConsequences: async (args) => { consequenceCalls.push(args); return { applied: [] }; },
    }),
  });

  // Satisfaction + modifier persisteres synligt — test-mode fryser kun
  // ØKONOMI-effekten (processSeasonStart tvinger 1.0; lag 4/5 suppress nedenfor).
  assert.equal(state.board_profiles[0].satisfaction, 14);
  assert.equal(state.board_profiles[0].budget_modifier, 0.8);
  assert.equal(consequenceCalls.length, 1);
  assert.equal(consequenceCalls[0].boardTestMode, true, "lag 4/5-suppress styres af flaget i boardConsequences");
});

test("ikke-aktiv sæson → no-op (historiske re-imports flytter ikke satisfaction)", async () => {
  const state = makeState();
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 45 });

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON, status: "completed" },
    previousRaceDaysCompleted: 6,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  assert.equal(summary.skipped_reason, "season_not_active");
  assert.equal(summary.boards_updated, 0);
  assert.equal(state.board_profiles[0].satisfaction, 50);
});

test("hold uden standing endnu skippes (ingen løbsdata → intet target)", async () => {
  const state = makeState({ season_standings: [] });
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 45 });

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 6,
    deps: baseDeps({ computeWeekendUpdate: compute }),
  });

  assert.equal(summary.boards_updated, 0);
  assert.equal(state.board_profiles[0].satisfaction, 50);
});

test("integrationssti: ægte mekanik (uden stub) flytter højst ±5 og persisterer modifier konsistent", async () => {
  const state = makeState();
  // Mål der tydeligt missess → negativt target, clamped til -5 pr. weekend.
  state.board_profiles[0].current_goals = [
    { type: "stage_wins", target: 30, label: "30 etapesejre", category: "results", weight: 1 },
  ];
  const supabase = makeFakeSupabase(state);

  const summary = await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 6,
    deps: baseDeps(), // ingen computeWeekendUpdate-stub → ægte boardWeekendUpdate
  });

  assert.equal(summary.boards_updated, 1);
  const board = state.board_profiles[0];
  assert.ok(Math.abs(board.satisfaction - 50) <= 5, `bevægelse clamped ±5, fik ${board.satisfaction}`);
  assert.ok(board.budget_modifier >= 0.8 && board.budget_modifier <= 1.2, "modifier i lag-1-båndet");
});

// ─── #1451 · board_satisfaction_events-logging (visnings-only) ─────────────────

test("skriver board_satisfaction_events pr. board når race medsendes", async () => {
  const season = { id: "s2", number: 2, status: "active", race_days_completed: 10, race_days_total: 40 };
  const state = {
    teams: [{ id: "t1", user_id: "u1", name: "Alpha", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    board_profiles: [{ id: "b1", team_id: "t1", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 50, seasons_completed: 0 }],
    season_standings: [{ team_id: "t1", season_id: "s2", division: 1, stage_wins: 1, gc_wins: 0 }],
    riders: [], loans: [], board_plan_snapshots: [], board_satisfaction_events: [],
  };
  const supabase = makeFakeSupabase(state);
  await processBoardWeekendFinalization({
    supabase, season, previousRaceDaysCompleted: 8,
    race: { id: "r9", name: "Critérium du Dauphiné" },
    deps: {
      isBoardTestModeActive: async () => false,
      loadGoalContext: async () => ({}),
      computeWeekendUpdate: () => ({
        previousSatisfaction: 50, newSatisfaction: 53, appliedDelta: 3,
        newModifier: 1.0, goalsMet: 2, goalsTotal: 3,
        evaluation: { feedback: { strongest_category: "results", weakest_category: "identity" } },
      }),
    },
  });
  assert.equal(state.board_satisfaction_events.length, 1);
  const ev = state.board_satisfaction_events[0];
  assert.equal(ev.board_id, "b1");
  assert.equal(ev.race_id, "r9");
  assert.equal(ev.race_name, "Critérium du Dauphiné");
  assert.equal(ev.satisfaction_delta, 3);
  assert.equal(ev.reason_category, "results");
});

test("skriver IKKE event når race mangler", async () => {
  const season = { id: "s2", number: 2, status: "active", race_days_completed: 10, race_days_total: 40 };
  const state = {
    teams: [{ id: "t1", user_id: "u1", name: "Alpha", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    board_profiles: [{ id: "b1", team_id: "t1", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 50, seasons_completed: 0 }],
    season_standings: [{ team_id: "t1", season_id: "s2", division: 1, stage_wins: 0, gc_wins: 0 }],
    riders: [], loans: [], board_plan_snapshots: [], board_satisfaction_events: [],
  };
  const supabase = makeFakeSupabase(state);
  await processBoardWeekendFinalization({
    supabase, season, previousRaceDaysCompleted: 8,
    deps: {
      isBoardTestModeActive: async () => false,
      loadGoalContext: async () => ({}),
      computeWeekendUpdate: () => ({
        previousSatisfaction: 50, newSatisfaction: 53, appliedDelta: 3,
        newModifier: 1.0, goalsMet: 2, goalsTotal: 3, evaluation: { feedback: {} },
      }),
    },
  });
  assert.equal(state.board_satisfaction_events.length, 0);
});

test("event-skrive-fejl tæller i errors uden at vælte mekanikken", async () => {
  const season = { id: "s2", number: 2, status: "active", race_days_completed: 10, race_days_total: 40 };
  const state = {
    teams: [{ id: "t1", user_id: "u1", name: "Alpha", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    board_profiles: [{ id: "b1", team_id: "t1", plan_type: "1yr", is_baseline: false, negotiation_status: "completed", satisfaction: 50, seasons_completed: 0 }],
    season_standings: [{ team_id: "t1", season_id: "s2", division: 1, stage_wins: 1, gc_wins: 0 }],
    riders: [], loans: [], board_plan_snapshots: [], board_satisfaction_events: [],
  };
  const supabase = makeFakeSupabase(state, { errorTables: { board_satisfaction_events: "boom" } });
  const summary = await processBoardWeekendFinalization({
    supabase, season, previousRaceDaysCompleted: 8,
    race: { id: "r9", name: "Critérium du Dauphiné" },
    deps: {
      isBoardTestModeActive: async () => false,
      loadGoalContext: async () => ({}),
      computeWeekendUpdate: () => ({
        previousSatisfaction: 50, newSatisfaction: 53, appliedDelta: 3,
        newModifier: 1.0, goalsMet: 2, goalsTotal: 3,
        evaluation: { feedback: { strongest_category: "results" } },
      }),
    },
  });
  // Sikkerheds-egenskaben: en event-skrive-fejl må aldrig vælte eller ændre mekanikken.
  assert.ok(summary.errors >= 1, "event-fejl tælles i summary.errors");
  assert.equal(summary.boards_updated, 1, "satisfaction-opdateringen lykkedes stadig");
  assert.equal(state.board_profiles[0].satisfaction, 53, "satisfaction blev persisteret trods event-fejl");
  assert.equal(state.board_satisfaction_events.length, 0, "intet event-row blev skrevet på fejl");
});

// ─── #2308 · Kontekst-paritet: leagueDivisionId skal med i weekend-stien ──────

test("#2308 · weekend-stien sender leagueDivisionId (pulje-id) videre til loadGoalContext", async () => {
  // Før fixen kaldte weekend-stien loadGoalContextFn UDEN leagueDivisionId, så
  // divisionManagerCount faldt tilbage til tier-bred tælling mens /board/status
  // + season-end er pulje-baseret (#1608) → relative_rank-målet konvergerede
  // mod et target season-end ikke reproducerede.
  const state = makeState();
  state.season_standings[0].league_division_id = 42;
  const supabase = makeFakeSupabase(state);
  const compute = stubComputeUpdate({ newSatisfaction: 45, newModifier: 1.0 });

  const loadGoalContextCalls = [];
  const loadGoalContext = async (args) => {
    loadGoalContextCalls.push(args);
    return { divisionManagerCount: 1 };
  };

  await processBoardWeekendFinalization({
    supabase,
    season: { ...SEASON },
    previousRaceDaysCompleted: 6,
    deps: baseDeps({ computeWeekendUpdate: compute, loadGoalContext }),
  });

  assert.equal(loadGoalContextCalls.length, 1);
  assert.equal(loadGoalContextCalls[0].leagueDivisionId, 42,
    "weekend-stien skal sende standing.league_division_id som leagueDivisionId");
});
