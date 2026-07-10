// #2310 · Tests for de rene visnings-beregningsfunktioner bag Board S4-
// transparens-UX'et (bonustilbuds-afstand + lag-1 passiv-modifier-info).

import test from "node:test";
import assert from "node:assert/strict";

import { computeBonusOfferProgress, computePassiveModifierInfo } from "./boardTransparency.js";

// =====================================================================
// computeBonusOfferProgress
// =====================================================================

test("computeBonusOfferProgress: eligible when satisfaction > 75 and goals >= 75%", () => {
  const result = computeBonusOfferProgress({ satisfaction: 80, goalsMet: 3, goalsTotal: 4 });
  assert.equal(result.eligible, true);
  assert.equal(result.satisfaction_ok, true);
  assert.equal(result.goals_gap, 0);
  assert.equal(result.satisfaction_gap, 0);
});

test("computeBonusOfferProgress: not eligible below satisfaction threshold, reports gap", () => {
  const result = computeBonusOfferProgress({ satisfaction: 70, goalsMet: 4, goalsTotal: 4 });
  assert.equal(result.eligible, false);
  assert.equal(result.satisfaction_ok, false);
  assert.equal(result.satisfaction_gap, 6); // 75 - 70 + 1
});

test("computeBonusOfferProgress: satisfaction OK but goals short — reports goals_gap", () => {
  // total=4, threshold 75% => needs ceil(4*0.75)=3; met=1 => gap=2
  const result = computeBonusOfferProgress({ satisfaction: 80, goalsMet: 1, goalsTotal: 4 });
  assert.equal(result.eligible, false);
  assert.equal(result.goals_needed, 3);
  assert.equal(result.goals_gap, 2);
});

test("computeBonusOfferProgress: zero goals total is not eligible and has no crash", () => {
  const result = computeBonusOfferProgress({ satisfaction: 90, goalsMet: 0, goalsTotal: 0 });
  assert.equal(result.eligible, false);
  assert.equal(result.goals_needed, null);
  assert.equal(result.goals_gap, null);
});

test("computeBonusOfferProgress: handles missing/non-finite inputs gracefully", () => {
  const result = computeBonusOfferProgress({});
  assert.equal(result.eligible, false);
  assert.equal(result.goals_met, 0);
  assert.equal(result.goals_total, 0);
});

// =====================================================================
// computePassiveModifierInfo
// =====================================================================

test("computePassiveModifierInfo: strong boost band at high satisfaction", () => {
  const info = computePassiveModifierInfo({ satisfaction: 85, budget_modifier: 1.2 });
  assert.equal(info.band, "strong_boost");
  assert.equal(info.pct, 20);
});

test("computePassiveModifierInfo: strong penalty band at low satisfaction", () => {
  const info = computePassiveModifierInfo({ satisfaction: 10, budget_modifier: 0.8 });
  assert.equal(info.band, "strong_penalty");
  assert.equal(info.pct, -20);
});

test("computePassiveModifierInfo: neutral band around 50", () => {
  const info = computePassiveModifierInfo({ satisfaction: 50, budget_modifier: 1.0 });
  assert.equal(info.band, "neutral");
  assert.equal(info.pct, 0);
});

test("computePassiveModifierInfo: falls back to satisfactionToModifier when budget_modifier missing", () => {
  const info = computePassiveModifierInfo({ satisfaction: 65 });
  assert.equal(info.modifier, 1.10);
  assert.equal(info.band, "boost");
});

test("computePassiveModifierInfo: handles null board without throwing", () => {
  const info = computePassiveModifierInfo(null);
  assert.equal(info.satisfaction, 50);
  assert.equal(info.band, "neutral");
});
