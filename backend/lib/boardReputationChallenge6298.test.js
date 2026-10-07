import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGoal, evaluateGoalProgress } from "./boardGoals.js";
import { calculateBoardPerformance } from "./boardEvaluation.js";

// #6298 · Spiller: efter omdoemme-opdateringen har holdet flere ryttere med
// omdoemme, men bestyrelsens udfordring taeller stadig kun een. Aarsag: maal
// aftalt foer omdoemme blev synligt har ingen star_score_basis og taeltes kun
// paa den gamle score.

// Gammel score: popularity*0.7 + uci*0.3. Hoejt omdoemme men ingen UCI-point
// og lav popularity giver en lav gammel score, men en stjerne paa omdoemme.
const reputationRider = (id) => ({ id, popularity: 20, reputation: 82, uci_points: 0 });
const legacyRider = { id: "legacy", popularity: 60, reputation: 10, uci_points: 500 };

const OLD_GOAL = { type: "signature_rider", target: 3 };
const ctx = { reputationEnabled: true };

test("#6298 · aeldre maal uden basis taeller flere omdoemme-ryttere", () => {
  const team = { riders: [legacyRider, reputationRider("r1"), reputationRider("r2")] };
  assert.equal(evaluateGoalProgress(OLD_GOAL, null, team, ctx).actual, 3);
  assert.equal(evaluateGoal(OLD_GOAL, null, team, ctx), true);
});

test("#6298 · aeldre maal taeller kun omdoemme-ryttere naar omdoemme er slaaet fra", () => {
  const team = { riders: [legacyRider, reputationRider("r1"), reputationRider("r2")] };
  assert.equal(evaluateGoalProgress(OLD_GOAL, null, team, { reputationEnabled: false }).actual, 1);
  assert.equal(evaluateGoal(OLD_GOAL, null, team, {}), false);
});

test("#6298 · en rytter der taeller paa begge scorer taelles kun een gang", () => {
  const both = { id: "both", popularity: 90, reputation: 90, uci_points: 900 };
  const team = { riders: [both] };
  assert.equal(evaluateGoalProgress(OLD_GOAL, null, team, ctx).actual, 1);
});

test("#6298 · maal med omdoemme-basis er uaendret og taeller kun omdoemme", () => {
  const goal = { ...OLD_GOAL, star_score_basis: "reputation" };
  const team = { riders: [legacyRider, reputationRider("r1"), reputationRider("r2")] };
  assert.equal(evaluateGoalProgress(goal, null, team, ctx).actual, 2);
});

test("#6298 · bonus-maal med baseline holdes paa den gamle score", () => {
  const goal = { type: "signature_rider", target: 1, baseline: 1 };
  const team = { riders: [legacyRider, reputationRider("r1")] };
  // baseline blev talt paa den gamle score: omdoemme-rytteren maa ikke tælle som ny fremgang
  assert.equal(evaluateGoalProgress(goal, null, team, ctx).actual, 0);
  assert.equal(evaluateGoal(goal, null, team, ctx), false);
});

test("#6298 · bestyrelsens evaluering viser samme antal som maalets fremgang", () => {
  const team = { riders: [legacyRider, reputationRider("r1"), reputationRider("r2")] };
  const board = { current_goals: [{ ...OLD_GOAL }], focus: "star_signing", plan_type: "1yr", satisfaction: 50 };
  const perf = calculateBoardPerformance({ board, standing: null, team, context: ctx });
  const evaluation = perf.goalEvaluations.find((e) => e.type === "signature_rider" || e.goal?.type === "signature_rider") ?? perf.goalEvaluations[0];
  assert.equal(evaluation.actual, 3);
  assert.equal(perf.identityProfile.star_profile.star_rider_count, 2);
});
