// #4645 — regnestykket bag pris-forward-guarden (check-pro-prices.mjs), testet
// mod FIXTURE-data (ikke de ægte repo-filer — se scriptets filhoved for hvorfor:
// disse tests skal blive ved med at bevise regnestykket virker uanset om
// alunta-setup-plans.js's plankatalog/pro.json lige nu er i drift med hinanden.
// Kør `node scripts/check-pro-prices.mjs` for at tjekke de ÆGTE repo-filer.
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInclVatMajor,
  parseDisplayedAmount,
  checkPlanPrice,
  checkAllPrices,
  hasDrift,
  computeDiscountPct,
} from "./check-pro-prices.mjs";

// ── computeInclVatMajor — de fire priser fra #4645's spec ───────────────────

test("computeInclVatMajor: DKK 3920 øre ekskl. -> 49,00 kr. inkl.", () => {
  assert.equal(computeInclVatMajor(3920), 49);
});
test("computeInclVatMajor: DKK 21200 øre ekskl. -> 265,00 kr. inkl.", () => {
  assert.equal(computeInclVatMajor(21200), 265);
});
test("computeInclVatMajor: EUR 519 cent ekskl. -> 6,49 EUR inkl.", () => {
  assert.equal(computeInclVatMajor(519), 6.49);
});
test("computeInclVatMajor: EUR 2799 cent ekskl. -> 34,99 EUR inkl.", () => {
  assert.equal(computeInclVatMajor(2799), 34.99);
});

// ── parseDisplayedAmount ──────────────────────────────────────────────────────

test("parseDisplayedAmount: udtrækker ledende tal fra pro.json-strenge (EN+DA)", () => {
  assert.equal(parseDisplayedAmount("49 kr/mo"), 49);
  assert.equal(parseDisplayedAmount("49 kr/md"), 49);
  assert.equal(parseDisplayedAmount("265 kr"), 265);
});
test("parseDisplayedAmount: null/tomt -> null", () => {
  assert.equal(parseDisplayedAmount(null), null);
  assert.equal(parseDisplayedAmount(undefined), null);
  assert.equal(parseDisplayedAmount(""), null);
});

// ── checkPlanPrice ────────────────────────────────────────────────────────────

test("checkPlanPrice: selv-konsistent plan uden vist beløb", () => {
  const r = checkPlanPrice({ name: "CZ Pro 1 month", amount: 3920, inclVat: "49,00", currency: "DKK", interval: "monthly" });
  assert.equal(r.computed, 49);
  assert.equal(r.selfConsistent, true);
  assert.equal(r.displayMatch, null); // intet vist beløb givet
});

test("checkPlanPrice: katalog-inclVat afviger fra det reelt beregnede -> selfConsistent=false", () => {
  // #4645's dokumenterede regnefejl: 6 mdr. blev sat til 295 mens 23600 øre => 295 beregnet ER korrekt (23600*1,25/100=295) —
  // men et katalog der PÅSTÅR "265,00" ved 23600 øre er selv-inkonsistent.
  const r = checkPlanPrice({ name: "drift", amount: 23600, inclVat: "265,00", currency: "DKK", interval: "half-yearly" });
  assert.equal(r.computed, 295);
  assert.equal(r.selfConsistent, false);
});

test("checkPlanPrice: vist beløb matcher beregnet -> displayMatch=true", () => {
  const r = checkPlanPrice({ name: "CZ Pro 6 Months", amount: 21200, inclVat: "265,00", currency: "DKK", interval: "half-yearly" }, { displayedAmount: 265 });
  assert.equal(r.displayMatch, true);
});

test("checkPlanPrice: vist beløb AFVIGER fra beregnet -> displayMatch=false", () => {
  const r = checkPlanPrice({ name: "drift-plan", amount: 23600, inclVat: "295,00", currency: "DKK", interval: "half-yearly" }, { displayedAmount: 265 });
  assert.equal(r.computed, 295);
  assert.equal(r.displayMatch, false); // #4645's ægte 2/9-scenarie: 295 beregnet vs. 265 vist
});

