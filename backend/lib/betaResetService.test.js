import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelBetaMarket,
  resetBetaBalances,
  resetBetaBoardProfiles,
  resetBetaRosters,
  runFullBetaReset,
} from "./betaResetService.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBetaResetSupabase(initialState) {
  const state = Object.fromEntries(
    Object.entries(initialState).map(([table, rows]) => [table, clone(rows)])
  );

  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function createQuery(table, action, payload = null) {
    const filters = [];

    function matches(row) {
      return filters.every((filter) => {
        if (filter.type === "eq") return row[filter.column] === filter.value;
        if (filter.type === "in") return filter.values.includes(row[filter.column]);
        if (filter.type === "not-is-null") return row[filter.column] !== null && row[filter.column] !== undefined;
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);

      if (action === "select") {
        return Promise.resolve({ data: clone(rows.filter(matches)), error: null });
      }

      if (action === "update") {
        const updated = [];
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, clone(payload));
            updated.push(row);
          }
        }
        return Promise.resolve({ data: clone(updated), error: null });
      }

      if (action === "delete") {
        const deleted = rows.filter(matches);
        state[table] = rows.filter((row) => !matches(row));
        return Promise.resolve({ data: clone(deleted), error: null });
      }

      if (action === "insert") {
        const inserted = Array.isArray(payload) ? clone(payload) : [clone(payload)];
        state[table].push(...inserted);
        return Promise.resolve({ data: clone(inserted), error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) {
        filters.push({ type: "eq", column, value });
        return query;
      },
      in(column, values) {
        filters.push({ type: "in", column, values });
        return query;
      },
      not(column, operator, value) {
        if (operator === "is" && value === null) {
          filters.push({ type: "not-is-null", column });
        }
        return query;
      },
      select() {
        return query;
      },
      maybeSingle() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      single() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };

    return query;
  }

  return {
    state,
    from(table) {
      ensureTable(table);
      return {
        select() {
          return createQuery(table, "select");
        },
        update(payload) {
          return createQuery(table, "update", payload);
        },
        delete() {
          return createQuery(table, "delete");
        },
        insert(payload) {
          return createQuery(table, "insert", payload);
        },
      };
    },
  };
}

function createInitialState() {
  return {
    teams: [
      { id: "team-1", user_id: "user-1", is_ai: false, is_bank: false, is_frozen: false, division: 1, balance: 12, sponsor_income: 240000 },
      { id: "team-ai", user_id: null, is_ai: true, is_bank: false, is_frozen: false, division: 1, balance: 999, sponsor_income: 0 },
      { id: "team-bank", user_id: null, is_ai: false, is_bank: true, is_frozen: false, division: 1, balance: 999, sponsor_income: 0 },
      { id: "team-frozen", user_id: "user-frozen", is_ai: false, is_bank: false, is_frozen: true, division: 1, balance: 999, sponsor_income: 0 },
    ],
    riders: [
      { id: "rider-ai", team_id: "team-1", ai_team_id: "team-ai", pending_team_id: "team-2" },
      { id: "rider-free", team_id: "team-1", ai_team_id: null, pending_team_id: "team-2" },
      { id: "rider-ai-owned", team_id: "team-ai", ai_team_id: "team-ai", pending_team_id: null },
    ],
    auctions: [{ id: "auction-1", status: "active" }],
    transfer_listings: [{ id: "listing-1", status: "open" }],
    transfer_offers: [{ id: "transfer-1", status: "window_pending" }],
    swap_offers: [{ id: "swap-1", status: "accepted" }],
    loan_agreements: [{ id: "loan-1", status: "active" }],
    finance_transactions: [{ id: "tx-1", team_id: "team-1" }, { id: "tx-ai", team_id: "team-ai" }],
    seasons: [{ id: "season-1", status: "active", number: 1 }],
    races: [{ id: "race-1" }],
    pending_race_results: [{ id: "pending-1" }],
    race_results: [{ id: "result-1" }],
    season_standings: [{ id: "standing-1" }],
    users: [{ id: "user-1", xp: 200, level: 3 }, { id: "user-frozen", xp: 200, level: 3 }],
    xp_log: [{ id: "xp-1", user_id: "user-1" }, { id: "xp-frozen", user_id: "user-frozen" }],
    achievements: [{ id: "achievement-1" }],
    manager_achievements: [{ id: "ma-1", user_id: "user-1" }, { id: "ma-frozen", user_id: "user-frozen" }],
    board_profiles: [
      {
        id: "board-1",
        team_id: "team-1",
        plan_type: "1yr",
        satisfaction: 12,
        budget_modifier: 0.8,
        seasons_completed: 2,
        cumulative_stage_wins: 4,
        cumulative_gc_wins: 1,
      },
    ],
    board_plan_snapshots: [{ id: "snap-1", team_id: "team-1" }, { id: "snap-ai", team_id: "team-ai" }],
    board_request_log: [{ id: "request-1", team_id: "team-1" }, { id: "request-ai", team_id: "team-ai" }],
  };
}

