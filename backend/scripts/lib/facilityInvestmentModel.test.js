import test from "node:test";
import assert from "node:assert/strict";
import { effectiveBonus, staffEffectFactor } from "../../lib/facilityEngine.js";
import { staffSalaryFor } from "../../lib/facilityConstants.js";
import { TIER_OVERALL_BAND } from "../../lib/staffAbilityConstants.js";
import {
  DEFAULT_MODEL_CONSTANTS, DEFAULT_LEVERAGE, STRATEGIES,
  PRIZE_ESTIMATE_BY_DIVISION, computeBonus, strengthValuePerSeason,
  simulateStrategy, runAntiOptimalPath, computeCommercialPayback, computePriceInSeasons,
  tierToOverall, staffObjOf, runSpecializationBalance,
} from "./facilityInvestmentModel.js";

// #2216 A4: tier → repræsentativt overall = midtpunktet af TIER_OVERALL_BAND[tier].
test("tierToOverall: midtpunkt af tier-kvalitets-båndet; null under tier 1", () => {
  for (const t of [1, 2, 3, 4, 5]) {
    const band = TIER_OVERALL_BAND[t];
    assert.equal(tierToOverall(t), Math.round((band.lo + band.hi) / 2));
  }
  assert.equal(tierToOverall(0), null);
  assert.equal(tierToOverall(null), null);
  // Monotont stigende (dyrere staff = højere kvalitet).
  const vals = [1, 2, 3, 4, 5].map(tierToOverall);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1]);
});

// Co-SSOT drift-guard: harnessets computeBonus (sweepbar effekt-tabel × prod-staff-faktor)
// skal matche prod-effectiveBonus på DEFAULT_MODEL_CONSTANTS (hvor constants.effect ===
// FACILITY_BASE_EFFECT). #2216 A4 flyttede prod til den ability-drevne staffEffectFactor
// (staff-OBJEKT med overall). Harnesset mapper sit integer-staff-tier → staff-objekt
// (staffObjOf) og kalder staffEffectFactor direkte. Guarden asserterer at den paritet
// holder mod prod-effectiveBonus PÅ NETOP DEN staff-objekt-sti (ikke den deprecerede
// integer-tier-adapter) — den sti alle prod-call-sites nu bruger.
test("computeBonus matcher prod-effectiveBonus på staff-objekt-stien (drift-guard)", () => {
  for (const [track, fac, staffTier] of [["training", 5, 5], ["training", 3, 1], ["commercial", 2, null], ["academy", 4, 2], ["scouting", 0, null]]) {
    const staffObj = staffObjOf(staffTier);
    assert.equal(computeBonus(DEFAULT_MODEL_CONSTANTS, track, fac, staffTier), effectiveBonus(track, fac, staffObj));
  }
});

// #2216 A4: løn-tabellen i modellen er nu RATING-drevet (staffSalaryFor(tier→overall)),
// co-SSOT med prod-kurven — ikke en flad tier-tabel.
test("staffSalary-cachen = prod staffSalaryFor(tierToOverall(tier)) (rating-drevet løn)", () => {
  for (const t of [1, 2, 3, 4, 5]) {
    assert.equal(DEFAULT_MODEL_CONSTANTS.staffSalary[t], staffSalaryFor(tierToOverall(t)));
  }
  // Monotont stigende løn (dyrere staff = højere løn).
  for (let t = 2; t <= 5; t++) assert.ok(DEFAULT_MODEL_CONSTANTS.staffSalary[t] > DEFAULT_MODEL_CONSTANTS.staffSalary[t - 1]);
});

// #2216 A4: specialiserings-balance-gate — generalist OG specialist konkurrencedygtige;
// ingen enkelt-specialisering dominerer.
test("runSpecializationBalance: generalist/specialist balanceret, symmetri mellem dimensioner", () => {
  const r = runSpecializationBalance({ division: 2 });
  assert.ok(Array.isArray(r.checks) && r.checks.length > 0);
  // Symmetri: de tre dim-specialister (matchede) inden for ±10% af hinanden.
  assert.ok(r.symmetryRatio >= 0.9, `symmetri ${r.symmetryRatio} < 0.9 — én dimension dominerer`);
  // Deterministisk (ren funktion, ingen tilfældighed).
  const r2 = runSpecializationBalance({ division: 2 });
  assert.deepEqual(r.checks, r2.checks);
});

