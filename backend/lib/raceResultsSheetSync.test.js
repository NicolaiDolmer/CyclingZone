import test from "node:test";
import assert from "node:assert/strict";

import { syncRaceResultsFromSheets } from "./raceResultsSheetSync.js";

function createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs, pointRows = null, season = null }) {
  return {
    from(table) {
      if (table === "seasons") {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    return Promise.resolve({ data: season ?? { id: "season-1", number: 1 }, error: null });
                  },
                };
              },
            };
          },
          // #804 — recomputeSeasonRaceDays opdaterer race_days_completed efter import.
          update() {
            return { eq() { return Promise.resolve({ error: null }); } };
          },
        };
      }

      if (table === "races") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ id: "race-1", name: "Test Race", race_class: "WT", race_type: "stage_race", stages: 1, status: "completed" }],
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
                  data: pointRows || [{ race_class: "WT", result_type: "Etapeplacering", rank: 1, points: 210 }],
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
  assert.equal(applyCalls[0].resultRows[0].points_earned, 210);
  assert.equal(applyCalls[0].resultRows[0].prize_money, 315000);
  assert.deepEqual(raceResultDeletes, ["race-1"]);
  assert.deepEqual(raceUpdates, [{ raceId: "race-1", payload: { status: "completed" } }]);
  assert.deepEqual(ensureCalls, ["season-1"]);
  assert.deepEqual(updateCalls, [["season-1", "race-1"]]);
  assert.equal(importLogs[0].rows_inserted, 1);
});

// #1187 · Board-weekend-wiring: efter skarp sync kaldes processBoardWeekend med
// race-days FØR syncen + den nye recompute-værdi.
test("syncRaceResultsFromSheets kalder processBoardWeekend efter skarp import (#1187)", async () => {
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const supabase = createSheetSyncSupabase({
    raceResultDeletes,
    raceUpdates,
    importLogs,
    season: { id: "season-1", number: 1, status: "active", race_days_completed: 0, race_days_total: 60 },
  });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Rider,Test Team,Etapeplacering,Test Race,1",
  ].join("\n");

  const boardCalls = [];
  await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase,
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => ({ rowsImported: payload.resultRows.length }),
    ensureSeasonStandings: async () => {},
    updateStandings: async () => {},
    adminUserId: "admin-1",
    processBoardWeekend: async (args) => { boardCalls.push(args); return { boards_updated: 1 }; },
  });

  assert.equal(boardCalls.length, 1);
  assert.equal(boardCalls[0].previousRaceDaysCompleted, 0, "udgangspunkt = race_days FØR syncen");
  assert.equal(boardCalls[0].season.id, "season-1");
  assert.equal(boardCalls[0].season.status, "active");
  assert.equal(boardCalls[0].season.race_days_completed, 1, "ny værdi fra recompute (1 completed etape)");
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

test("syncRaceResultsFromSheets dryRun returns preview without DB writes", async () => {
  const applyCalls = [];
  const raceResultDeletes = [];
  const raceUpdates = [];
  const importLogs = [];
  const ensureCalls = [];
  const updateCalls = [];
  const supabase = createSheetSyncSupabase({ raceResultDeletes, raceUpdates, importLogs });
  const csv = [
    "Rank,Name,Team,Benævnelse,Løb,Sæson",
    "1,Test Rider,Test Team,Etapeplacering,Test Race,1",
    "2,Mystery Ghost,Unknown Team,Etapeplacering,Test Race,1",
  ].join("\n");

  const result = await syncRaceResultsFromSheets({
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0",
    supabase: {
      from(table) {
        if (table === "riders") {
          return {
            select() {
              return {
                ilike(_col, pattern) {
                  return {
                    limit() {
                      if (pattern.toLowerCase().includes("rider")) {
                        return Promise.resolve({
                          data: [{ id: "rider-1", firstname: "Test", lastname: "Rider" }],
                          error: null,
                        });
                      }
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
              };
            },
          };
        }
        return supabase.from(table);
      },
    },
    fetchCsvFn: async () => csv,
    applyRaceResults: async (payload) => {
      applyCalls.push(payload);
      return { rowsImported: payload.resultRows.length, teamsPaid: 1 };
    },
    ensureSeasonStandings: async (seasonId) => ensureCalls.push(seasonId),
    updateStandings: async (seasonId, raceId) => updateCalls.push([seasonId, raceId]),
    adminUserId: "admin-1",
    dryRun: true,
  });

  // Zero DB writes
  assert.equal(applyCalls.length, 0, "applyRaceResults must not be called in dryRun");
  assert.deepEqual(raceResultDeletes, [], "race_results.delete must not be called in dryRun");
  assert.deepEqual(raceUpdates, [], "races.update must not be called in dryRun");
  assert.deepEqual(importLogs, [], "import_log.insert must not be called in dryRun");
  assert.deepEqual(ensureCalls, [], "ensureSeasonStandings must not be called in dryRun");
  assert.deepEqual(updateCalls, [], "updateStandings must not be called in dryRun");

  // Preview shape
  assert.equal(result.dry_run, true);
  assert.equal(result.preview.length, 1);
  const p = result.preview[0];
  assert.equal(p.sheet_race_name, "Test Race");
  assert.equal(p.db_race_name, "Test Race");
  assert.equal(p.season, 1);
  assert.equal(p.total_rows, 2);
  assert.equal(p.matched_riders, 1);
  assert.deepEqual(p.unmatched_riders, ["Mystery Ghost"]);
  assert.equal(p.matched_teams, 1);
  assert.deepEqual(p.unmatched_teams, ["Unknown Team"]);
  assert.equal(p.total_points, 210); // rank 1 only — rank 2 has no point row in lookup
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
