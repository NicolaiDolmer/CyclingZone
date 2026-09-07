// backend/scripts/lib/populationAbilityDistribution.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeAbilityDistribution,
  formatAbilityDistribution,
  DEFAULT_DISTRIBUTION_ABILITIES,
} from "./populationAbilityDistribution.js";

function riderWith(abilities) {
  return { abilities };
}

test("computeAbilityDistribution: p10/p50/p90 pr. evne, naermeste-rang som headToHeadStats", () => {
  const riders = [1, 7, 9, 30, 93].map((climbing) => riderWith({ climbing, flat: 10 }));
  const [climbingRow, flatRow] = computeAbilityDistribution(riders, ["climbing", "flat"]);
  assert.equal(climbingRow.ability, "climbing");
  assert.equal(climbingRow.n, 5);
  assert.equal(climbingRow.p10, 1);
  assert.equal(climbingRow.p50, 9);
  assert.equal(climbingRow.p90, 93);
  assert.equal(flatRow.p50, 10);
});

test("computeAbilityDistribution: tom liste -> n=0, p10/p50/p90=null (aldrig 0)", () => {
  const [row] = computeAbilityDistribution([], ["climbing"]);
  assert.equal(row.n, 0);
  assert.equal(row.p10, null);
  assert.equal(row.p50, null);
  assert.equal(row.p90, null);
});

test("computeAbilityDistribution: null/manglende evne-vaerdier tælles ikke med", () => {
  const riders = [riderWith({ climbing: 5 }), riderWith({ climbing: null }), riderWith({}), { abilities: undefined }];
  const [row] = computeAbilityDistribution(riders, ["climbing"]);
  assert.equal(row.n, 1);
  assert.equal(row.p50, 5);
});

test("computeAbilityDistribution: default-listen er de 6 evner fra #4936 (issue-title)", () => {
  assert.deepEqual(DEFAULT_DISTRIBUTION_ABILITIES, [
    "climbing",
    "flat",
    "sprint",
    "endurance",
    "tempo",
    "descending",
  ]);
});

test("formatAbilityDistribution: én linje pr. evne, n/a for tom population", () => {
  const output = formatAbilityDistribution([], ["climbing", "sprint"]);
  const lines = output.split("\n");
  assert.equal(lines.length, 3); // header + 2 evner
  assert.match(lines[1], /climbing: p10=n\/a p50=n\/a p90=n\/a \(n=0\)/);
  assert.match(lines[2], /sprint: p10=n\/a p50=n\/a p90=n\/a \(n=0\)/);
});

test("formatAbilityDistribution: reelle tal formateres uden decimaler-stoej", () => {
  const riders = [1, 7, 30].map((climbing) => riderWith({ climbing }));
  const output = formatAbilityDistribution(riders, ["climbing"]);
  assert.match(output, /climbing: p10=1 p50=7 p90=30 \(n=3\)/);
});
