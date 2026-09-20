import test from "node:test";
import assert from "node:assert/strict";

import {
  SKIP_REASONS,
  evaluateCandidate,
  selectCandidates,
  summarizeSelection,
} from "./unfreezeSelection5443.js";

const ok = () => ({
  id: "r1", name: "Test Rytter", teamId: "t1", found: true, active: true, humanTeam: true,
  hasAbilities: true, valuationType: "tt", primaryType: "sprinter",
  storedValue: 100_000, frozenValue: 100_000, unfrozenValue: 150_000, targetValue: 160_000,
});

test("en rytter der stiger og ikke overskyder kommer med", () => {
  const v = evaluateCandidate(ok());
  assert.equal(v.include, true);
  assert.ok(Math.abs(v.gainPct - 50) < 1e-9);
  assert.ok(v.overshootPct < 0);
});

test("afvises hvis han ikke længere er aktiv, på menneskehold eller har et mismatch", () => {
  assert.equal(evaluateCandidate({ ...ok(), active: false }).reason, SKIP_REASONS.RETIRED);
  assert.equal(evaluateCandidate({ ...ok(), humanTeam: false }).reason, SKIP_REASONS.NOT_HUMAN_TEAM);
  assert.equal(evaluateCandidate({ ...ok(), valuationType: "sprinter" }).reason, SKIP_REASONS.NO_MISMATCH);
  assert.equal(evaluateCandidate({ ...ok(), found: false }).reason, SKIP_REASONS.NOT_FOUND);
  assert.equal(evaluateCandidate({ ...ok(), hasAbilities: false }).reason, SKIP_REASONS.NO_ABILITIES);
});

test("ingen må falde i dag — en rytter hvis værdi ikke stiger afvises", () => {
  assert.equal(evaluateCandidate({ ...ok(), unfrozenValue: 90_000 }).reason, SKIP_REASONS.NOT_A_GAIN);
  // Præcis på grænsen (1 %) er IKKE nok — kravet er "mere end".
  assert.equal(evaluateCandidate({ ...ok(), unfrozenValue: 101_000 }).reason, SKIP_REASONS.NOT_A_GAIN);
  assert.equal(evaluateCandidate({ ...ok(), unfrozenValue: 102_000 }).include, true);
});

test("ingen må få en værdi der senere skal ned igen — overskydning afvises", () => {
  // 10 % over målet er tilladt, 10,1 % er ikke.
  assert.equal(evaluateCandidate({ ...ok(), unfrozenValue: 110_000, targetValue: 100_000 }).include, true);
  const over = evaluateCandidate({ ...ok(), unfrozenValue: 110_100, targetValue: 100_000 });
  assert.equal(over.include, false);
  assert.equal(over.reason, SKIP_REASONS.OVERSHOOT);
});

test("uden et mål er der ingen loft-test (men gevinst-kravet gælder stadig)", () => {
  const v = evaluateCandidate({ ...ok(), targetValue: null });
  assert.equal(v.include, true);
  assert.equal(v.overshootPct, null);
  assert.equal(evaluateCandidate({ ...ok(), targetValue: null, unfrozenValue: 50 }).include, false);
});

test("manglende gemt værdi giver en egen årsag i stedet for at dividere med nul", () => {
  assert.equal(evaluateCandidate({ ...ok(), storedValue: null }).reason, SKIP_REASONS.NO_STORED_VALUE);
  assert.equal(evaluateCandidate({ ...ok(), storedValue: 0 }).reason, SKIP_REASONS.NO_STORED_VALUE);
});

test("tærsklerne kan sættes af kalderen", () => {
  const c = { ...ok(), unfrozenValue: 104_000 };
  assert.equal(evaluateCandidate(c, { minGainPct: 5 }).include, false);
  assert.equal(evaluateCandidate(c, { minGainPct: 1 }).include, true);
});

test("selectCandidates deler listen og tæller årsagerne", () => {
  const { selected, skipped, byReason } = selectCandidates([
    ok(),
    { ...ok(), id: "r2", active: false },
    { ...ok(), id: "r3", unfrozenValue: 90_000 },
    { ...ok(), id: "r4", teamId: "t2" },
  ]);
  assert.deepEqual(selected.map((x) => x.id), ["r1", "r4"]);
  assert.equal(skipped.length, 2);
  assert.equal(byReason[SKIP_REASONS.RETIRED], 1);
  assert.equal(byReason[SKIP_REASONS.NOT_A_GAIN], 1);
});

test("summarizeSelection tæller ryttere, hold og sum", () => {
  const s = summarizeSelection([
    { ...ok(), teamId: "t1" },
    { ...ok(), teamId: "t1" },
    { ...ok(), teamId: "t2", storedValue: 50_000, unfrozenValue: 75_000 },
  ]);
  assert.equal(s.riders, 3);
  assert.equal(s.teams, 2);
  assert.equal(s.sum_before, 250_000);
  assert.equal(s.sum_after, 375_000);
  assert.ok(Math.abs(s.sum_pct - 50) < 1e-9);
});

test("tom liste giver nul, ikke NaN", () => {
  const s = summarizeSelection([]);
  assert.equal(s.riders, 0);
  assert.equal(s.sum_pct, null);
});
