import test from "node:test";
import assert from "node:assert/strict";

import { buildRaceDayStageByRider, loadRaceDayStagesByRider } from "./raceDayStageLookup.js";

// ── Lille in-memory mock: kun det opslaget bruger (select/eq/in/maybeSingle) ──
function createMock(state, opts = {}) {
  const calls = [];
  function builder(table, filters = []) {
    const match = (row) => filters.every(([col, val, op]) => (op === "in" ? val.includes(row[col]) : row[col] === val));
    const run = () => {
      if (opts.errorOn === table) return { data: null, error: { message: `${table} boom` } };
      return { data: (state[table] ?? []).filter(match), error: null };
    };
    return {
      select() { calls.push(table); return builder(table, filters); },
      eq(col, val) { return builder(table, [...filters, [col, val, "eq"]]); },
      in(col, vals) { return builder(table, [...filters, [col, vals, "in"]]); },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(resolve) { return Promise.resolve(run()).then(resolve); },
    };
  }
  return { from: (table) => builder(table), calls };
}

const TEAM = "team-1";
const SEASON = "season-3";
const OLD_SEASON = "season-2";
const DIVISION = "div-d3a";

// To loebsdage (12 og 13) paa SAMME kalenderdato: race-1 etape 1 paa loebsdag 12,
// race-2 etape 3 paa loebsdag 13. Rytter A koerte race-1, rytter B race-2.
// race-9 er et loeb fra SIDSTE saeson med "samme" loebsdag 12 — det maa ikke taelle.
function seedState() {
  return {
    teams: [{ id: TEAM, league_division_id: DIVISION }],
    races: [
      { id: "race-1", season_id: SEASON, league_division_id: DIVISION },
      { id: "race-2", season_id: SEASON, league_division_id: DIVISION },
      { id: "race-9", season_id: OLD_SEASON, league_division_id: DIVISION },
    ],
    race_stage_schedule: [
      { race_id: "race-1", stage_number: 1, game_day: 12 },
      { race_id: "race-2", stage_number: 2, game_day: 12 },
      { race_id: "race-2", stage_number: 3, game_day: 13 },
      { race_id: "race-9", stage_number: 1, game_day: 12 },
    ],
    race_results: [
      { rider_id: "A", race_id: "race-1", stage_number: 1, result_type: "stage" },
      { rider_id: "A", race_id: "race-1", stage_number: 1, result_type: "gc" },
      { rider_id: "B", race_id: "race-2", stage_number: 2, result_type: "stage" },
      { rider_id: "B", race_id: "race-2", stage_number: 3, result_type: "stage" },
      { rider_id: "C", race_id: "race-9", stage_number: 1, result_type: "stage" },
      { rider_id: "X", race_id: "race-1", stage_number: 1, result_type: "stage" }, // andet hold
    ],
    race_stage_profiles: [
      { race_id: "race-1", stage_number: 1, profile_type: "mountain" },
      { race_id: "race-2", stage_number: 2, profile_type: "hilly" },
      { race_id: "race-2", stage_number: 3, profile_type: "flat" },
    ],
    // BEVIDST ingen race_entry_days: loebet er afsluttet, bindingen er slettet
    // (risiko 1). Opslaget maa ikke kende til tabellen overhovedet.
  };
}

const RIDERS = ["A", "B", "C"];

test("ren sammenkobling: kun etaper paa loebsdagen taeller, og profilen foelger etapen", () => {
  const out = buildRaceDayStageByRider({
    scheduleRows: [{ race_id: "race-1", stage_number: 1, game_day: 12 }],
    resultRows: [
      { rider_id: "A", race_id: "race-1", stage_number: 1 },
      { rider_id: "B", race_id: "race-1", stage_number: 2 },
    ],
    profileRows: [{ race_id: "race-1", stage_number: 1, profile_type: "mountain" }],
  });
  assert.deepEqual([...out.keys()], ["A"]);
  assert.deepEqual(out.get("A"), { raceId: "race-1", stageNumber: 1, profileType: "mountain" });
});

test("ren sammenkobling: manglende profil giver null (kalderen falder til rolling), tom input giver tom map", () => {
  const out = buildRaceDayStageByRider({
    scheduleRows: [{ race_id: "race-1", stage_number: 1, game_day: 12 }],
    resultRows: [{ rider_id: "A", race_id: "race-1", stage_number: 1 }],
  });
  assert.equal(out.get("A").profileType, null);
  assert.equal(buildRaceDayStageByRider().size, 0);
});

