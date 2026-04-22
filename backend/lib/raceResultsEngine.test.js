import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRaceResults,
  buildRacePrizeLookup,
  buildRaceResultsFromPending,
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
          insert(row) {
            state.financeTransactions.push(row);
            return Promise.resolve({ error: null });
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

test("buildRaceResultsFromPending maps pending rows onto canonical race_results fields", () => {
  const prizeLookup = buildRacePrizeLookup({
    prizes: [
      { result_type: "stage", rank: 1, prize_amount: 50 },
    ],
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
    prizeLookup,
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
      prize_money: 50,
      points_earned: 50,
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
    race: { id: "race-1", season_id: "season-1" },
    resultRows: [
      {
        rider_id: "rider-1",
        rider_name: "Rider One",
        team_id: "team-1",
        result_type: "stage",
        rank: 1,
        stage_number: 1,
        prize_money: 50,
        points_earned: 50,
      },
      {
        rider_id: "rider-2",
        rider_name: "Rider Two",
        team_id: "team-2",
        result_type: "gc",
        rank: 1,
        stage_number: 1,
        prize_money: 200,
        points_earned: 200,
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
