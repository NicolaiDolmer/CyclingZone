import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DKK_PER_EUR,
  DAYS_PER_MONTH,
  SUPPORTER_ANNUAL_MONTHS,
  TIER_PRICES_DKK,
  DEFAULT_VARIANT,
  getTierPricesDkk,
  dkkToEur,
  monthlyInCurrency,
  perDayOf,
  annualOf,
  eurLabel,
} from "./pricing.js";

// ---------- konstanter ----------
test("konstanter — fast kurs + divisorer er de dokumenterede værdier", () => {
  assert.equal(DKK_PER_EUR, 7.46);
  assert.equal(DAYS_PER_MONTH, 30);
  assert.equal(SUPPORTER_ANNUAL_MONTHS, 10);
  assert.equal(DEFAULT_VARIANT, "B");
});

test("TIER_PRICES_DKK — alle varianter har alle 4 tiers; Patron/free konstante", () => {
  for (const key of ["A", "B", "C"]) {
    const p = TIER_PRICES_DKK[key];
    assert.deepEqual(Object.keys(p).sort(), ["free", "patron", "pro", "supporter"]);
    assert.equal(p.free, 0);
    assert.equal(p.patron, 149);
  }
  // Locked default-priser (variant B): Premium 49 / Pro Analyst 89.
  assert.equal(TIER_PRICES_DKK.B.supporter, 49);
  assert.equal(TIER_PRICES_DKK.B.pro, 89);
});

// ---------- getTierPricesDkk ----------
test("getTierPricesDkk — kendt variant returneres, case-insensitivt", () => {
  assert.equal(getTierPricesDkk("A").supporter, 29);
  assert.equal(getTierPricesDkk("a").supporter, 29);
  assert.equal(getTierPricesDkk("C").pro, 119);
});

test("getTierPricesDkk — ukendt/tom variant falder tilbage til default (B)", () => {
  assert.deepEqual(getTierPricesDkk(""), TIER_PRICES_DKK.B);
  assert.deepEqual(getTierPricesDkk(null), TIER_PRICES_DKK.B);
  assert.deepEqual(getTierPricesDkk("X"), TIER_PRICES_DKK.B);
  assert.deepEqual(getTierPricesDkk(undefined), TIER_PRICES_DKK.B);
});

// ---------- dkkToEur (verificerede tal, kurs 7.46, 2 decimaler) ----------
test("dkkToEur — alle tier-priser konverterer til de verificerede beløb", () => {
  assert.equal(dkkToEur(0), 0);
  assert.equal(dkkToEur(29), 3.89); // 29 / 7.46 = 3.8874
  assert.equal(dkkToEur(49), 6.57); // 49 / 7.46 = 6.5684
  assert.equal(dkkToEur(69), 9.25); // 69 / 7.46 = 9.2493
  assert.equal(dkkToEur(89), 11.93); // 89 / 7.46 = 11.9303
  assert.equal(dkkToEur(119), 15.95); // 119 / 7.46 = 15.9517
  assert.equal(dkkToEur(149), 19.97); // 149 / 7.46 = 19.9732
});

test("dkkToEur — ugyldigt input giver null", () => {
  assert.equal(dkkToEur(null), null);
  assert.equal(dkkToEur(undefined), null);
  assert.equal(dkkToEur(NaN), null);
  assert.equal(dkkToEur("49"), null);
});

// ---------- monthlyInCurrency ----------
test("monthlyInCurrency — DKK er as-is, EUR konverteres", () => {
  assert.equal(monthlyInCurrency(49, "DKK"), 49);
  assert.equal(monthlyInCurrency(49, "EUR"), 6.57);
  assert.equal(monthlyInCurrency(0, "EUR"), 0);
  assert.equal(monthlyInCurrency(null, "EUR"), null);
});

// ---------- perDayOf (månedsbeløb / 30, 2 decimaler) ----------
test("perDayOf — DKK-månedspriser", () => {
  assert.equal(perDayOf(49), 1.63); // 49 / 30 = 1.6333
  assert.equal(perDayOf(89), 2.97); // 89 / 30 = 2.9667
  assert.equal(perDayOf(149), 4.97); // 149 / 30 = 4.9667
  assert.equal(perDayOf(0), 0);
});

test("perDayOf — EUR-månedsbeløb (afledt af det viste tal)", () => {
  assert.equal(perDayOf(6.57), 0.22); // Premium B
  assert.equal(perDayOf(11.93), 0.4); // Pro Analyst B
  assert.equal(perDayOf(19.97), 0.67); // Patron
});

test("perDayOf — ugyldigt input giver null", () => {
  assert.equal(perDayOf(null), null);
  assert.equal(perDayOf(NaN), null);
});

// ---------- annualOf ----------
test("annualOf — 10 x månedsbeløbet i samme valuta", () => {
  assert.equal(annualOf(49), 490);
  assert.equal(annualOf(6.57), 65.7);
  assert.equal(annualOf(null), null);
});

// ---------- eurLabel ----------
test("eurLabel — fast 2-decimals euro-streng til statisk copy", () => {
  assert.equal(eurLabel(49), "€6.57");
  assert.equal(eurLabel(89), "€11.93");
  assert.equal(eurLabel(null), "");
});