test("cancelBetaMarket cancels every non-terminal market artifact, including accepted swaps", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await cancelBetaMarket(supabase);

  assert.deepEqual(result, {
    auctions: 1,
    transfer_listings: 1,
    transfer_offers: 1,
    swap_offers: 1,
    loan_agreements: 1,
  });
  assert.equal(supabase.state.swap_offers[0].status, "rejected");
});

test("resetBetaRosters returns manager riders to ai_team_id or free agency and clears pending_team_id", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaRosters(supabase);

  assert.deepEqual(result, { moved: 2, to_ai: 1, to_null: 1 });
  assert.equal(supabase.state.riders.find((rider) => rider.id === "rider-ai").team_id, "team-ai");
  assert.equal(supabase.state.riders.find((rider) => rider.id === "rider-ai").pending_team_id, null);
  assert.equal(supabase.state.riders.find((rider) => rider.id === "rider-free").team_id, null);
});

test("resetBetaBalances touches only active manager teams and can clear only their finance rows", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaBalances(supabase, { clearTransactions: true });

  assert.equal(result.reset, 1);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-1").balance, 800000);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-ai").balance, 999);
  assert.deepEqual(supabase.state.finance_transactions.map((row) => row.id), ["tx-ai"]);
});

test("resetBetaBoardProfiles restores baseline board state and creates missing plan profiles", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await resetBetaBoardProfiles(supabase);

  assert.equal(result.reset, 1);
  assert.equal(result.created, 2);
  assert.equal(result.snapshots_deleted, 1);
  assert.equal(result.requests_deleted, 1);
  assert.equal(supabase.state.board_profiles.length, 3);
  const resetBoard = supabase.state.board_profiles.find((board) => board.id === "board-1");
  assert.equal(resetBoard.satisfaction, 50);
  assert.equal(resetBoard.budget_modifier, 1);
  assert.equal(resetBoard.seasons_completed, 0);
  assert.deepEqual(supabase.state.board_plan_snapshots.map((row) => row.id), ["snap-ai"]);
});

test("runFullBetaReset completes the full test reset suite without touching AI or frozen manager data", async () => {
  const supabase = createBetaResetSupabase(createInitialState());

  const result = await runFullBetaReset(supabase, { clearTransactions: true, resetMode: "test" });

  assert.equal(result.reset_mode, "test");
  assert.equal(result.divisions.reset, 1);
  assert.equal(result.race_calendar.races, 1);
  assert.equal(result.seasons.seasons, 1);
  assert.equal(result.manager_progress.users, 1);
  assert.equal(result.achievements.manager_achievements, 1);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-1").division, 3);
  assert.equal(supabase.state.teams.find((team) => team.id === "team-frozen").division, 1);
  assert.equal(supabase.state.users.find((user) => user.id === "user-1").level, 1);
  assert.equal(supabase.state.users.find((user) => user.id === "user-frozen").level, 3);
  assert.deepEqual(supabase.state.races, []);
  assert.deepEqual(supabase.state.seasons, []);
  assert.deepEqual(supabase.state.manager_achievements.map((row) => row.id), ["ma-frozen"]);
});