// ── checkAllPrices / hasDrift — hele kataloget mod EN+DA pro.json (fixtures) ─

const GOOD_PLANS = [
  { name: "CZ Pro 1 month", amount: 3920, inclVat: "49,00", currency: "DKK", interval: "monthly" },
  { name: "CZ Pro 6 Months", amount: 21200, inclVat: "265,00", currency: "DKK", interval: "half-yearly" },
  { name: "CZ Pro 1 month EUR", amount: 519, inclVat: "6,49", currency: "EUR", interval: "monthly" },
  { name: "CZ Pro 6 Months EUR", amount: 2799, inclVat: "34,99", currency: "EUR", interval: "half-yearly" },
];
const GOOD_PRO_JSON = {
  en: { monthlyPrice: "49 kr/mo", semiannualPrice: "265 kr" },
  da: { monthlyPrice: "49 kr/md", semiannualPrice: "265 kr" },
};

test("checkAllPrices: fuldt sammenhængende katalog (DKK 3920->49, 21200->265; EUR 519->6,49, 2799->34,99) -> ingen drift", () => {
  const results = checkAllPrices({ plans: GOOD_PLANS, proJsonByLocale: GOOD_PRO_JSON });
  assert.equal(results.length, 4);
  assert.equal(hasDrift(results), false);
  const eurMonthly = results.find((r) => r.name === "CZ Pro 1 month EUR");
  assert.equal(eurMonthly.computed, 6.49);
  assert.equal(eurMonthly.displayedAmount, null); // pro.json viser ingen EUR-pris endnu — kun selv-konsistens tjekket
  assert.equal(eurMonthly.selfConsistent, true);
});

test("checkAllPrices: pro.json viser en anden pris end katalogets beregnede (2/9-scenariet) -> drift", () => {
  const driftedPlans = [{ name: "CZ Pro 6 Months", amount: 23600, inclVat: "295,00", currency: "DKK", interval: "half-yearly" }];
  const results = checkAllPrices({ plans: driftedPlans, proJsonByLocale: GOOD_PRO_JSON }); // pro.json viser stadig 265
  assert.equal(hasDrift(results), true);
  assert.equal(results[0].displayMatch, false);
});

test("checkAllPrices: EN og DA pro.json UENIGE om prisen -> drift (localeMismatches)", () => {
  const proJson = { en: { monthlyPrice: "49 kr/mo" }, da: { monthlyPrice: "61 kr/md" } };
  const plans = [{ name: "CZ Pro 1 month", amount: 3920, inclVat: "49,00", currency: "DKK", interval: "monthly" }];
  const results = checkAllPrices({ plans, proJsonByLocale: proJson });
  assert.equal(hasDrift(results), true);
  assert.ok(results[0].localeMismatches.length > 0);
});

// ── computeDiscountPct — rabat REGNES, håndskrives ikke (postmortem-læring) ──

test("computeDiscountPct: 6 mdr. a 265 mod 6x49=294 er en ~9.9% rabat (IKKE ~17%, den gamle regnefejl)", () => {
  const pct = computeDiscountPct({ monthsInPeriod: 6, periodPrice: 265, monthlyPrice: 49 });
  assert.ok(pct > 9 && pct < 11, `forventede ~10%, fik ${pct}%`);
});
test("computeDiscountPct: 6 x 49 = 294 (den dokumenterede regnefejl fra #4645's postmortem) -> 295 er DYRERE, negativ rabat", () => {
  const pct = computeDiscountPct({ monthsInPeriod: 6, periodPrice: 295, monthlyPrice: 49 });
  assert.ok(pct < 0, `295 kr. for 6 mdr. er dyrere end 6x49=294 kr. — forventede negativ rabat, fik ${pct}%`);
});
