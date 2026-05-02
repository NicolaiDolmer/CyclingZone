import assert from "node:assert/strict";
import test from "node:test";

import { createAdminImportResultsHandler } from "./adminImportResultsHandler.js";
import { PRIZE_PER_POINT } from "./raceResultsEngine.js";

function createResponseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createSupabaseDouble({ race, racePoints, riderId, teamId }) {
  return {
    from(table) {
      if (table === "races") {
        return {
          select() {
            return {
              eq(_column, value) {
                return {
                  async single() {
                    return {
                      data: value === race.id ? race : null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "race_points") {
        return {
          select() {
            return {
              async eq() {
                return {
                  data: racePoints,
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select() {
            return {
              ilike() {
                return {
                  async limit() {
                    return {
                      data: riderId ? [{ id: riderId }] : [],
                    };
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
              ilike() {
                return {
                  async limit() {
                    return {
                      data: teamId ? [{ id: teamId }] : [],
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("admin import-results uses race_points for points_earned and prize_money = points × PRIZE_PER_POINT", async () => {
  const race = {
    id: "race-1",
    name: "Liege-Bastogne-Liege",
    season_id: "season-1",
    race_type: "stage_race",
    race_class: "Monuments",
  };
  const racePoints = [
    { result_type: "Etapeplacering", rank: 1, points: 50 },
  ];
  const supabase = createSupabaseDouble({
    race,
    racePoints,
    riderId: "rider-1",
    teamId: "team-1",
  });
  const ensureSeasonStandings = async () => {};
  const updateStandings = async () => {};
  const applyCalls = [];
  const activityCalls = [];

  const handler = createAdminImportResultsHandler({
    supabase,
    buildRacePointsLookup: ({ racePoints: rows, raceType }) => {
      if (raceType === "stage_race") {
        return { "stage__1": rows[0].points };
      }
      return {};
    },
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return {
        rowsImported: payload.resultRows.length,
        teamsPaid: 1,
      };
    },
    ensureSeasonStandings,
    updateStandings,
    logActivity: async (type, payload) => {
      activityCalls.push({ type, payload });
    },
    parseWorkbook: async () => [
      {
        name: "Stage Results",
        rows: [
          [],
          ["Rank", "Name", "Team", "Time"],
          [1, "Jonas Vingegaard", "Visma", "04:00:00"],
        ],
      },
    ],
  });

  const req = {
    body: {
      race_id: "race-1",
      stage_number: "2",
    },
    file: {
      buffer: Buffer.from("xlsx"),
    },
  };
  const res = createResponseDouble();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    records_imported: 1,
  });
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].race, race);
  assert.equal(applyCalls[0].ensureSeasonStandings, ensureSeasonStandings);
  assert.equal(applyCalls[0].updateStandings, updateStandings);
  assert.deepEqual(applyCalls[0].resultRows, [
    {
      race_id: "race-1",
      stage_number: 2,
      result_type: "stage",
      rank: 1,
      rider_id: "rider-1",
      rider_name: "Jonas Vingegaard",
      team_id: "team-1",
      team_name: "Visma",
      finish_time: "04:00:00",
      points_earned: 50,
      prize_money: 50 * PRIZE_PER_POINT,
    },
  ]);
  assert.deepEqual(activityCalls, [
    {
      type: "race_results_approved",
      payload: {
        meta: {
          race_id: "race-1",
          race_name: "Liege-Bastogne-Liege",
          season_id: "season-1",
          rows_imported: 1,
        },
      },
    },
  ]);
});

test("admin import-results sets prize_money to 0 when race has no race_class", async () => {
  const race = {
    id: "race-2",
    name: "Unknown Race",
    season_id: "season-1",
    race_type: "single",
    race_class: null,
  };
  const supabase = createSupabaseDouble({
    race,
    racePoints: [],
    riderId: "rider-1",
    teamId: "team-1",
  });
  const applyCalls = [];

  const handler = createAdminImportResultsHandler({
    supabase,
    buildRacePointsLookup: () => ({}),
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 0 };
    },
    ensureSeasonStandings: async () => {},
    updateStandings: async () => {},
    logActivity: async () => {},
    parseWorkbook: async () => [
      {
        name: "General Results",
        rows: [
          [],
          ["Rank", "Name", "Team", "Time"],
          [1, "Tadej Pogacar", "UAE", "05:00:00"],
        ],
      },
    ],
  });

  const req = { body: { race_id: "race-2" }, file: { buffer: Buffer.from("xlsx") } };
  const res = createResponseDouble();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(applyCalls[0].resultRows[0].points_earned, 0);
  assert.equal(applyCalls[0].resultRows[0].prize_money, 0);
});
