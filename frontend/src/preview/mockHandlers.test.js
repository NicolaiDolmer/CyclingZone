import test from "node:test";
import assert from "node:assert/strict";
import { restRows, restObject, apiResponse } from "./mockHandlers.js";

test("races-tabel returnerer seed-løb", () => {
  const rows = restRows("races", "https://x/rest/v1/races?select=*");
  assert.ok(rows.length >= 3, "forventede seed-løb");
});

test("races id=eq filtrerer til ét løb", () => {
  const rows = restRows("races", "https://x/rest/v1/races?id=eq.race-up-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "race-up-1");
});

test("races .single() (restObject) returnerer ét seed-løb", () => {
  const row = restObject("races", "https://x/rest/v1/races?id=eq.race-up-1");
  assert.equal(row.id, "race-up-1");
  assert.equal(row.name, "Tour de Preview");
});

test("race_stage_profiles race_id=eq filtrerer til løbets etaper", () => {
  const rows = restRows("race_stage_profiles", "https://x/rest/v1/race_stage_profiles?race_id=eq.race-up-1");
  assert.ok(rows.length >= 1, "forventede stage-profiler for race-up-1");
  assert.ok(rows.every(p => p.race_id === "race-up-1"));
});

test("race_results returnerer seed for den race-scopede query", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?race_id=eq.race-done-1");
  assert.ok(rows.length >= 1, "forventede resultater for race-done-1");
  assert.ok(rows.every(r => r.race_id === "race-done-1"));
});

test("race_results uden race_id-filter → tom (uændret dashboard-adfærd)", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?select=*");
  assert.equal(rows.length, 0);
});

// #1997 S1 — Palmarès-fanens rytter-scopede query (RiderStatsPage.fetchAllRiderSeasonRows).
test("race_results rider_id=eq.rider-1 → palmarès-seed med race:-embed + team_name", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?rider_id=eq.rider-1&select=rank,team_name");
  assert.ok(rows.length >= 1, "forventede palmarès-resultater for rider-1");
  assert.ok(rows.every(r => r.race && r.race.id), "hver række har et race:-embed (ikke rider:-embed)");
  assert.ok(rows.every(r => typeof r.team_name === "string" && r.team_name.length > 0), "hver række har et holdnavn (#1993-snapshot)");
  assert.ok(rows.some(r => r.result_type === "gc" && r.rank === 1), "mindst én GC-/endagssejr");
});

test("race_results rider_id=eq.<ukendt> → tom (kun rider-1 har palmarès-seed)", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?rider_id=eq.rider-2");
  assert.equal(rows.length, 0);
});

test("/api/races/distribution returnerer board-payload", () => {
  const r = apiResponse("/api/races/distribution");
  assert.ok(r && r.enabled === true);
  assert.ok(Array.isArray(r.columns) && r.columns.length >= 1);
});

test("/api/races/strategy returnerer strategi-payload", () => {
  const r = apiResponse("/api/races/strategy");
  assert.ok(r && typeof r === "object");
  assert.equal(r.enabled, true);
  assert.ok(Array.isArray(r.roster));
});

// S6 (#1835): browse-routen er mere specifik end /distribution → må ikke fanges af den.
test("/api/races/distribution/browse returnerer read-only browse-payload (ikke board)", () => {
  const r = apiResponse("/api/races/distribution/browse");
  assert.ok(r && r.enabled === true);
  assert.ok(Array.isArray(r.pools) && r.pools.length >= 1, "pulje-vælger har puljer");
  assert.ok(r.pool && r.horizonDays === 7);
  assert.ok(Array.isArray(r.columns) && r.columns.length >= 1);
  // Bruttotrup: ryttere bærer KUN navn + nationalitet, ingen roller/form/træthed.
  const withTeams = r.columns.find((c) => c.visible && c.teams.length);
  assert.ok(withTeams, "mindst ét synligt løb med hold");
  const rider = withTeams.teams[0].riders[0];
  assert.deepEqual(Object.keys(rider).sort(), ["firstname", "id", "lastname", "nationality_code"]);
  // Mindst ét låst løb (uden for 7-dages-vinduet) uden hold-data.
  assert.ok(r.columns.some((c) => c.visible === false && c.teams.length === 0));
});
