import { test } from "node:test";
import assert from "node:assert/strict";
import { STAT_KEYS, riderStatRating } from "./riderRating.js";

test("riderStatRating: snit af alle 14 stats, afrundet (#1009)", () => {
  const rider = {};
  STAT_KEYS.forEach((k, i) => {
    rider[k] = 60 + (i % 3); // 60/61/62-mønster
  });
  const expected = Math.round(
    STAT_KEYS.reduce((sum, k) => sum + rider[k], 0) / STAT_KEYS.length,
  );
  assert.equal(riderStatRating(rider), expected);
});

test("riderStatRating: manglende/ikke-numeriske stats ignoreres i snittet", () => {
  const rider = { stat_fl: 80, stat_bj: 70, stat_sp: null, stat_tt: "abc" };
  assert.equal(riderStatRating(rider), 75);
});

test("riderStatRating: ingen stats -> 0 (sorterer nederst)", () => {
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

test("STAT_KEYS: 14 unikke stat-noegler", () => {
  assert.equal(STAT_KEYS.length, 14);
  assert.equal(new Set(STAT_KEYS).size, 14);
  for (const k of STAT_KEYS) assert.match(k, /^stat_[a-z]+$/);
});
