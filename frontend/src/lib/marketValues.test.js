import { test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  computeBidValueDelta,
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

// #2464: bud-vurdering — delta mellem aktuelt bud og estimeret markedsværdi.
test("computeBidValueDelta — bud under vurdering", () => {
  assert.deepEqual(
    computeBidValueDelta(88000, { market_value: 100000 }),
    { pct: 12, direction: "under", value: 100000 },
  );
});

test("computeBidValueDelta — bud over vurdering", () => {
  assert.deepEqual(
    computeBidValueDelta(109000, { market_value: 100000 }),
    { pct: 9, direction: "over", value: 100000 },
  );
});

test("computeBidValueDelta — bud == vurdering → at (0%)", () => {
  assert.deepEqual(
    computeBidValueDelta(100000, { market_value: 100000 }),
    { pct: 0, direction: "at", value: 100000 },
  );
});

test("computeBidValueDelta — lille afvigelse afrundes til 0% → at", () => {
  // 100.400 mod 100.000 = 0,4% → afrundet 0 → "at", ikke en misvisende 0%-over.
  assert.deepEqual(
    computeBidValueDelta(100400, { market_value: 100000 }),
    { pct: 0, direction: "at", value: 100000 },
  );
});

test("computeBidValueDelta — manglende market_value bruger base_value-fallback", () => {
  // getRiderMarketValue: base_value + prize_earnings_bonus (#1101).
  assert.deepEqual(
    computeBidValueDelta(30000, { base_value: 50000, prize_earnings_bonus: 10000 }),
    { pct: 50, direction: "under", value: 60000 },
  );
});

test("computeBidValueDelta — helt værdiløst objekt falder til 1000-fallback", () => {
  assert.deepEqual(
    computeBidValueDelta(2000, {}),
    { pct: 100, direction: "over", value: 1000 },
  );
});

test("computeBidValueDelta — manglende rytter eller ugyldig pris → null", () => {
  assert.equal(computeBidValueDelta(50000, null), null);
  assert.equal(computeBidValueDelta(50000, undefined), null);
  assert.equal(computeBidValueDelta(null, { market_value: 100000 }), null);
  assert.equal(computeBidValueDelta("abc", { market_value: 100000 }), null);
});

test("computeBidValueDelta — bud 0 (ingen bud endnu) giver stadig delta", () => {
  assert.deepEqual(
    computeBidValueDelta(0, { market_value: 100000 }),
    { pct: 100, direction: "under", value: 100000 },
  );
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
