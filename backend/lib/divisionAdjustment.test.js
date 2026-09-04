import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DIVISION_ADJUSTMENT_FACTOR,
  FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT,
  DOWNWARD_ADJUSTMENT_ENABLED,
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

// Nedad-reglens formel er kun aktiv når ejeren har tændt flaget. Testene for nedad-formlen
// (symmetri med faldskærmen, fradrag) skal derfor selv slå den til lokalt uden at afhænge
// af flagets aktuelle default — de tester FORMLEN, ikke om ejeren har trykket på kontakten.
function computeDownwardForTest(args) {
  if (DOWNWARD_ADJUSTMENT_ENABLED) return computeDivisionAdjustment(args);
  // Flaget er slået fra (default) — regn formlen direkte for at teste den isoleret,
  // uden at antage hvordan `computeDivisionAdjustment` er kablet internt.
  const current = SPONSOR_INCOME_BY_DIVISION[args.currentDivision];
  const signed = SPONSOR_INCOME_BY_DIVISION[args.signedDivision];
  return Math.round(DIVISION_ADJUSTMENT_FACTOR * (current - signed));
}

// ── Den bærende invariant (nedad-reglen) ─────────────────────────────────────
// Nedad-reglens fradrag skal ophæve nedrykningsfaldskærmen eksakt for et nedrykket hold
// med løbende aftale — uafhængigt af om flaget er tændt. Divergerer PARACHUTE_FACTOR og
// DIVISION_ADJUSTMENT_FACTOR, begynder motoren at over- eller underkompensere uden at
// nogen anden test opdager det.
test("faktoren ER PARACHUTE_FACTOR — symmetrien er ikke en kommentar, den er en invariant", () => {
  assert.equal(DIVISION_ADJUSTMENT_FACTOR, PARACHUTE_FACTOR);
});

test("nedad-formlens fradrag og faldskærm ophæver hinanden eksakt ved nedrykning med løbende aftale", () => {
  for (const [oldDiv, newDiv] of [[1, 2], [2, 3]]) {
    const parachute = Math.round(
      PARACHUTE_FACTOR *
        (SPONSOR_INCOME_BY_DIVISION[oldDiv] - SPONSOR_INCOME_BY_DIVISION[newDiv])
    );
    const adjustment = computeDownwardForTest({ currentDivision: newDiv, signedDivision: oldDiv });
    assert.equal(parachute + adjustment, 0, `D${oldDiv}→D${newDiv} går ikke i nul`);
  }
});

// ── Oprykning — "gulv + 50 %" (ejer-beslutning 4/9, erstatter ren 50 % af hele forskellen) ──
// korrektion = max(0, base[D−1] − base[prissat]) + 0,5 × (base[D] − base[D−1])
test("ét-trins oprykning: gulvet er 0, uændret 50 % af hele forskellen", () => {
  // D1 med D2-aftale: D−1 for D1 ER D2 (den prissatte division), så gulvet er 0.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 2, seasonNumber: 3 }),
    100000
  );
  // D3 med D4-aftale: D−1 for D3 ER D4, gulvet er 0.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 3, signedDivision: 4, seasonNumber: 3 }),
    12500
  );
});

test("fler-trins oprykning: gulv til D−1 plus 50 % af det sidste trin", () => {
  // D1 med D4-aftale: gulv til D2 = 400.000 − 315.000 = 85.000, plus 0,5 × (600.000 −
  // 400.000) = 100.000 → 185.000. Ejer-eksempel 4/9: 315.000 + 185.000 = 500.000.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 4, seasonNumber: 3 }),
    185000
  );
  // D2 med D4-aftale: gulv til D3 = 340.000 − 315.000 = 25.000, plus 0,5 × (400.000 −
  // 340.000) = 30.000 → 55.000. Ejer-eksempel 4/9: 315.000 + 55.000 = 370.000.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 2, signedDivision: 4, seasonNumber: 3 }),
    55000
  );
});

// ── Overgangsreglen for S3 (ejer-valg 5) + flaget (ejer-beslutning 4/9) ──────────────
test("nedadgående korrektion er slået fra som default (flag), opadgående er ikke", () => {
  const down = { currentDivision: 3, signedDivision: 2 };
  assert.equal(computeDivisionAdjustment({ ...down, seasonNumber: 3 }), 0);
  // Flaget er FALSE som default, så nedad forbliver 0 selv fra sæson 4, indtil ejeren
  // eksplicit sætter DOWNWARD_ADJUSTMENT_ENABLED til true.
  assert.equal(computeDivisionAdjustment({ ...down, seasonNumber: 4 }), DOWNWARD_ADJUSTMENT_ENABLED ? -30000 : 0);
  assert.equal(computeDivisionAdjustment({ ...down, seasonNumber: 5 }), DOWNWARD_ADJUSTMENT_ENABLED ? -30000 : 0);

  // Oprykning rammes ALDRIG af overgangsreglen eller flaget — heller ikke i sæson 1.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 1, signedDivision: 3, seasonNumber: 1 }),
    160000 // gulv til D2 = 60.000, plus 0,5 × 200.000 = 100.000
  );
});

test("D3→D4 giver fradrag KUN når flaget er tændt, fra sæson 4", () => {
  // #1980 ekskluderer bevidst D3→D4 fra faldskærmen (D4-upkeep er 0). Fradraget ville
  // gælde alligevel, fordi et D3-anker i D4 stadig er en base holdet ikke er prissat til
  // — men kun når ejeren har slået nedad-flaget til.
  const result = computeDivisionAdjustment({ currentDivision: 4, signedDivision: 3, seasonNumber: 4 });
  assert.equal(result, DOWNWARD_ADJUSTMENT_ENABLED ? -12500 : 0);
});

test("D4 kan aldrig modtage en opadgående korrektion (ingen division er billigere)", () => {
  // D4 er selv bunden — der findes ingen division hvis base er lavere, så signed < current
  // (opad-grenen) kan aldrig rammes med currentDivision = 4.
  assert.equal(
    computeDivisionAdjustment({ currentDivision: 4, signedDivision: 4, seasonNumber: 4 }),
    0
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
  // Gulv til D2 = 400.000 − 340.000 = 60.000, plus 0,5 × (600.000 − 400.000) = 100.000 → 160.000.
  assert.deepEqual(result, {
    raw: 160000,
    payout: 184000,
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
