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
