import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRaceResults,
  buildRacePointsLookup,
  buildRaceResultsFromPending,
  rederiveSeasonRacePoints,
  PRIZE_PER_POINT,
} from "./raceResultsEngine.js";

function createSupabaseDouble(initialBalances = {}) {
  const state = {
    balances: { ...initialBalances },
    raceResults: [],
    financeTransactions: [],
  };

  const supabase = {
    from(table) {
      if (table === "race_results") {
        return {
          insert(rows) {
            state.raceResults.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "finance_transactions") {
        return {
          select() {
            return {
              eq(column, value) {
                const filters = [[column, value]];
                return {
                  eq(nextColumn, nextValue) {
                    filters.push([nextColumn, nextValue]);
                    const data = state.financeTransactions
                      .filter(row => filters.every(([key, expected]) => row[key] === expected))
                      .map((row, index) => ({ id: row.id || `finance-${index}`, ...row }));
                    return Promise.resolve({ data, error: null });
                  },
                };
              },
            };
          },
          insert(row) {
            state.financeTransactions.push(row);
            return Promise.resolve({ error: null });
          },
          delete() {
            return {
              eq(column, value) {
                const filters = [[column, value]];
                return {
                  eq(nextColumn, nextValue) {
                    filters.push([nextColumn, nextValue]);
                    state.financeTransactions = state.financeTransactions
                      .filter(row => !filters.every(([key, expected]) => row[key] === expected));
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "teams") {
        return {
          select() {
            return {
              eq(_column, teamId) {
                return {
                  single() {
                    return Promise.resolve({
                      data: { balance: state.balances[teamId] ?? 0 },
                      error: null,
                    });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_column, teamId) {
                state.balances[teamId] = payload.balance;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, state };
}

test("buildRacePointsLookup maps race_points rows to English result_type keys by race_type", () => {
  const racePoints = [
    { result_type: "Klassement", rank: 1, points: 100 },
    { result_type: "Etapeplacering", rank: 1, points: 8 },
    { result_type: "Klassiker", rank: 1, points: 125 },
    { result_type: "EtapelobHold", rank: 1, points: 40 },
    { result_type: "KlassikerHold", rank: 1, points: 50 },
  ];

  const stageLookup = buildRacePointsLookup({ racePoints, raceType: "stage_race" });
  assert.equal(stageLookup["gc__1"], 100);
  assert.equal(stageLookup["stage__1"], 8);
  assert.equal(stageLookup["team__1"], 40);
  assert.equal(stageLookup["gc__1_klassiker"], undefined);

  const singleLookup = buildRacePointsLookup({ racePoints, raceType: "single" });
  assert.equal(singleLookup["gc__1"], 125);
  assert.equal(singleLookup["stage__1"], undefined);
  assert.equal(singleLookup["team__1"], 50);
});

test("buildRacePointsLookup returns empty lookup when no race_class data", () => {
  const lookup = buildRacePointsLookup({ racePoints: [], raceType: "stage_race" });
  assert.equal(lookup["gc__1"], undefined);
});

test("buildRaceResultsFromPending separates points_earned and prize_money", () => {
  const pointsLookup = buildRacePointsLookup({
    racePoints: [{ result_type: "Etapeplacering", rank: 1, points: 50 }],
    raceType: "stage_race",
  });

  const rows = buildRaceResultsFromPending({
    pendingRows: [
      {
        rider_id: "rider-1",
        result_type: "stage",
        rank: 1,
        stage_number: 2,
        rider: {
          team_id: "team-1",
          firstname: "Jonas",
          lastname: "Vingegaard",
        },
      },
    ],
    pointsLookup,
    raceId: "race-1",
  });

  assert.deepEqual(rows, [
    {
      race_id: "race-1",
      rider_id: "rider-1",
      rider_name: "Jonas Vingegaard",
      team_id: "team-1",
      team_name: null,
      result_type: "stage",
      rank: 1,
      stage_number: 2,
      finish_time: null,
      points_earned: 50,
      prize_money: 50 * PRIZE_PER_POINT,
    },
  ]);
});

test("applyRaceResults inserts results and recalculates standings without touching finance", async () => {
  const { supabase, state } = createSupabaseDouble({
    "team-1": 1000,
    "team-2": 500,
  });
  const ensureCalls = [];
  const updateCalls = [];

  const result = await applyRaceResults({
    supabase,
    race: { id: "race-1", season_id: "season-1", name: "Tour de Test" },
    resultRows: [
      {
        rider_id: "rider-1",
        rider_name: "Rider One",
        team_id: "team-1",
        result_type: "stage",
        rank: 1,
        stage_number: 1,
        prize_money: 50,
        points_earned: 8,
      },
      {
        rider_id: "rider-2",
        rider_name: "Rider Two",
        team_id: "team-2",
        result_type: "gc",
        rank: 1,
        stage_number: 1,
        prize_money: 200,
        points_earned: 100,
      },
    ],
    ensureSeasonStandings: async (seasonId) => {
      ensureCalls.push(seasonId);
    },
    updateStandings: async (seasonId, raceId) => {
      updateCalls.push([seasonId, raceId]);
    },
  });

  assert.equal(result.rowsImported, 2);
  assert.equal(state.raceResults.length, 2);
  // Balances and finance are untouched — prize payout is a separate admin action
  assert.equal(state.balances["team-1"], 1000);
  assert.equal(state.balances["team-2"], 500);
  assert.deepEqual(state.financeTransactions, []);
  assert.deepEqual(ensureCalls, ["season-1"]);
  assert.deepEqual(updateCalls, [["season-1", "race-1"]]);
});

test("applyRaceResults re-import does not touch existing prize finance", async () => {
  const existingTx = {
    team_id: "team-1",
    type: "prize",
    amount: 100,
    season_id: "season-1",
    race_id: "race-1",
  };
  const { supabase, state } = createSupabaseDouble({ "team-1": 1100 });
  state.financeTransactions.push(existingTx);

  const result = await applyRaceResults({
    supabase,
    race: { id: "race-1", season_id: "season-1", name: "Tour de Test" },
    resultRows: [
      {
        rider_id: "rider-1",
        rider_name: "Rider One",
        team_id: "team-1",
        result_type: "stage",
        rank: 1,
        prize_money: 40,
        points_earned: 8,
      },
    ],
  });

  assert.equal(result.rowsImported, 1);
  // Balance and finance are unchanged — prizes already paid, payout is admin-controlled
  assert.equal(state.balances["team-1"], 1100);
  assert.deepEqual(state.financeTransactions, [existingTx]);
});

function createRederiveDouble({ races, racePointsByClass, raceResults }) {
  const state = { raceResults: raceResults.map(r => ({ ...r })) };
  const supabase = {
    from(table) {
      if (table === "races") {
        return {
          select() {
            return { eq: (_col, _seasonId) => Promise.resolve({ data: races, error: null }) };
          },
        };
      }
      if (table === "race_points") {
        return {
          select() {
            return {
              eq: (_col, raceClass) =>
                Promise.resolve({ data: racePointsByClass[raceClass] || [], error: null }),
            };
          },
        };
      }
      if (table === "race_results") {
        return {
          select() {
            return {
              eq(_col, raceId) {
                return {
                  order() {
                    return {
                      // fetchAllRows paginates via .range(from,to); single page suffices here.
                      range: (from) => Promise.resolve({
                        data: from === 0 ? state.raceResults.filter(r => r.race_id === raceId) : [],
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_col, id) {
                const row = state.raceResults.find(r => r.id === id);
                if (row) Object.assign(row, payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { supabase, state };
}

test("rederiveSeasonRacePoints re-maps points from current config, skips paid + class-less races", async () => {
  const { supabase, state } = createRederiveDouble({
    races: [
      { id: "race-1", race_class: "uci_wt", race_type: "stage_race", prize_paid_at: null },
      { id: "race-2", race_class: "uci_wt", race_type: "stage_race", prize_paid_at: "2026-06-01T00:00:00Z" },
      { id: "race-3", race_class: null, race_type: "stage_race", prize_paid_at: null },
    ],
    racePointsByClass: {
      uci_wt: [
        { result_type: "Klassement", rank: 1, points: 200 },
        { result_type: "Etapeplacering", rank: 1, points: 10 },
      ],
    },
    raceResults: [
      // race-1: stale values that should be re-derived
      { id: "rr-1", race_id: "race-1", result_type: "gc", rank: 1, points_earned: 100, prize_money: 100 * PRIZE_PER_POINT },
      { id: "rr-2", race_id: "race-1", result_type: "stage", rank: 1, points_earned: 8, prize_money: 8 * PRIZE_PER_POINT },
      // race-1: already-correct (no points in config → 0) → must be skipped, not counted
      { id: "rr-3", race_id: "race-1", result_type: "young", rank: 1, points_earned: 0, prize_money: 0 },
      // race-2 is paid → frozen
      { id: "rr-4", race_id: "race-2", result_type: "gc", rank: 1, points_earned: 100, prize_money: 100 * PRIZE_PER_POINT },
      // race-3 has no class → skipped
      { id: "rr-5", race_id: "race-3", result_type: "stage", rank: 1, points_earned: 5, prize_money: 5 * PRIZE_PER_POINT },
    ],
  });

  const updateCalls = [];
  const result = await rederiveSeasonRacePoints({
    supabase,
    seasonId: "season-1",
    updateStandings: async (seasonId) => { updateCalls.push(seasonId); },
  });

  const byId = Object.fromEntries(state.raceResults.map(r => [r.id, r]));
  // race-1 re-derived from current config
  assert.equal(byId["rr-1"].points_earned, 200);
  assert.equal(byId["rr-1"].prize_money, 200 * PRIZE_PER_POINT);
  assert.equal(byId["rr-2"].points_earned, 10);
  assert.equal(byId["rr-2"].prize_money, 10 * PRIZE_PER_POINT);
  // already-correct row untouched
  assert.equal(byId["rr-3"].points_earned, 0);
  // paid race frozen
  assert.equal(byId["rr-4"].points_earned, 100);
  // class-less race frozen
  assert.equal(byId["rr-5"].points_earned, 5);

  assert.deepEqual(result, {
    racesProcessed: 1,
    racesSkippedPaid: 1,
    racesSkippedNoClass: 1,
    rowsUpdated: 2,
    // No updateRiderValues injected → null (back-compat path)
    ridersUpdated: null,
  });
  assert.deepEqual(updateCalls, ["season-1"]);
});

test("rederiveSeasonRacePoints refreshes rider values after standings when injected", async () => {
  const { supabase } = createRederiveDouble({
    races: [
      { id: "race-1", race_class: "uci_wt", race_type: "stage_race", prize_paid_at: null },
    ],
    racePointsByClass: {
      uci_wt: [{ result_type: "Klassement", rank: 1, points: 200 }],
    },
    raceResults: [
      { id: "rr-1", race_id: "race-1", result_type: "gc", rank: 1, points_earned: 100, prize_money: 100 * PRIZE_PER_POINT },
    ],
  });

  const order = [];
  const result = await rederiveSeasonRacePoints({
    supabase,
    seasonId: "season-1",
    updateStandings: async () => { order.push("standings"); },
    updateRiderValues: async (client) => {
      assert.equal(client, supabase, "updateRiderValues receives the supabase client");
      order.push("rider-values");
      return { ridersUpdated: 42 };
    },
  });

  // Rider values must refresh AFTER standings, and the count is surfaced.
  assert.deepEqual(order, ["standings", "rider-values"]);
  assert.equal(result.ridersUpdated, 42);
});

test("rederiveSeasonRacePoints validates required deps", async () => {
  await assert.rejects(() => rederiveSeasonRacePoints({ supabase: null, seasonId: "s", updateStandings: async () => {} }));
  await assert.rejects(() => rederiveSeasonRacePoints({ supabase: { from() {} }, seasonId: null, updateStandings: async () => {} }));
  await assert.rejects(() => rederiveSeasonRacePoints({ supabase: { from() {} }, seasonId: "s", updateStandings: null }));
});
