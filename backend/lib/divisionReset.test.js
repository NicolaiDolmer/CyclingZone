import test from "node:test";
import assert from "node:assert/strict";

import { planDivisionReset } from "./divisionReset.js";

// Hjælper: byg et hold med eksplicitte liveness-flag (default = AI-hold).
const team = (overrides = {}) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  is_ai: true,
  is_bank: false,
  is_frozen: false,
  is_test_account: false,
  ...overrides,
});

const race = (id) => ({ id });

test("nægter når mindst ét ÆGTE hold findes i divisionen", () => {
  const teams = [
    team({ is_ai: true }),
    team({ is_ai: false, is_bank: false, is_frozen: false }), // ægte spiller
  ];
  const r = planDivisionReset({ races: [race("r1"), race("r2")], teams });
  assert.equal(r.allowed, false);
  assert.equal(r.hasRealTeams, true);
  assert.match(r.reason, /ægte|real/i);
  // raceIds returneres stadig (til dry-run-rapportering), men allowed=false blokerer writes.
  assert.deepEqual(r.raceIds.sort(), ["r1", "r2"]);
});

test("tillader når kun AI/bank/frozen/test-hold findes", () => {
  const teams = [
    team({ is_ai: true }),
    team({ is_ai: false, is_bank: true }), // bank-hold tæller ikke som ægte
    team({ is_ai: false, is_frozen: true }), // frosset tæller ikke som ægte
    team({ is_ai: false, is_test_account: true }), // test-konto tæller ikke som ægte
  ];
  const r = planDivisionReset({ races: [race("r1")], teams });
  assert.equal(r.allowed, true);
  assert.equal(r.hasRealTeams, false);
  assert.equal(r.reason, undefined);
});

test("tillader når divisionen er helt tom for hold", () => {
  const r = planDivisionReset({ races: [], teams: [] });
  assert.equal(r.allowed, true);
  assert.equal(r.hasRealTeams, false);
  assert.deepEqual(r.raceIds, []);
});

test("returnerer korrekte raceIds (deduplikeret, null/undefined frasorteret)", () => {
  const races = [race("r1"), race("r2"), race("r1"), { id: null }, {}];
  const r = planDivisionReset({ races, teams: [team()] });
  assert.deepEqual(r.raceIds.sort(), ["r1", "r2"]);
});

test("frozen alene (is_ai=false, is_frozen=true) er ikke ægte → tillader", () => {
  const r = planDivisionReset({ races: [race("r1")], teams: [team({ is_ai: false, is_frozen: true })] });
  assert.equal(r.allowed, true);
});