test("strengthValuePerSeason: commercial i sponsor-kroner, training via leverage×præmie", () => {
  const c = DEFAULT_MODEL_CONSTANTS;
  // #2216 A4: staff-faktoren er nu ability-drevet — staff 5 → overall tierToOverall(5)
  // → staffEffectFactor, IKKE længere util 1.0. Vi ankrer mod prod-funktionen (co-SSOT).
  const factor5 = staffEffectFactor(staffObjOf(5));
  const factorNull = staffEffectFactor(null); // = gulv (rekalibreret 0.5)
  assert.equal(factorNull, 0.5);
  // commercial tier 5 + staff 5 i D1: 0.012 × factor5 × 600.000
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "commercial", 5, 5, 1), 0.012 * factor5 * 600000);
  // training tier 5 + staff 5 i D1: 0.165 × factor5 × leverage(3.0) × 160.000
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "training", 5, 5, 1), 0.165 * factor5 * 3.0 * 160000);
  // academy tier 2 uden staff: slots-effekt 2 × gulv-faktor (rekalibreret 0.5) × slotValue 900 = 900
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "academy", 2, null, 1), 2 * factorNull * 900);
  // intet bygget = 0
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "training", 0, null, 1), 0);
});

test("simulateStrategy: deterministisk, budget-begrænset, recurring-cap holdes", () => {
  const args = { priorities: STRATEGIES["training-first"], division: 2, seasons: 10 };
  const a = simulateStrategy(args);
  const b = simulateStrategy(args);
  assert.deepEqual(a, b); // ingen tilfældighed
  assert.ok(a.strength > 0);
  assert.ok(a.spent > 0);
  // recurring (upkeep+staff-løn) må aldrig overstige cap × sæson-budget
  assert.ok(a.recurring <= 0.5 * PRIZE_ESTIMATE_BY_DIVISION[2] + 1e-9);
});

test("simulateStrategy: D1-budget bygger mere end D3-budget over samme horisont", () => {
  const d1 = simulateStrategy({ priorities: STRATEGIES["balanced"], division: 1, seasons: 10 });
  const d3 = simulateStrategy({ priorities: STRATEGIES["balanced"], division: 3, seasons: 10 });
  assert.ok(d1.spent > d3.spent);
});

test("runAntiOptimalPath: returnerer alle strategier med competitive-markering mod max", () => {
  const r = runAntiOptimalPath({ division: 1, seasons: 10 });
  assert.equal(r.results.length, Object.keys(STRATEGIES).length);
  const max = Math.max(...r.results.map((x) => x.strength));
  for (const x of r.results) {
    assert.equal(x.competitive, x.strength >= 0.9 * max);
  }
  assert.equal(r.competitiveCount, r.results.filter((x) => x.competitive).length);
});

test("computeCommercialPayback: payback = pris/netto-marginal; Infinity ved netto ≤ 0", () => {
  // Syntetisk bundle hvor payback er trivielt at regne: tier 1 giver 10% af 100k sponsor = 10k/sæson,
  // 0 upkeep-delta, pris 30k → payback 3.0 sæsoner.
  const c = {
    ...DEFAULT_MODEL_CONSTANTS,
    price: { 1: 30000, 2: 60000, 3: 140000, 4: 300000, 5: 600000 },
    upkeep: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    effect: { ...DEFAULT_MODEL_CONSTANTS.effect, commercial: { 0: 0, 1: 0.10, 2: 0.10, 3: 0.10, 4: 0.10, 5: 0.10 } },
    sponsorBase: { 1: 100000, 2: 100000, 3: 100000 },
  };
  const r = computeCommercialPayback({ division: 1, constants: c });
  const tier1NoStaff = r.rows.find((x) => x.tier === 1 && x.staffMode === "none");
  // uden staff: gulv-faktor 0.5 (rekalibreret ejer-valg) → 0.10×0.5×100k = 5k/sæson → 30k/5k = 6.0
  assert.ok(Math.abs(tier1NoStaff.paybackSeasons - 6.0) < 1e-9);
  const tier2NoStaff = r.rows.find((x) => x.tier === 2 && x.staffMode === "none");
  assert.equal(tier2NoStaff.paybackSeasons, Infinity); // marginal effekt-delta = 0
  assert.equal(typeof r.minPayback, "number");
});

test("computePriceInSeasons: kumulativ pris / divisions-præmie", () => {
  const r = computePriceInSeasons({ constants: DEFAULT_MODEL_CONSTANTS });
  // kalibreret: tier 1 = 12.000; D3-præmie 25.000 → 0.48 sæson
  assert.equal(r.table.find((x) => x.tier === 1).seasons[3], 12000 / 25000);
  // tier 3 kumulativ = 12+26+50 = 88.000; D2 70.000 → ~1.26
  assert.ok(Math.abs(r.table.find((x) => x.tier === 3).seasons[2] - 88000 / 70000) < 1e-9);
  assert.ok(Array.isArray(r.gates));
  for (const g of r.gates) {
    assert.ok(["tier1_d3", "tier3cum_d2", "tier5cum_d1"].includes(g.key));
    assert.equal(typeof g.pass, "boolean");
  }
});
