import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRaceResults,
  buildRacePointsLookup,
  buildRaceResultsFromPending,
  rederiveSeasonRacePoints,
  PRIZE_PER_POINT,
  isPrizeMoneyRace,
  prizeMoneyForPoints,
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

// #3718 forward-guard: et endagsløb må ikke kunne udbetale trøje-klassementer, heller ikke hvis
// simulatoren en dag begynder at emitte `points`/`mountain`/`young` for et `single`-løb.
// Etapeløb SKAL stadig kunne — de samme race_points-rækker deles af begge stier.
test("#3718 buildRacePointsLookup — trøje-klassementer findes kun for etapeløb", () => {
  const racePoints = [
    { result_type: "Klassement", rank: 1, points: 100 },
    { result_type: "Klassiker", rank: 1, points: 125 },
    { result_type: "Pointtroje", rank: 1, points: 32 },
    { result_type: "Bjergtroje", rank: 1, points: 32 },
    { result_type: "Ungdomstroje", rank: 1, points: 16 },
  ];

  const singleLookup = buildRacePointsLookup({ racePoints, raceType: "single" });
  assert.equal(singleLookup["points__1"], undefined);
  assert.equal(singleLookup["mountain__1"], undefined);
  assert.equal(singleLookup["young__1"], undefined);

  const stageLookup = buildRacePointsLookup({ racePoints, raceType: "stage_race" });
  assert.equal(stageLookup["points__1"], 32);
  assert.equal(stageLookup["mountain__1"], 32);
  assert.equal(stageLookup["young__1"], 16);
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
          team: { name: "Team Visma" },
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
      team_name: "Team Visma",
      result_type: "stage",
      rank: 1,
      stage_number: 2,
      finish_time: null,
      points_earned: 50,
      prize_money: 50 * PRIZE_PER_POINT,
    },
  ]);
});

test("buildRaceResultsFromPending snapshots team_name from the joined rider's team", () => {
  const rows = buildRaceResultsFromPending({
    pendingRows: [
      {
        rider_id: "rider-1",
        result_type: "gc",
        rank: 1,
        rider: {
          team_id: "team-7",
          firstname: "Tadej",
          lastname: "Pogacar",
          team: { name: "UAE Emirates" },
        },
      },
    ],
    pointsLookup: {},
    raceId: "race-2",
  });

  assert.equal(rows[0].team_name, "UAE Emirates");
  assert.equal(rows[0].team_id, "team-7");
});

