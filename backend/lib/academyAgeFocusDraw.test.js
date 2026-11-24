import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateAcademyCandidates } from "./academyGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

const referenceYear = 2030;
const ageOf = ({ rider }) => referenceYear - Number(rider.birthdate.slice(0, 4));
const candidates = (seed, countOverride, ageFocus = null) => generateAcademyCandidates({
  rng: makeRng(seed), referenceYear, existingNames: new Set(), countOverride, ageFocus,
});

test("mixed weekly cohorts match the pre-change generator digest", () => {
  const digest = createHash("sha256");
  for (let seed = 1; seed <= 4000; seed++) digest.update(JSON.stringify(candidates(seed, 3)));
  assert.equal(digest.digest("hex"), "19d36a35df23fadf1bca0972729f04675992a9eb5e5a8c2bb735cc728fcda1bd");
});

test("each focus increases its age without excluding ages or changing talent", () => {
  const fixtureShare = 0.4;
  for (const age of [16, 17, 18, 19]) {
    for (const count of [2, 4]) {
      const mixedAges = [];
      const focusedAges = [];
      for (let seed = 1; seed <= 450; seed++) {
        const mixed = candidates(seed, count);
        const focused = candidates(seed, count, { age, share: fixtureShare, rng: makeRng(seed ^ 0x435a6944) });
        assert.deepEqual(focused.map(({ rider }) => rider.potentiale), mixed.map(({ rider }) => rider.potentiale));
        mixedAges.push(...mixed.map(ageOf));
        focusedAges.push(...focused.map(ageOf));
      }
      const shareOfAge = (ages) => ages.filter((value) => value === age).length / ages.length;
      const unweightedShare = shareOfAge(mixedAges);
      const expected = unweightedShare + (1 - unweightedShare) * fixtureShare;
      const observed = shareOfAge(focusedAges);
      assert.ok(Math.abs(observed - expected) < 0.045, `age ${age}, cohort ${count}: ${observed} vs ${expected}`);
      assert.deepEqual([...new Set(focusedAges)].sort(), [16, 17, 18, 19, 20, 21]);
    }
  }
});
