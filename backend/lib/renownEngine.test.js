import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRenownMultiplier,
  renownTarget,
  W_RESULTS,
  MAX_MULTIPLIER,
} from "./renownEngine.js";

test("frisk hold (ingen historik) → multiplier 1,0", () => {
  const m = computeRenownMultiplier({ division: 3, lastSeasonStanding: null, divisionStandings: [] });
  assert.equal(m, 1.0);
});

test("dominerende hold clamp'es til MAX_MULTIPLIER", () => {
  const standings = [
    { team_id: "a", total_points: 1000, rank_in_division: 1, division: 1 },
    { team_id: "b", total_points: 100, rank_in_division: 2, division: 1 },
  ];
  const m = computeRenownMultiplier({
    division: 1,
    lastSeasonStanding: standings[0],
    divisionStandings: standings,
  });
  assert.equal(m, MAX_MULTIPLIER);
});

test("renownTarget = division-base × multiplier", () => {
  assert.equal(renownTarget({ division: 3, lastSeasonStanding: null, divisionStandings: [] }), 340000);
});

test("W_RESULTS giver top-hold ≈ MAX (sanity)", () => {
  assert.ok(1 + W_RESULTS >= MAX_MULTIPLIER - 1e-9);
});
