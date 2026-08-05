// Forward-guard (#3022): entrant_key-logikken der spejler DB-constrainten
// race_results_entrant_unique, plus batch-validatoren der afviser ugyldige/
// kolliderende rækker FØR de når databasen.
import test from "node:test";
import assert from "node:assert/strict";

import { computeEntrantKey, hasValidEntrantIdentity, assertValidEntrantRows } from "./raceResultEntrantKey.js";

test("computeEntrantKey: rider-scoped række med rider_id bruger FK'en direkte", () => {
  const row = { result_type: "stage", rider_id: "rider-1", rider_name: "Jonas Vingegaard", team_name: "Team Visma" };
  assert.equal(computeEntrantKey(row), "rider-1");
});

test("computeEntrantKey: rider-scoped række uden rider_id falder tilbage til navne-snapshot", () => {
  const row = { result_type: "gc", rider_id: null, rider_name: "AI Rider 7", team_name: "AI Team 12" };
  assert.equal(computeEntrantKey(row), "rider-name:ai rider 7::ai team 12");
});

test("computeEntrantKey: navne-fallback er case/whitespace-insensitiv (matcher lower(btrim(...)) i SQL)", () => {
  const a = { result_type: "gc", rider_name: "  AI Rider 7  ", team_name: "AI Team 12" };
  const b = { result_type: "gc", rider_name: "ai rider 7", team_name: "ai team 12" };
  assert.equal(computeEntrantKey(a), computeEntrantKey(b));
});

test("computeEntrantKey: team-scoped række (team/team_day) bruger team_id, ikke rider_id", () => {
  const row = { result_type: "team", rider_id: null, team_id: "team-1", team_name: "Team Visma" };
  assert.equal(computeEntrantKey(row), "team-1");
});

test("computeEntrantKey: team_day uden team_id falder tilbage til team-navn", () => {
  const row = { result_type: "team_day", team_id: null, team_name: "AI Team 12" };
  assert.equal(computeEntrantKey(row), "team-name:ai team 12");
});

test("hasValidEntrantIdentity: false når hverken FK eller navn er sat (rider-scoped)", () => {
  assert.equal(hasValidEntrantIdentity({ result_type: "stage", rider_id: null, rider_name: null }), false);
  assert.equal(hasValidEntrantIdentity({ result_type: "stage", rider_id: null, rider_name: "" }), false);
  assert.equal(hasValidEntrantIdentity({ result_type: "stage", rider_id: null, rider_name: "   " }), false);
});

test("hasValidEntrantIdentity: true når enten FK eller ikke-tomt navn er sat", () => {
  assert.equal(hasValidEntrantIdentity({ result_type: "stage", rider_id: "r1", rider_name: null }), true);
  assert.equal(hasValidEntrantIdentity({ result_type: "stage", rider_id: null, rider_name: "Someone" }), true);
});

test("hasValidEntrantIdentity: team-scoped bruger team_id/team_name, ikke rider-felterne", () => {
  assert.equal(hasValidEntrantIdentity({ result_type: "team", team_id: null, team_name: null, rider_name: "Should Not Matter" }), false);
  assert.equal(hasValidEntrantIdentity({ result_type: "team", team_id: null, team_name: "AI Team 3" }), true);
});

test("assertValidEntrantRows: kaster med forklarende budskab for en række uden gyldig deltager", () => {
  const rows = [
    { race_id: "race-1", stage_number: 1, result_type: "gc", rider_id: null, rider_name: null, team_name: null },
  ];
  assert.throws(() => assertValidEntrantRows(rows), /uden gyldig deltager-identitet/);
});

test("assertValidEntrantRows: kaster ved to rækker der kolliderer på entrant_key i samme batch", () => {
  const rows = [
    { race_id: "race-1", stage_number: 1, result_type: "stage", rank: 1, rider_id: "rider-1" },
    { race_id: "race-1", stage_number: 1, result_type: "stage", rank: 2, rider_id: "rider-1" }, // samme rytter, samme klassement — ville kollidere
  ];
  assert.throws(() => assertValidEntrantRows(rows), /kollidere med race_results_entrant_unique/);
});

test("assertValidEntrantRows: kaster ved to orphan-rækker med identisk navne-fallback i samme batch", () => {
  const rows = [
    { race_id: "race-1", stage_number: 4, result_type: "gc", rider_id: null, rider_name: "AI Rider 7", team_name: "AI Team 12" },
    { race_id: "race-1", stage_number: 4, result_type: "gc", rider_id: null, rider_name: "AI Rider 7", team_name: "AI Team 12" },
  ];
  assert.throws(() => assertValidEntrantRows(rows), /kollidere med race_results_entrant_unique/);
});

test("assertValidEntrantRows: no-op for en realistisk blandet batch (rigtige ryttere + AI-orphans + team-rækker)", () => {
  const rows = [
    { race_id: "race-1", stage_number: 1, result_type: "stage", rank: 1, rider_id: "rider-1", rider_name: "Real Rider", team_id: "team-1", team_name: "Real Team" },
    { race_id: "race-1", stage_number: 1, result_type: "stage", rank: 2, rider_id: null, rider_name: "AI Rider 7", team_id: null, team_name: "AI Team 12" },
    { race_id: "race-1", stage_number: 1, result_type: "stage", rank: 3, rider_id: null, rider_name: "AI Rider 8", team_id: null, team_name: "AI Team 12" }, // samme AI-hold, ANDET navn — ingen kollision
    { race_id: "race-1", stage_number: 1, result_type: "team", rank: 1, team_id: "team-1", team_name: "Real Team" },
    { race_id: "race-1", stage_number: 1, result_type: "team", rank: 2, team_id: null, team_name: "AI Team 12" },
  ];
  assert.doesNotThrow(() => assertValidEntrantRows(rows));
});

test("assertValidEntrantRows: forskellige result_types for samme rytter/etape kolliderer IKKE (gc vs. points er forskellige klassementer)", () => {
  const rows = [
    { race_id: "race-1", stage_number: 2, result_type: "gc", rider_id: "rider-1" },
    { race_id: "race-1", stage_number: 2, result_type: "points", rider_id: "rider-1" },
  ];
  assert.doesNotThrow(() => assertValidEntrantRows(rows));
});

test("assertValidEntrantRows: forskellige stage_number for samme rytter/type kolliderer IKKE", () => {
  const rows = [
    { race_id: "race-1", stage_number: 1, result_type: "stage", rider_id: "rider-1" },
    { race_id: "race-1", stage_number: 2, result_type: "stage", rider_id: "rider-1" },
  ];
  assert.doesNotThrow(() => assertValidEntrantRows(rows));
});
