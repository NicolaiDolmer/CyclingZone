import test from "node:test";
import assert from "node:assert/strict";
import { effectiveBonus } from "../../lib/facilityEngine.js";
import {
  DEFAULT_MODEL_CONSTANTS, DEFAULT_LEVERAGE, STRATEGIES,
  PRIZE_ESTIMATE_BY_DIVISION, computeBonus, strengthValuePerSeason,
  simulateStrategy, runAntiOptimalPath, computeCommercialPayback, computePriceInSeasons,
} from "./facilityInvestmentModel.js";

test("computeBonus matcher prod-effectiveBonus på prod-konstanterne (drift-guard)", () => {
  for (const [track, fac, staff] of [["training", 5, 5], ["training", 3, 1], ["commercial", 2, null], ["academy", 4, 2], ["scouting", 0, null]]) {
    assert.equal(computeBonus(DEFAULT_MODEL_CONSTANTS, track, fac, staff), effectiveBonus(track, fac, staff));
  }
});

test("strengthValuePerSeason: commercial i sponsor-kroner, training via leverage×præmie", () => {
  const c = DEFAULT_MODEL_CONSTANTS;
  // commercial tier 5 + staff 5 i D1: 0.012 × 1.0 × 600.000 = 7.200
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "commercial", 5, 5, 1), 0.012 * 600000);
  // training tier 5 + staff 5 i D1: 0.165 × 1.0 × leverage(3.0) × 160.000 = 79.200
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "training", 5, 5, 1), 0.165 * 3.0 * 160000);
  // academy tier 2 uden staff: slots-effekt 2 × util 0.5 × slotValue 900 = 900
  assert.equal(strengthValuePerSeason(c, DEFAULT_LEVERAGE, "academy", 2, null, 1), 2 * 0.5 * 900);
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
  // uden staff: util 0.5 → 5k/sæson → 30k/5k = 6.0
  assert.equal(tier1NoStaff.paybackSeasons, 6);
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
