import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRaceResults,
  buildRacePointsLookup,
  buildRaceResultsFromPending,
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

test("applyRaceResults uses canonical prize finance writes and recalculates standings", async () => {
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
  assert.equal(result.teamsPaid, 2);
  assert.equal(state.raceResults.length, 2);
  assert.equal(state.balances["team-1"], 1050);
  assert.equal(state.balances["team-2"], 700);
  assert.deepEqual(
    state.financeTransactions.map((row) => ({
      team_id: row.team_id,
      type: row.type,
      amount: row.amount,
      season_id: row.season_id,
      race_id: row.race_id,
    })),
    [
      {
        team_id: "team-1",
        type: "prize",
        amount: 50,
        season_id: "season-1",
        race_id: "race-1",
      },
      {
        team_id: "team-2",
        type: "prize",
        amount: 200,
        season_id: "season-1",
        race_id: "race-1",
      },
    ],
  );
  assert.deepEqual(ensureCalls, ["season-1"]);
  assert.deepEqual(updateCalls, [["season-1", "race-1"]]);
});

test("applyRaceResults reverses existing prize finance before re-importing a race", async () => {
  const { supabase, state } = createSupabaseDouble({
    "team-1": 1100,
  });
  state.financeTransactions.push({
    team_id: "team-1",
    type: "prize",
    amount: 100,
    season_id: "season-1",
    race_id: "race-1",
  });

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
  assert.equal(state.balances["team-1"], 1040);
  assert.deepEqual(state.financeTransactions, [
    {
      team_id: "team-1",
      type: "prize",
      amount: 40,
      description: "Præmiepenge — Tour de Test",
      season_id: "season-1",
      race_id: "race-1",
    },
  ]);
});
