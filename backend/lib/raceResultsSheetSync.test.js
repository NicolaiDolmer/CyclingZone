import test from "node:test";
import assert from "node:assert/strict";

import { syncRaceResultsFromSheets } from "./raceResultsSheetSync.js";

function createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs, pointRows = null }) {
  return {
    from(table) {
      if (table === "seasons") {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: "season-1", number: 1 }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "races") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ id: "race-1", name: "Test Race", race_class: "WT", race_type: "stage_race" }],
                  error: null,
                });
              },
            };
          },
          update(payload) {
            return {
              eq(_column, raceId) {
                raceUpdates.push({ raceId, payload });
                return Promise.resolve({ error: null });
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
                  limit() {
                    return Promise.resolve({
                      data: [{ id: "rider-1", firstname: "Test", lastname: "Rider" }],
                      error: null,
                    });
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
            return Promise.resolve({ data: [{ id: "team-1", name: "Test Team" }], error: null });
          },
        };
      }

      if (table === "race_points") {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({
                  data: pointRows || [{ race_class: "WT", result_type: "Etapeplacering", rank: 1, points: 200000 }],
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "race_results") {
        return {
          delete() {
            return {
              eq(_column, raceId) {
                raceResultDeletes.push(raceId);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "import_log") {
        return {
          insert(payload) {
            importLogs.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("syncRaceResultsFromSheets delegates writes through applyRaceResults", async () => {
  const applyCalls = [];
  const ensureCalls = [];
  const updateCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Rider,Test Team,Etapeplacering,Test Race,1",
  ].join("\n");

  const result = await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase,
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      await payload.ensureSeasonStandings(payload.race.season_id);
      await payload.updateStandings(payload.race.season_id, payload.race.id);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    ensureSeasonStandings: async (seasonId) => ensureCalls.push(seasonId),
    updateStandings: async (seasonId, raceId) => updateCalls.push([seasonId, raceId]),
    adminUserId: "admin-1",
  });

  assert.equal(result.rows_imported, 1);
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].race.id, "race-1");
  assert.equal(applyCalls[0].race.season_id, "season-1");
  assert.equal(applyCalls[0].resultRows[0].prize_money, 200000);
  assert.deepEqual(raceResultDeletes, ["race-1"]);
  assert.deepEqual(raceUpdates, [{ raceId: "race-1", payload: { status: "completed" } }]);
  assert.deepEqual(ensureCalls, ["season-1"]);
  assert.deepEqual(updateCalls, [["season-1", "race-1"]]);
  assert.equal(importLogs[0].rows_inserted, 1);
});

test("syncRaceResultsFromSheets uses known team name from Name column for team results", async () => {
  const applyCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Team,9h45'50,Etapeløb Hold,Test Race,1",
  ].join("\n");

  await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase,
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    adminUserId: "admin-1",
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].resultRows[0].team_id, "team-1");
  assert.equal(applyCalls[0].resultRows[0].team_name, "Test Team");
});

test("syncRaceResultsFromSheets uses known team name from Team column for team results", async () => {
  const applyCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,,Test Team,Etapeløb Hold,Test Race,1",
  ].join("\n");

  await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase,
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    adminUserId: "admin-1",
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].resultRows[0].team_id, "team-1");
  assert.equal(applyCalls[0].resultRows[0].team_name, "Test Team");
});

test("syncRaceResultsFromSheets supports UCI leader jersey points", async () => {
  const applyCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({
    raceResultDeletes,
    raceUpdates,
    importLogs,
    pointRows: [{ race_class: "WT", result_type: "Forertroje", rank: 1, points: 25 }],
  });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Rider,Test Team,Førertrøje,Test Race,1",
  ].join("\n");

  await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase,
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    adminUserId: "admin-1",
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].resultRows[0].result_type, "leader");
  assert.equal(applyCalls[0].resultRows[0].points_earned, 25);
});

test("syncRaceResultsFromSheets matches race names across accents and punctuation", async () => {
  const applyCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Rider,Test Team,Klassiker,La Fleche Wallonne,1",
  ].join("\n");

  await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase: {
      from(table) {
        const tableClient = supabase.from(table);
        if (table !== "races") return tableClient;

        return {
          ...tableClient,
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ id: "race-1", name: "La Flèche Wallonne", race_class: "WT", race_type: "single" }],
                  error: null,
                });
              },
            };
          },
        };
      },
    },
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    adminUserId: "admin-1",
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].race.name, "La Flèche Wallonne");
  assert.deepEqual(importLogs[0].errors, []);
});

test("syncRaceResultsFromSheets matches known calendar aliases", async () => {
  const applyCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Rider,Test Team,Etapeplacering,Volta a la Communitat Valenciana,1",
  ].join("\n");

  await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase: {
      from(table) {
        const tableClient = supabase.from(table);
        if (table !== "races") return tableClient;

        return {
          ...tableClient,
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ id: "race-1", name: "Volta Comunitat Valenciana", race_class: "WT", race_type: "stage_race" }],
                  error: null,
                });
              },
            };
          },
        };
      },
    },
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    adminUserId: "admin-1",
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].race.name, "Volta Comunitat Valenciana");
  assert.deepEqual(importLogs[0].errors, []);
});
