import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DIVISION_ADJUSTMENT_FACTOR,
  FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT,
  computeDivisionAdjustment,
  applyModifierToAdjustment,
  resolveDivisionAdjustment,
  divisionAdjustmentIdempotencyKey,
} from "./divisionAdjustment.js";
import {
  PARACHUTE_FACTOR,
  SPONSOR_INCOME_BY_DIVISION,
  MAX_BOARD_MODIFIER,
} from "./economyConstants.js";

// ── Den bærende invariant ────────────────────────────────────────────────────
// Hele designet hviler på at tillæggets fradrag og nedrykningsfaldskærmen ophæver
// hinanden eksakt for et nedrykket hold med løbende aftale. Divergerer de to faktorer,
// begynder motoren at over- eller underkompensere uden at nogen anden test opdager det.
test("faktoren ER PARACHUTE_FACTOR — symmetrien er ikke en kommentar, den er en invariant", () => {
  assert.equal(DIVISION_ADJUSTMENT_FACTOR, PARACHUTE_FACTOR);
});

test("fradrag og faldskærm ophæver hinanden eksakt ved nedrykning med løbende aftale", () => {
  for (const [oldDiv, newDiv] of [[1, 2], [2, 3]]) {
    const parachute = Math.round(
      PARACHUTE_FACTOR *
        (SPONSOR_INCOME_BY_DIVISION[oldDiv] - SPONSOR_INCOME_BY_DIVISION[newDiv])
    );
    const adjustment = computeDivisionAdjustment({
      currentDivision: newDiv,
      signedDivision: oldDiv,
      seasonNumber: FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT,
    });
    assert.equal(parachute + adjustment, 0, `D${oldDiv}→D${newDiv} går ikke i nul`);
  }
});

// ── Oprykning ────────────────────────────────────────────────────────────────
test("oprykning giver halvdelen af forskellen mellem de to divisioners base", () => {
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 3, seasonNumber: 3 }),
    130000
  );
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 2, seasonNumber: 3 }),
    100000
  );
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 4, seasonNumber: 3 }),
    142500
  );
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 3, signedDivision: 4, seasonNumber: 3 }),
    12500
  );
});

// ── Overgangsreglen for S3 (ejer-valg 5) ─────────────────────────────────────
test("nedadgående korrektion er slået fra før sæson 4, opadgående er ikke", () => {
  const down = { currentDivision: 3, signedDivision: 2 };
  assert.equal(computeDivisionAdjustment({ ...down, seasonNumber: 3 }), 0);
  assert.equal(computeDivisionAdjustment({ ...down, seasonNumber: 4 }), -30000);
  assert.equal(computeDivisionAdjustment({ ...down, seasonNumber: 5 }), -30000);

  // Oprykning rammes ALDRIG af overgangsreglen — heller ikke i sæson 1.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 3, seasonNumber: 1 }),
    130000
  );
});

test("D3→D4 giver fradrag fra sæson 4 selvom der aldrig har været faldskærm dertil", () => {
  // #1980 ekskluderer bevidst D3→D4 fra faldskærmen (D4-upkeep er 0). Fradraget gælder
  // alligevel, fordi et D3-anker i D4 stadig er en base holdet ikke er prissat til.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 4, signedDivision: 3, seasonNumber: 4 }),
    -12500
  );
});

// ── Aldrig et gæt ────────────────────────────────────────────────────────────
test("manglende eller ukendt division giver 0, aldrig et gæt", () => {
  const cases = [
    { currentDivision: null, signedDivision: 3 },
    { currentDivision: 1, signedDivision: null },
    { currentDivision: undefined, signedDivision: undefined },
    { currentDivision: 1, signedDivision: 99 },
    { currentDivision: "1", signedDivision: 3 },
    { currentDivision: 1.5, signedDivision: 3 },
  ];
  for (const c of cases) {
    assert.equal(
      computeDivisionAdjustment({ ...c, seasonNumber: 4 }),
      0,
      `${JSON.stringify(c)} burde give 0`
    );
  }
});

test("samme division giver 0", () => {
  for (const d of [1, 2, 3, 4]) {
    assert.equal(
      computeDivisionAdjustment({ currentDivision: d, signedDivision: d, seasonNumber: 4 }),
      0
    );
  }
});

// ── Bestyrelsens modifier (ejer-valg 4) ──────────────────────────────────────
test("modifieren ganges på præcis som den garanterede base", () => {
  assert.equal(applyModifierToAdjustment(130000, 1.0), 130000);
  assert.equal(applyModifierToAdjustment(130000, 1.15), 149500);
  assert.equal(applyModifierToAdjustment(130000, 0.8), 104000);
  // Negativt tillæg skaleres med samme fortegn-bevarende regel.
  assert.equal(applyModifierToAdjustment(-30000, 1.2), -36000);
  assert.equal(applyModifierToAdjustment(-30000, 0.8), -24000);
});

test("loftet guarder mod modifier-bypass i begge retninger", () => {
  const raw = 130000;
  const ceiling = Math.round(raw * MAX_BOARD_MODIFIER);
  assert.equal(applyModifierToAdjustment(raw, 5), ceiling);
  assert.equal(applyModifierToAdjustment(-raw, 5), -ceiling);
  // Med den faktiske satisfactionToModifier-top (1,20) er loftet en no-op.
  assert.equal(applyModifierToAdjustment(raw, MAX_BOARD_MODIFIER), ceiling);
});

test("0 og ugyldige input giver 0 uden at kaste", () => {
  assert.equal(applyModifierToAdjustment(0, 1.2), 0);
  assert.equal(applyModifierToAdjustment(null, 1.2), 0);
  assert.equal(applyModifierToAdjustment(NaN, 1.2), 0);
  // Ugyldig modifier falder til 1, ikke til 0 — et manglende board må ikke slette tillægget.
  assert.equal(applyModifierToAdjustment(130000, undefined), 130000);
});

// ── Kaldestedernes facade ────────────────────────────────────────────────────
test("resolveDivisionAdjustment samler team + kontrakt til ét svar", () => {
  const result = resolveDivisionAdjustment({
    team: { division: 1 },
    contract: { signed_division: 3 },
    seasonNumber: 3,
    modifier: 1.15,
  });
  assert.deepEqual(result, {
    raw: 130000,
    payout: 149500,
    currentDivision: 1,
    signedDivision: 3,
    applies: true,
  });
});

test("kontrakt uden signed_division giver applies=false — de 23 hold uden standing", () => {
  const result = resolveDivisionAdjustment({
    team: { division: 1 },
    contract: { signed_division: null },
    seasonNumber: 3,
    modifier: 1.2,
  });
  assert.equal(result.raw, 0);
  assert.equal(result.payout, 0);
  assert.equal(result.applies, false);
});

test("intet hold og ingen kontrakt kaster ikke", () => {
  const result = resolveDivisionAdjustment({});
  assert.equal(result.applies, false);
});

test("idempotency-nøglen er stabil og entydig pr. hold+sæson", () => {
  assert.equal(
    divisionAdjustmentIdempotencyKey("team-a", "season-1"),
    "division_adjustment:team-a:season-1"
  );
  assert.notEqual(
    divisionAdjustmentIdempotencyKey("team-a", "season-1"),
    divisionAdjustmentIdempotencyKey("team-a", "season-2")
  );
});
