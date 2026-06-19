import { test } from "node:test";
import assert from "node:assert/strict";
import { STAT_KEYS, riderStatRating } from "./riderRating.js";

test("riderStatRating: snit af alle 15 evner, afrundet (#1009/#1529)", () => {
  const rider = {};
  STAT_KEYS.forEach((k, i) => {
    rider[k] = 60 + (i % 3); // 60/61/62-mønster
  });
  const expected = Math.round(
    STAT_KEYS.reduce((sum, k) => sum + rider[k], 0) / STAT_KEYS.length,
  );
  assert.equal(riderStatRating(rider), expected);
});

test("riderStatRating: manglende/ikke-numeriske evner ignoreres i snittet", () => {
  const rider = { climbing: 80, sprint: 70, time_trial: null, flat: "abc" };
  assert.equal(riderStatRating(rider), 75);
});

test("riderStatRating: ingen evner -> 0 (sorterer nederst)", () => {
  assert.equal(riderStatRating({}), 0);
  assert.equal(riderStatRating(null), 0);
  assert.equal(riderStatRating(undefined), 0);
});

test("riderStatRating: klampes til 0-99", () => {
  const maxed = Object.fromEntries(STAT_KEYS.map((k) => [k, 150]));
  assert.equal(riderStatRating(maxed), 99);
  const negative = Object.fromEntries(STAT_KEYS.map((k) => [k, -5]));
  assert.equal(riderStatRating(negative), 0);
});

test("STAT_KEYS: 15 unikke CZ-evne-noegler (#1529)", () => {
  assert.equal(STAT_KEYS.length, 15);
  assert.equal(new Set(STAT_KEYS).size, 15);
  for (const k of STAT_KEYS) assert.match(k, /^[a-z][a-z_]+$/);
});