test("buildRaceResultsFromPending sets team_name null when rider has no team join", () => {
  const rows = buildRaceResultsFromPending({
    pendingRows: [
      // rider with team_id but no nested team object (join missing/absent)
      {
        rider_id: "rider-1",
        result_type: "stage",
        rank: 2,
        rider: { team_id: "team-1", firstname: "A", lastname: "B" },
      },
      // rider entirely without a team
      {
        rider_id: "rider-2",
        result_type: "stage",
        rank: 3,
        rider: { firstname: "C", lastname: "D", team: null },
      },
      // no rider join at all
      {
        rider_id: "rider-3",
        result_type: "stage",
        rank: 4,
      },
    ],
    pointsLookup: {},
    raceId: "race-3",
  });

  assert.equal(rows[0].team_name, null);
  assert.equal(rows[1].team_name, null);
  assert.equal(rows[2].team_name, null);
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

// #3022: stageNumbers sat → atomisk delete+insert via apply_race_results_batch-RPC'en
// (raceRunner.js/pcmResultsImport.js's nye kaldeform), IKKE en separat .insert().
test("applyRaceResults: stageNumbers sat → kalder applyRaceResultsBatch (atomisk), ikke .insert()", async () => {
  let insertCalled = false;
  const supabase = {
    from(table) {
      if (table === "race_results") {
        return { insert() { insertCalled = true; return Promise.resolve({ error: null }); } };
      }
      throw new Error(`uventet tabel i test-double: ${table}`);
    },
  };
  let batchArgs = null;
  const result = await applyRaceResults({
    supabase,
    race: { id: "race-1", season_id: "season-1" },
    resultRows: [
      { rider_id: "rider-1", rider_name: "Rider One", result_type: "stage", rank: 1, stage_number: 2 },
    ],
    stageNumbers: [2],
    applyRaceResultsBatch: async (client, args) => {
      batchArgs = args;
      return { rowsDeleted: 3, rowsInserted: 1 };
    },
    ensureSeasonStandings: async () => {},
    updateStandings: async () => {},
  });

  assert.equal(insertCalled, false, "en atomisk (stageNumbers-sat) skrivning må IKKE også kalde .insert() direkte");
  assert.equal(result.rowsImported, 1, "rowsImported skal komme fra RPC'ens rows_inserted");
  assert.equal(batchArgs.raceId, "race-1");
  assert.deepEqual(batchArgs.stageNumbers, [2]);
  assert.equal(batchArgs.resultRows.length, 1);
});

test("applyRaceResults: stageNumbers UDELADT → ren .insert() (approve-results-formen, uændret)", async () => {
  const { supabase, state } = createSupabaseDouble();
  let batchCalled = false;
  const result = await applyRaceResults({
    supabase,
    race: { id: "race-1", season_id: "season-1" },
    resultRows: [{ rider_id: "rider-1", rider_name: "Rider One", result_type: "gc", rank: 1, stage_number: 1 }],
    applyRaceResultsBatch: async () => { batchCalled = true; return { rowsInserted: 999 }; },
    ensureSeasonStandings: async () => {},
    updateStandings: async () => {},
  });
  assert.equal(batchCalled, false, "uden stageNumbers må RPC-branchen ikke røres");
  assert.equal(result.rowsImported, 1);
  assert.equal(state.raceResults.length, 1);
});

test("applyRaceResults: RPC-fejl (stageNumbers sat) kastes synligt, standings genberegnes ALDRIG", async () => {
  const standingsCalls = [];
  const supabase = { from() { throw new Error("må ikke røres — batch-branchen bruger RPC, ikke .from()"); } };
  await assert.rejects(
    () => applyRaceResults({
      supabase,
      race: { id: "race-1", season_id: "season-1" },
      resultRows: [{ rider_id: "rider-1", result_type: "stage", rank: 1, stage_number: 1 }],
      stageNumbers: [1],
      applyRaceResultsBatch: async () => { throw new Error("apply_race_results_batch: unique_violation"); },
      ensureSeasonStandings: async (seasonId) => { standingsCalls.push(["ensure", seasonId]); },
      updateStandings: async (seasonId, raceId) => { standingsCalls.push(["update", seasonId, raceId]); },
    }),
    /unique_violation/,
  );
  assert.deepEqual(standingsCalls, [], "standings må IKKE genberegnes når resultat-skrivningen fejlede");
});

// #3022 forward-guard: en række uden gyldig deltager-identitet afvises FØR databasen
// rammes, uanset hvilken branch (ren insert eller atomisk RPC).
test("applyRaceResults: afviser en række uden gyldig deltager-identitet (#3022 forward-guard)", async () => {
  const standingsCalls = [];
  const supabase = { from() { throw new Error("må ikke røres — valideringen skal fejle FØR noget DB-kald"); } };
  await assert.rejects(
    () => applyRaceResults({
      supabase,
      race: { id: "race-1", season_id: "season-1" },
      resultRows: [{ rider_id: null, rider_name: null, team_name: null, result_type: "gc", rank: 1, stage_number: 1 }],
      ensureSeasonStandings: async (seasonId) => { standingsCalls.push(seasonId); },
      updateStandings: async () => { standingsCalls.push("update"); },
    }),
    /uden gyldig deltager-identitet/,
  );
  assert.deepEqual(standingsCalls, []);
});

// #2877: standings-recompute-fejl (fx statement timeout under samtidige
// afviklinger) skal IKKE vælte applyRaceResults — resultaterne er allerede
// skrevet på dette tidspunkt, og simulateRace's berigelses-skrivning (runs/
// incidents/moments) kører FØRST efter denne funktion returnerer. Kastede
// updateStandings uhåndteret her, blev berigelsen tabt permanent selvom
// resultaterne stod korrekt (19 etaper i 14 løb, samme rodårsag som
// simulateStageByIndex — se raceRunner.js).
test("#2877: applyRaceResults returnerer normalt selvom updateStandings fejler (standings self-healer, berigelse må ikke tabes)", async () => {
  const { supabase, state } = createSupabaseDouble({ "team-1": 1000, "team-2": 500 });
  const ensureCalls = [];

  const result = await applyRaceResults({
    supabase,
    race: { id: "race-1", season_id: "season-1", name: "Tour de Test" },
    resultRows: [
      { rider_id: "rider-1", rider_name: "Rider One", team_id: "team-1", result_type: "stage", rank: 1, stage_number: 1, prize_money: 50, points_earned: 8 },
    ],
    ensureSeasonStandings: async (seasonId) => { ensureCalls.push(seasonId); },
    updateStandings: async () => {
      const err = new Error("canceling statement due to statement timeout");
      err.code = "57014";
      throw err;
    },
  });

  // Resultaterne ER skrevet, og funktionen kaster IKKE videre — kalderen
  // (simulateRace) skal kunne fortsætte til berigelses-skrivningen.
  assert.equal(result.rowsImported, 1);
  assert.equal(state.raceResults.length, 1);
  assert.deepEqual(ensureCalls, ["season-1"], "ensureSeasonStandings skal stadig forsøges");
});

// #2898: fuld-sim sletter race_results FØR applyRaceResults kaldes (raceRunner.js).
// Fejler selve insertet (fx statement timeout), skal det være en synlig fejl —
// IKKE en tavs succes der lader standings genberegne på et ufuldstændigt
// resultatsæt eller lader kalderen tro afviklingen lykkedes.
test("applyRaceResults: insert-fejl kastes synligt, standings genberegnes ALDRIG på delvis skrivning", async () => {
  const standingsCalls = [];
  const supabase = {
    from(table) {
      if (table === "race_results") {
        return {
          insert() {
            return Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } });
          },
        };
      }
      throw new Error(`uventet tabel i test-double: ${table}`);
    },
  };

  await assert.rejects(
    () => applyRaceResults({
      supabase,
      race: { id: "race-1", season_id: "season-1" },
      resultRows: [
        { rider_id: "rider-1", result_type: "stage", rank: 1, stage_number: 1, prize_money: 50, points_earned: 8 },
      ],
      ensureSeasonStandings: async (seasonId) => { standingsCalls.push(["ensure", seasonId]); },
      updateStandings: async (seasonId, raceId) => { standingsCalls.push(["update", seasonId, raceId]); },
    }),
    /duplicate key value violates unique constraint/,
  );
  assert.deepEqual(standingsCalls, [], "standings må IKKE genberegnes når race_results-insert fejlede — ville låse forkerte tal fast");
});