test("to loebsdage samme dato: hver rytter faar sin EGEN etapes profil", async () => {
  const state = seedState();
  const day12 = await loadRaceDayStagesByRider({
    supabase: createMock(state), teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS,
  });
  const day13 = await loadRaceDayStagesByRider({
    supabase: createMock(state), teamId: TEAM, seasonId: SEASON, gameDay: 13, riderIds: RIDERS,
  });
  assert.equal(day12.error, null);
  assert.deepEqual([...day12.data.keys()].sort(), ["A", "B"]);
  assert.equal(day12.data.get("A").profileType, "mountain", "A koerte bjergetapen paa loebsdag 12");
  assert.equal(day12.data.get("B").profileType, "hilly", "B koerte race-2's etape 2 paa loebsdag 12");
  assert.deepEqual([...day13.data.keys()], ["B"], "kun B koerte paa loebsdag 13");
  assert.equal(day13.data.get("B").profileType, "flat", "og det var etape 3, ikke etape 2");
});

test("risiko 1: et AFSLUTTET loeb uden binding findes stadig (kilden er resultater + kalender)", async () => {
  const state = seedState();
  assert.equal(state.race_entry_days, undefined, "ingen bindings-raekker overhovedet");
  const mock = createMock(state);
  const out = await loadRaceDayStagesByRider({
    supabase: mock, teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: ["A"],
  });
  assert.equal(out.data.get("A").raceId, "race-1");
  assert.ok(!mock.calls.includes("race_entry_days"), "race_entry_days laeses aldrig");
});

test("saeson-scoping: sidste saesons loebsdag 12 taeller ikke, og ryttere fra andre hold ignoreres", async () => {
  const state = seedState();
  const out = await loadRaceDayStagesByRider({
    supabase: createMock(state), teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS,
  });
  assert.equal(out.data.has("C"), false, "C's resultat er fra race-9 i sidste saeson");
  assert.equal(out.data.has("X"), false, "X er ikke i riderIds");
});

test("withProfiles=false: etaperne findes, profilen hentes ikke", async () => {
  const state = seedState();
  const mock = createMock(state);
  const out = await loadRaceDayStagesByRider({
    supabase: mock, teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS, withProfiles: false,
  });
  assert.equal(out.data.get("A").profileType, null);
  assert.ok(!mock.calls.includes("race_stage_profiles"), "ingen profil-query naar udviklingen er slukket");
});

test("hold uden division, uden loeb eller uden etaper paa dagen: tom map, ingen fejl", async () => {
  const noDivision = seedState();
  noDivision.teams = [{ id: TEAM, league_division_id: null }];
  const a = await loadRaceDayStagesByRider({ supabase: createMock(noDivision), teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS });
  assert.equal(a.error, null);
  assert.equal(a.data.size, 0);

  const emptyDay = seedState();
  const b = await loadRaceDayStagesByRider({ supabase: createMock(emptyDay), teamId: TEAM, seasonId: SEASON, gameDay: 40, riderIds: RIDERS });
  assert.equal(b.error, null);
  assert.equal(b.data.size, 0);

  const c = await loadRaceDayStagesByRider({ supabase: createMock(seedState()), teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: [] });
  assert.equal(c.data.size, 0);
});

test("fejl-kontrakt: en fejlet kalender- eller resultat-query giver data=null + error (kalderen kaster)", async () => {
  for (const table of ["teams", "races", "race_stage_schedule", "race_results"]) {
    const out = await loadRaceDayStagesByRider({
      supabase: createMock(seedState(), { errorOn: table }), teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS,
    });
    assert.equal(out.data, null, `${table}: svaret er UKENDT, ikke tomt`);
    assert.match(out.error.message, new RegExp(table));
  }
});

test("fejl-kontrakt: en fejlet profil-query er best-effort — etaperne kendes, profileError er sat", async () => {
  const out = await loadRaceDayStagesByRider({
    supabase: createMock(seedState(), { errorOn: "race_stage_profiles" }), teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS,
  });
  assert.equal(out.error, null);
  assert.ok(out.profileError, "profil-fejlen rapporteres");
  assert.equal(out.data.get("A").profileType, null, "profilen er ukendt, ikke gaettet");
});

test("ugyldige argumenter: manglende loebsdag (ogsaa null, som Number() goer til 0) afvises", async () => {
  for (const gameDay of [null, undefined, NaN, "x"]) {
    const out = await loadRaceDayStagesByRider({
      supabase: createMock(seedState()), teamId: TEAM, seasonId: SEASON, gameDay, riderIds: RIDERS,
    });
    assert.equal(out.data, null);
    assert.match(out.error.message, /gameDay/);
  }
  const noClient = await loadRaceDayStagesByRider({ supabase: null, teamId: TEAM, seasonId: SEASON, gameDay: 12, riderIds: RIDERS });
  assert.equal(noClient.data, null);
});
