import test from "node:test";
import assert from "node:assert/strict";

import {
  SALARY_BASIS, MARKET_BASE_FALLBACK, resolveMarketBase, marketBasisSalary,
  totalWageBill, calibrateAnchorSalary, costMultiplierForValueMultiple,
} from "./salaryBasis.js";
import { SALARY_MARKET_MODEL, SALARY_BASIS_MODE, SALARY_RATE_PROD } from "./economyConstants.js";

// De EKSAKTE tal for begge grundlag pinnes her (rene funktioner, mode-uafhængige).
// Kontrakt-mekanik-testene i contractSeed.test.js sammenligner i stedet mod
// computeFrozenSalary, så de ikke låser kalibreringen.

test("resolveMarketBase: market_value → base_value → fallback, med kilde-mærkat", () => {
  assert.deepEqual(resolveMarketBase({ market_value: 250_000, base_value: 9 }), { base: 250_000, source: "market_value" });
  assert.deepEqual(resolveMarketBase({ base_value: 42_000 }), { base: 42_000, source: "base_value" });
  assert.deepEqual(resolveMarketBase({ market_value: 0, base_value: null }), { base: MARKET_BASE_FALLBACK, source: "fallback" });
  assert.deepEqual(resolveMarketBase({}), { base: MARKET_BASE_FALLBACK, source: "fallback" });
  // Kilde-mærkatet er selve forward-guarden: et kaldested der rammer "fallback" på
  // en ejet rytter er en bug (#3389-fejlklassen), ikke en normalitet.
  assert.equal(resolveMarketBase({ current_production_value: 999_999 }).source, "fallback");
});

test("marketBasisSalary: kurven er pinnet mod anker + eksponent", () => {
  const m = { anchorValue: 100_000, anchorSalary: 15_000, exponent: 0.55, floor: 250, ceiling: null };
  // En rytter der er præcis anchorValue værd koster præcis anchorSalary.
  assert.equal(marketBasisSalary(100_000, m), 15_000);
  // Dobbelt værdi ⇒ 2^0.55 = 1,4641× løn.
  assert.equal(marketBasisSalary(200_000, m), Math.round(15_000 * Math.pow(2, 0.55)));
  // 10× værdi ⇒ 10^0.55 = 3,548× løn.
  assert.equal(marketBasisSalary(1_000_000, m), Math.round(15_000 * Math.pow(10, 0.55)));
  // Halv værdi ⇒ 0,683× løn.
  assert.equal(marketBasisSalary(50_000, m), Math.round(15_000 * Math.pow(0.5, 0.55)));
});

test("marketBasisSalary: monoton — en dyrere rytter koster ALTID mere (#3360's kerne)", () => {
  const m = SALARY_MARKET_MODEL;
  const values = [1_000, 8_600, 20_000, 30_000, 100_000, 180_000, 1_000_000, 5_000_000, 21_500_000];
  for (let i = 1; i < values.length; i++) {
    assert.ok(
      marketBasisSalary(values[i], m) > marketBasisSalary(values[i - 1], m),
      `${values[i]} skal koste mere end ${values[i - 1]}`,
    );
  }
});

test("marketBasisSalary: inversionen fra #3360 er væk", () => {
  // Målt prod 5/8: ≤21-gruppen er 180.024 CZ$ værd og betalte 1.273; 34+ er 20.347
  // værd og betalte 2.971 — det dyre aktiv var billigst. Det må ALDRIG kunne ske igen.
  const talent = marketBasisSalary(180_024, SALARY_MARKET_MODEL);
  const veteran = marketBasisSalary(20_347, SALARY_MARKET_MODEL);
  assert.ok(talent > veteran, `talent ${talent} skal koste mere end veteran ${veteran}`);
  // Og forholdet skal være dæmpet, ikke lineært: 8,8× værdi ⇒ langt under 8,8× løn.
  assert.ok(talent / veteran < 180_024 / 20_347, "kurven skal være konkav, ikke lineær");
});

test("marketBasisSalary: gulv og loft binder korrekt", () => {
  const m = { anchorValue: 100_000, anchorSalary: 15_000, exponent: 0.55, floor: 250, ceiling: null };
  assert.equal(marketBasisSalary(1, m), 250, "gulvet binder for en værdiløs rytter");
  assert.equal(marketBasisSalary(0, m), marketBasisSalary(MARKET_BASE_FALLBACK, m), "0/NaN → fallback-basen");
  const capped = { ...m, ceiling: 100_000 };
  assert.equal(marketBasisSalary(50_000_000, capped), 100_000, "loftet binder når det er sat");
});

test("marketBasisSalary: division-blind — modellen har ingen division-parameter", () => {
  // Bevidst designvalg (#3360): en rytter koster det samme uanset hvilket hold han
  // er på. Det der skiller hold ad er hvor meget værdi de EJER.
  assert.ok(!("byDiv" in SALARY_MARKET_MODEL), "markedsmodellen må ikke få per-division-satser");
  assert.ok(SALARY_RATE_PROD.byDiv, "production-grundlaget beholder sine per-division-satser (rollback-sti)");
});

test("calibrateAnchorSalary: rammer et mål-total og er monoton", () => {
  const values = [10_000, 50_000, 100_000, 500_000, 2_000_000];
  const base = { anchorValue: 100_000, exponent: 0.55, floor: 250, ceiling: null };
  const anchor = calibrateAnchorSalary(values, { ...base, targetTotal: 200_000 });
  const total = totalWageBill(values, { ...base, anchorSalary: anchor });
  assert.ok(Math.abs(total - 200_000) / 200_000 < 0.01, `total ${total} skal ramme 200.000 inden for 1 %`);
  // Højere anker ⇒ højere total (bisection forudsætter monotoni).
  assert.ok(
    totalWageBill(values, { ...base, anchorSalary: anchor * 2 }) > total,
    "wage bill skal vokse med ankeret",
  );
});

test("calibrateAnchorSalary: uopnåeligt mål under et loft → null", () => {
  const values = [10_000, 20_000];
  const base = { anchorValue: 100_000, exponent: 0.55, floor: 250, ceiling: 100 };
  assert.equal(calibrateAnchorSalary(values, { ...base, targetTotal: 1_000_000 }), null);
});

test("costMultiplierForValueMultiple: gør eksponenten læsbar", () => {
  assert.equal(costMultiplierForValueMultiple(1, 0.55), 1);
  assert.ok(Math.abs(costMultiplierForValueMultiple(100, 0.55) - 12.589) < 0.01);
  assert.equal(costMultiplierForValueMultiple(100, 1), 100, "eksponent 1 = lineær andel af værdien");
});

test("den aktive konfiguration er en gyldig mode", () => {
  assert.ok(Object.values(SALARY_BASIS).includes(SALARY_BASIS_MODE), `ukendt SALARY_BASIS_MODE: ${SALARY_BASIS_MODE}`);
  if (SALARY_BASIS_MODE === SALARY_BASIS.MARKET) {
    assert.ok(SALARY_MARKET_MODEL.exponent > 0 && SALARY_MARKET_MODEL.exponent < 1,
      "eksponenten skal ligge i (0,1): 1 = lineær (insolvent top), 0 = flad hovedskat");
    assert.ok(SALARY_MARKET_MODEL.anchorValue > 0 && SALARY_MARKET_MODEL.anchorSalary > 0);
  }
});
