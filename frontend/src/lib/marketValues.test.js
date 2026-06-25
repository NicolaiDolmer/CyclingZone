import { test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  formatCz,
  getRiderMarketValue,
  getRiderSalary,
  salaryBoundToValueBound,
} from "./marketValues.js";

async function setLanguage(language) {
  if (!i18n.isInitialized) {
    await i18n.init({
      lng: language,
      fallbackLng: "en",
      resources: {},
      initImmediate: false,
    });
    return;
  }

  await i18n.changeLanguage(language);
}

test("formatCz — følger engelsk tusindseparator", async () => {
  await setLanguage("en");

  assert.equal(formatCz(1234567), "1,234,567 CZ$");
});

test("formatCz — følger dansk tusindseparator", async () => {
  await setLanguage("da");

  assert.equal(formatCz(1234567), "1.234.567 CZ$");
});

test("formatCz — ugyldig værdi bevarer fallback", async () => {
  await setLanguage("en");

  assert.equal(formatCz(null), "-");
  assert.equal(formatCz("ikke-et-tal"), "-");
});

// #1101 cutover: DB-kolonnen market_value er sandheden; fallback = base_value + bonus.
test("getRiderMarketValue — market_value vinder", () => {
  assert.equal(
    getRiderMarketValue({ market_value: 900000, base_value: 100, prize_earnings_bonus: 50000 }),
    900000,
  );
});

test("getRiderMarketValue — base_value + bonus som fallback", () => {
  assert.equal(
    getRiderMarketValue({ base_value: 50000, prize_earnings_bonus: 15000 }),
    65000,
  );
});

test("getRiderMarketValue — uci_points indgår aldrig", () => {
  assert.equal(getRiderMarketValue({ uci_points: 500 }), 1000);
});

// #1309: frossen kontrakt-løn vinder; ellers estimat (6.7% af market_value, E2 strict_fair_v1).
test("getRiderSalary — frossen salary vinder over estimat", () => {
  assert.equal(getRiderSalary({ salary: 12345, base_value: 1000000 }), 12345);
});

test("getRiderSalary — NULL salary → 6.7% af market_value", () => {
  assert.equal(getRiderSalary({ salary: null, market_value: 500000 }), 33500);
  assert.equal(getRiderSalary({ salary: null, base_value: 50000, prize_earnings_bonus: 5000 }), 3685);
});

test("getRiderSalary — salary 0 bevares (gratis kontrakt)", () => {
  assert.equal(getRiderSalary({ salary: 0, base_value: 1000000 }), 0);
});

test("getRiderSalary — NULL salary + NULL base_value → fallback 1000 → 67", () => {
  assert.equal(getRiderSalary({ salary: null, base_value: null }), 67);
  assert.equal(getRiderSalary({}), 67);
});

// #1827: løn-grænse → market_value-grænse (invers af SALARY_RATE 0.067) til
// estimat-grenen i server-filteret. Holder filteret konsistent med getRiderSalary
// for de ~785 free agents (i prod 25/6) der har salary == NULL.
test("salaryBoundToValueBound — invers af SALARY_RATE", () => {
  // round(5000 / 0.067) = round(74626.86) = 74627 (matcher prod-validering #1827)
  assert.equal(salaryBoundToValueBound(5000), 74627);
  assert.equal(salaryBoundToValueBound("5000"), 74627);
  assert.equal(salaryBoundToValueBound(0), 0);
});

test("salaryBoundToValueBound — ikke-sat grænse → null (springes over)", () => {
  assert.equal(salaryBoundToValueBound(""), null);
  assert.equal(salaryBoundToValueBound(undefined), null);
  assert.equal(salaryBoundToValueBound(null), null);
  assert.equal(salaryBoundToValueBound("abc"), null);
});

// En estimeret løn ≈ getRiderSalary skal lande inden for grænsen når market_value
// ≤ value-bound — round-trip-konsistens mellem filter og visning.
test("salaryBoundToValueBound — round-trip mod getRiderSalary", () => {
  const maxSalary = 5000;
  const valueBound = salaryBoundToValueBound(maxSalary); // 74627
  // En free agent lige under value-grænsen har en vist løn ≤ max (med afrunding).
  const riderAtBound = { salary: null, market_value: valueBound };
  assert.ok(getRiderSalary(riderAtBound) <= maxSalary + 1);
  // En free agent over value-grænsen har en vist løn > max.
  const riderAbove = { salary: null, market_value: valueBound + 20000 };
  assert.ok(getRiderSalary(riderAbove) > maxSalary);
});
