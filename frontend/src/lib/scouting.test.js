import { test } from "node:test";
import assert from "node:assert/strict";
import { potentialLabelKey, scoutSortValue } from "./scouting.js";

// Estimat-beregningen (seededUnit/estimatePotentialRange) er flyttet til
// backend/lib/scouting.js (#1162) og testes i backend/lib/scouting.test.js.

// ── Labels ────────────────────────────────────────────────────────────────────

test("potentialLabelKey mapper midtpunkt til bånd", () => {
  assert.equal(potentialLabelKey({ lo: 5.5, hi: 6 }), "worldclass");
  assert.equal(potentialLabelKey({ lo: 4, hi: 5 }), "high");
  assert.equal(potentialLabelKey({ lo: 3, hi: 4 }), "solid");
  assert.equal(potentialLabelKey({ lo: 2, hi: 3 }), "rotation");
  assert.equal(potentialLabelKey(null), null);
});

// #3651: "limited"/"Limited upside" er fjernet helt, ikke erstattet — under
// rotation-tærsklen viser vi nu ingen kvalitativ label.
test("potentialLabelKey: under rotation-tærsklen → ingen label (#3651, 'limited' fjernet)", () => {
  assert.equal(potentialLabelKey({ lo: 1, hi: 2 }), null);
  assert.equal(potentialLabelKey({ lo: 1, hi: 1, exact: true }), null);
});

test("potentialLabelKey: eksakt estimat (lo == hi) får også label", () => {
  assert.equal(potentialLabelKey({ lo: 5.5, hi: 5.5, exact: true }), "worldclass");
  assert.equal(potentialLabelKey({ lo: 3.5, hi: 3.5, exact: true }), "solid");
});

test("potentialLabelKey: skjult (uscoutet) estimat → ingen label (#1543)", () => {
  assert.equal(potentialLabelKey({ hidden: true, level: 0 }), null);
});

// ── Sortering ─────────────────────────────────────────────────────────────────

test("scoutSortValue: midtpunkt af stjerneskalaen (fallback uden bånd); manglende estimat → null", () => {
  assert.equal(scoutSortValue({ lo: 3, hi: 5 }), 4);
  assert.equal(scoutSortValue({ lo: 4.5, hi: 4.5, exact: true }), 4.5);
  assert.equal(scoutSortValue(null), null);
  assert.equal(scoutSortValue(undefined), null);
});

test("scoutSortValue: skjult (uscoutet) estimat → null, IKKE 0 (#3787, #1543)", () => {
  assert.equal(scoutSortValue({ hidden: true, level: 0 }), null);
});

// #3787: reproducerer thelambas rapport. Serveren leverer et rating-bånd
// (`ceil`, #2454) som er det spilleren FAKTISK ser i ScoutablePotentiale — men
// sorteringen brugte den gamle 1-6-stjerneskala (lo/hi), som er en helt
// anden akse. To ryttere kan derfor bytte plads mellem det viste bånd og den
// gamle sorteringsnøgle.
test("scoutSortValue: sorterer på det VISTE ceil-bånd, ikke den skjulte stjerneskala (#3787)", () => {
  // Niklas: lavt vist bånd (66-74, midtpunkt 70) men højt stjerne-midtpunkt (5).
  const niklas = { lo: 4.5, hi: 5.5, level: 2, ceil: { lo: 66, hi: 74 } };
  // Anden rytter: højere vist bånd (78-84, midtpunkt 81) men lavere stjerne-midtpunkt (3.5).
  const other = { lo: 3, hi: 4, level: 2, ceil: { lo: 78, hi: 84 } };

  assert.equal(scoutSortValue(niklas), 70);
  assert.equal(scoutSortValue(other), 81);
  // Den gamle stjerneskala ville have rangeret Niklas (5) over den anden (3.5) —
  // det viste bånd (70 < 81) skal vinde.
  assert.ok(scoutSortValue(niklas) < scoutSortValue(other));
});

test("scoutSortValue: falder til stjerneskalaen når `ceil` mangler (defensiv, ældre payload)", () => {
  assert.equal(scoutSortValue({ lo: 3, hi: 5, level: 1 }), 4);
});

// #3787: sortering skal følge PROGNOSE-båndets (rating-point) midtpunkt, som
// er det tal spilleren ser — ikke stjerne-estimatets midtpunkt (1-6-skala).
test("scoutSortValue: bruger prog-båndets midtpunkt frem for stjerne-midtpunktet, når begge findes", () => {
  const estimate = { lo: 4.5, hi: 5, role: "sprinter", now: 29, prog: { lo: 40, hi: 48 } };
  assert.equal(scoutSortValue(estimate), 44);
});

test("scoutSortValue: `ceil` er en gyldig alias for `prog` (#3746 kompatibilitet)", () => {
  const estimate = { lo: 4.5, hi: 5, role: "sprinter", now: 29, ceil: { lo: 40, hi: 48 } };
  assert.equal(scoutSortValue(estimate), 44);
});

test("scoutSortValue: `prog` foretrækkes hvis begge `prog` og `ceil` findes", () => {
  const estimate = { lo: 4.5, hi: 5, prog: { lo: 40, hi: 48 }, ceil: { lo: 10, hi: 12 } };
  assert.equal(scoutSortValue(estimate), 44);
});