// Sub-2 (#2770): applyRaceResults' normalizedRows enumererer race_results-
// kolonnerne eksplicit — passage-lagets aggregater (sprint_points/kom_points/
// bonus_seconds) SKAL med her, ellers dropper whole-race-stien (simulateRace)
// dem stille ved persistering (den atomære apply_stage_result-RPC-sti er
// upåvirket, den serialiserer resultRows 1:1 via jsonb). NULL-passthrough for
// legacy-rækker (ingen passage-data) er lige så vigtig som selve gennemløbet.
test("applyRaceResults gennemløber passage-aggregaterne (sprint_points/kom_points/bonus_seconds), NULL for legacy-rækker", async () => {
  const { supabase, state } = createSupabaseDouble({ "team-1": 1000 });
  await applyRaceResults({
    supabase,
    race: { id: "race-1", season_id: "season-1" },
    resultRows: [
      {
        rider_id: "rider-1", team_id: "team-1", result_type: "stage", rank: 1, stage_number: 1,
        prize_money: 50, points_earned: 8,
        sprint_points: 6, kom_points: 0, bonus_seconds: 10,
      },
      {
        rider_id: "rider-2", team_id: "team-1", result_type: "stage", rank: 2, stage_number: 1,
        prize_money: 0, points_earned: 0,
        // ingen passage-felter (legacy/PCM-mønster) → skal blive NULL, ikke 0/undefined.
      },
    ],
    ensureSeasonStandings: async () => {},
    updateStandings: async () => {},
  });

  const [withPassage, legacy] = state.raceResults;
  assert.equal(withPassage.sprint_points, 6);
  assert.equal(withPassage.kom_points, 0);
  assert.equal(withPassage.bonus_seconds, 10);
  assert.equal(legacy.sprint_points, null);
  assert.equal(legacy.kom_points, null);
  assert.equal(legacy.bonus_seconds, null);
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

// ── #5645 (Y4): præmievagt ved kilden ────────────────────────────────────────
test("#5645 prizeMoneyForPoints: senior/ukendt trup uændret, u23/junior = 0", () => {
  for (const race of [null, undefined, {}, { squad: null }, { squad: "senior" }]) {
    assert.equal(isPrizeMoneyRace(race), true, JSON.stringify(race));
    assert.equal(prizeMoneyForPoints(10, race), 10 * PRIZE_PER_POINT);
  }
  for (const squad of ["u23", "junior"]) {
    assert.equal(isPrizeMoneyRace({ squad }), false);
    assert.equal(prizeMoneyForPoints(10, { squad }), 0);
  }
});

test("#5645 buildRaceResultsFromPending: ungdomsløb giver prize_money 0, point uændrede; uden race uændret", () => {
  const pendingRows = [{ rider_id: "r1", result_type: "gc", rank: 1, rider: { team_id: "t1", firstname: "A", lastname: "B" } }];
  const pointsLookup = { gc__1: 100 };
  const senior = buildRaceResultsFromPending({ pendingRows, pointsLookup, raceId: "race-1" });
  assert.equal(senior[0].prize_money, 100 * PRIZE_PER_POINT);
  const youth = buildRaceResultsFromPending({ pendingRows, pointsLookup, raceId: "race-1", race: { squad: "u23" } });
  assert.equal(youth[0].prize_money, 0);
  assert.equal(youth[0].points_earned, 100);
});

test("#5645 applyRaceResults: et ungdomsløb gemmer prize_money 0 selv om rækken bærer et beløb", async () => {
  const { supabase, state } = createSupabaseDouble({});
  await applyRaceResults({
    supabase,
    race: { id: "race-u", season_id: "season-1", squad: "junior" },
    resultRows: [{ rider_id: "r1", team_id: "t1", result_type: "gc", rank: 1, stage_number: 1, prize_money: 500, points_earned: 20 }],
  });
  assert.equal(state.raceResults.length, 1);
  assert.equal(state.raceResults[0].prize_money, 0);
  assert.equal(state.raceResults[0].points_earned, 20);
});

test("#5645 rederiveSeasonRacePoints: et U23-løb re-deriveres med point men prize_money 0", async () => {
  const { supabase, state } = createRederiveDouble({
    races: [
      { id: "race-s", race_class: "uci_wt", race_type: "stage_race", prize_paid_at: null, squad: "senior" },
      { id: "race-u", race_class: "uci_wt", race_type: "stage_race", prize_paid_at: null, squad: "u23" },
    ],
    racePointsByClass: { uci_wt: [{ result_type: "Klassement", rank: 1, points: 200 }] },
    raceResults: [
      { id: "rr-s", race_id: "race-s", result_type: "gc", rank: 1, points_earned: 100, prize_money: 100 * PRIZE_PER_POINT },
      { id: "rr-u", race_id: "race-u", result_type: "gc", rank: 1, points_earned: 100, prize_money: 100 * PRIZE_PER_POINT },
    ],
  });
  await rederiveSeasonRacePoints({ supabase, seasonId: "season-1", updateStandings: async () => {} });
  const byId = Object.fromEntries(state.raceResults.map((r) => [r.id, r]));
  assert.equal(byId["rr-s"].prize_money, 200 * PRIZE_PER_POINT);
  assert.equal(byId["rr-u"].points_earned, 200);
  assert.equal(byId["rr-u"].prize_money, 0);
});
