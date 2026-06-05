// S-02d · Tests for de 7 nye mål-typer.
// Pattern: hver type får (a) evaluateGoal true-case, (b) evaluateGoal false-case,
// (c) evaluateGoalProgress status/score-shape, (d) buildGoalLabel + buildNegotiatedGoal.
// Plus integration: generateBoardGoals tilføjer 3 nye 5. mål til focus-pakkerne.

import test from "node:test";
import assert from "node:assert/strict";

import {
  GOAL_METADATA_BY_TYPE,
} from "./boardConstants.js";
import {
  buildGoalLabel,
  buildNegotiatedGoal,
  computeU25StatSum,
  evaluateGoal,
  evaluateGoalProgress,
  generateBoardGoals,
} from "./boardGoals.js";

// =====================================================================
// GOAL_METADATA_BY_TYPE — 7 nye entries
// =====================================================================

test("GOAL_METADATA_BY_TYPE has all 7 new S-02d goal types", () => {
  const NEW_TYPES = [
    "monument_podium",
    "jersey_wins",
    "signature_rider",
    "profitable_transfers",
    "u25_development_delta",
    "relative_rank",
    "domestic_dominance",
  ];
  for (const type of NEW_TYPES) {
    assert.ok(GOAL_METADATA_BY_TYPE[type], `${type} should exist in GOAL_METADATA_BY_TYPE`);
    assert.ok(GOAL_METADATA_BY_TYPE[type].category, `${type} should have category`);
    assert.ok(GOAL_METADATA_BY_TYPE[type].weight > 0, `${type} should have positive weight`);
  }
});

// =====================================================================
// 1. monument_podium — cumulative over plan-perioden
// =====================================================================

test("monument_podium evaluateGoal returns true when cumulative >= target", () => {
  const goal = { type: "monument_podium", target: 1, cumulative: true };
  const result = evaluateGoal(goal, null, { riders: [] }, {
    isFinalSeason: true,
    cumulativeMonumentPodiums: 2,
  });
  assert.equal(result, true);
});

test("monument_podium evaluateGoal returns false when cumulative < target", () => {
  const goal = { type: "monument_podium", target: 2, cumulative: true };
  const result = evaluateGoal(goal, null, { riders: [] }, {
    isFinalSeason: true,
    cumulativeMonumentPodiums: 1,
  });
  assert.equal(result, false);
});

test("monument_podium evaluateGoal returns null when cumulativeMonumentPodiums missing", () => {
  const goal = { type: "monument_podium", target: 1, cumulative: true };
  const result = evaluateGoal(goal, null, { riders: [] }, { isFinalSeason: true });
  assert.equal(result, null);
});

test("monument_podium evaluateGoalProgress reports ahead status when target met", () => {
  const goal = { type: "monument_podium", target: 1, cumulative: true };
  const progress = evaluateGoalProgress(goal, null, { riders: [] }, {
    isFinalSeason: true,
    cumulativeMonumentPodiums: 2,
    seasonsCompleted: 5,
    planDuration: 5,
  });
  assert.equal(progress.actual, 2);
  assert.equal(progress.status, "ahead");
});

// =====================================================================
// 2. jersey_wins — cumulative for 3yr/5yr, per-sæson for 1yr
// =====================================================================

test("jersey_wins evaluateGoal cumulative=true reads cumulativeJerseyWins", () => {
  const goal = { type: "jersey_wins", target: 3, cumulative: true };
  assert.equal(
    evaluateGoal(goal, null, {}, { cumulativeJerseyWins: 4 }),
    true,
  );
  assert.equal(
    evaluateGoal(goal, null, {}, { cumulativeJerseyWins: 2 }),
    false,
  );
});

test("jersey_wins evaluateGoal cumulative=false reads seasonJerseyWins", () => {
  const goal = { type: "jersey_wins", target: 2, cumulative: false };
  assert.equal(
    evaluateGoal(goal, null, {}, { seasonJerseyWins: 2 }),
    true,
  );
  assert.equal(
    evaluateGoal(goal, null, {}, { seasonJerseyWins: 1 }),
    false,
  );
});

// =====================================================================
// 3. signature_rider — popularity >= 75
// =====================================================================

test("signature_rider evaluateGoal counts riders with popularity >= 75", () => {
  const team = {
    riders: [
      { id: "a", popularity: 80 },
      { id: "b", popularity: 50 },
      { id: "c", popularity: 75 }, // præcis på threshold
    ],
  };
  const goal = { type: "signature_rider", target: 2 };
  assert.equal(evaluateGoal(goal, null, team, {}), true);
});

test("signature_rider evaluateGoal returns false when below threshold", () => {
  const team = {
    riders: [
      { id: "a", popularity: 70 },
      { id: "b", popularity: 60 },
    ],
  };
  const goal = { type: "signature_rider", target: 1 };
  assert.equal(evaluateGoal(goal, null, team, {}), false);
});

// =====================================================================
// 4. profitable_transfers — netto cumulative balance
// =====================================================================

test("profitable_transfers evaluateGoal returns true when balance >= target at season-end", () => {
  const goal = { type: "profitable_transfers", target: 200_000 };
  const result = evaluateGoal(goal, null, {}, {
    isFinalSeason: true,
    cumulativeTransferBalance: 250_000,
  });
  assert.equal(result, true);
});

test("profitable_transfers evaluateGoal returns false at season-end when below target", () => {
  const goal = { type: "profitable_transfers", target: 200_000 };
  const result = evaluateGoal(goal, null, {}, {
    isFinalSeason: true,
    cumulativeTransferBalance: 100_000,
  });
  assert.equal(result, false);
});

test("profitable_transfers evaluateGoal returns null mid-plan", () => {
  const goal = { type: "profitable_transfers", target: 200_000 };
  const result = evaluateGoal(goal, null, {}, {
    isFinalSeason: false,
    cumulativeTransferBalance: 250_000,
  });
  assert.equal(result, null);
});

// =====================================================================
// 5. u25_development_delta — gnsn. stat-points/sæson
// =====================================================================

test("computeU25StatSum sums stats for U25-riders only", () => {
  const STAT_FIELDS = {
    stat_fl: 10, stat_bj: 10, stat_kb: 10, stat_bk: 10, stat_tt: 10, stat_bro: 10,
    stat_sp: 10, stat_acc: 10, stat_udh: 10, stat_mod: 10, stat_res: 10, stat_ftr: 10,
  };
  const riders = [
    { is_u25: true, ...STAT_FIELDS },  // 12*10 = 120
    { is_u25: false, ...STAT_FIELDS }, // ignored
    { is_u25: true, ...STAT_FIELDS },  // 12*10 = 120
  ];
  assert.equal(computeU25StatSum(riders), 240);
});

test("u25_development_delta evaluateGoal returns true when delta >= target", () => {
  const goal = { type: "u25_development_delta", target: 3 };
  const STAT_FIELDS_LOW = {
    stat_fl: 60, stat_bj: 60, stat_kb: 60, stat_bk: 60, stat_tt: 60, stat_bro: 60,
    stat_sp: 60, stat_acc: 60, stat_udh: 60, stat_mod: 60, stat_res: 60, stat_ftr: 60,
  };
  // Plan-start: 1 rider × 60×12 = 720, current: same rider udviklet til 65 per stat → 65×12=780
  // delta_per_season = (780 − 720) / 1 = 60 → over target 3
  const team = {
    riders: [
      { is_u25: true, stat_fl: 65, stat_bj: 65, stat_kb: 65, stat_bk: 65, stat_tt: 65, stat_bro: 65, stat_sp: 65, stat_acc: 65, stat_udh: 65, stat_mod: 65, stat_res: 65, stat_ftr: 65 },
    ],
  };
  const result = evaluateGoal(goal, null, team, {
    isFinalSeason: true,
    planStartU25StatSum: 720,
    planStartU25Count: 1,
    seasonsCompleted: 1,
  });
  assert.equal(result, true);
  // Sanity: ignore variable
  void STAT_FIELDS_LOW;
});

test("u25_development_delta evaluateGoal returns false when delta < target", () => {
  const goal = { type: "u25_development_delta", target: 3 };
  // Plan-start avg: 60. Current: 1×61 + 11×60 = 721 → avg 60.08 → delta 0.08 → under 3
  const team = {
    riders: [
      { is_u25: true, stat_fl: 61, stat_bj: 60, stat_kb: 60, stat_bk: 60, stat_tt: 60, stat_bro: 60, stat_sp: 60, stat_acc: 60, stat_udh: 60, stat_mod: 60, stat_res: 60, stat_ftr: 60 },
    ],
  };
  const result = evaluateGoal(goal, null, team, {
    isFinalSeason: true,
    planStartU25StatSum: 720,
    planStartU25Count: 1,
    seasonsCompleted: 1,
  });
  assert.equal(result, false);
});

test("u25_development_delta evaluateGoal returns null when planStart-baseline missing", () => {
  const goal = { type: "u25_development_delta", target: 3 };
  const team = { riders: [{ is_u25: true, stat_fl: 70 }] };
  const result = evaluateGoal(goal, null, team, {
    isFinalSeason: true,
    planStartU25Count: 0,
  });
  assert.equal(result, null);
});

// =====================================================================
// 6. relative_rank — slut foran N andre managers i divisionen
// =====================================================================

test("relative_rank evaluateGoal returns true when beat-count >= target", () => {
  const goal = { type: "relative_rank", target: 3 };
  // 5 managers i division, jeg er rank 1 → jeg slog 4 → ≥ 3 OK
  const result = evaluateGoal(goal, { rank_in_division: 1 }, {}, {
    divisionManagerCount: 5,
  });
  assert.equal(result, true);
});

test("relative_rank evaluateGoal returns false when beat-count < target", () => {
  const goal = { type: "relative_rank", target: 3 };
  // 5 managers, jeg er rank 4 → jeg slog 1 → under 3
  const result = evaluateGoal(goal, { rank_in_division: 4 }, {}, {
    divisionManagerCount: 5,
  });
  assert.equal(result, false);
});

test("relative_rank evaluateGoal returns null when divisionManagerCount missing", () => {
  const goal = { type: "relative_rank", target: 3 };
  const result = evaluateGoal(goal, { rank_in_division: 1 }, {}, {});
  assert.equal(result, null);
});

// =====================================================================
// 7. domestic_dominance — skeleton (deferred til S-02g)
// =====================================================================

test("domestic_dominance evaluateGoal always returns null (skeleton)", () => {
  const goal = { type: "domestic_dominance", target: 2 };
  assert.equal(evaluateGoal(goal, null, {}, {}), null);
});

test("domestic_dominance evaluateGoalProgress reports awaiting_data status", () => {
  const goal = { type: "domestic_dominance", target: 2 };
  const progress = evaluateGoalProgress(goal, null, {}, {});
  assert.equal(progress.status, "awaiting_data");
  assert.equal(progress.missing_data, true);
});

// =====================================================================
// buildGoalLabel + buildNegotiatedGoal — alle 7 typer
// =====================================================================

test("buildGoalLabel produces non-empty Danish labels for all 7 new types", () => {
  const types = [
    { type: "monument_podium", target: 1, cumulative: false },
    { type: "monument_podium", target: 2, cumulative: true },
    { type: "jersey_wins", target: 2, cumulative: false },
    { type: "jersey_wins", target: 3, cumulative: true },
    { type: "signature_rider", target: 1 },
    { type: "profitable_transfers", target: 200_000 },
    { type: "u25_development_delta", target: 3 },
    { type: "relative_rank", target: 3 },
    { type: "domestic_dominance", target: 2 },
  ];
  for (const goal of types) {
    const label = buildGoalLabel(goal);
    assert.ok(typeof label === "string" && label.length > 0,
      `label for ${goal.type} (cumulative=${goal.cumulative}) should be non-empty, got: ${JSON.stringify(label)}`);
  }
});

test("buildNegotiatedGoal halves penalty + reduces target where possible", () => {
  // jersey_wins: target 3 → 2
  const jersey = buildNegotiatedGoal({
    type: "jersey_wins", target: 3, cumulative: true, satisfaction_penalty: 10,
  });
  assert.equal(jersey.target, 2);
  assert.equal(jersey.satisfaction_penalty, 5);
  assert.equal(jersey.negotiated, true);

  // signature_rider: target=1 minimum, kan ikke lempes
  const sig = buildNegotiatedGoal({
    type: "signature_rider", target: 1, satisfaction_penalty: 10,
  });
  assert.equal(sig.target, 1);
  assert.equal(sig.satisfaction_penalty, 5);

  // profitable_transfers: target 250K → 200K (-50K)
  const profit = buildNegotiatedGoal({
    type: "profitable_transfers", target: 250_000, satisfaction_penalty: 10,
  });
  assert.equal(profit.target, 200_000);

  // u25_development_delta: 3 → 2
  const u25 = buildNegotiatedGoal({
    type: "u25_development_delta", target: 3, satisfaction_penalty: 8,
  });
  assert.equal(u25.target, 2);

  // relative_rank: 3 → 2
  const rank = buildNegotiatedGoal({
    type: "relative_rank", target: 3, satisfaction_penalty: 8,
  });
  assert.equal(rank.target, 2);
});

// =====================================================================
// generateBoardGoals integration — 3 nye 5. mål
// =====================================================================

test("generateBoardGoals youth_development includes u25_development_delta as 5th goal (multi-year)", () => {
  const goals = generateBoardGoals({ focus: "youth_development", planType: "3yr" });
  assert.equal(goals.length, 5);
  const types = goals.map((g) => g.type);
  assert.ok(types.includes("u25_development_delta"),
    `youth_development (multi-year) should include u25_development_delta, got: ${types.join(",")}`);
});

// #57 · u25_development_delta kan aldrig evalueres på en 1yr-plan (kræver et
// plan-start-snapshot som baseline; 1yr = 1 sæson har aldrig et tidligere
// snapshot → altid awaiting_data) → ekskluderet fra 1yr-pakker.
test("#57 · generateBoardGoals youth_development 1yr ekskluderer u25_development_delta", () => {
  const goals = generateBoardGoals({ focus: "youth_development", planType: "1yr" });
  const types = goals.map((g) => g.type);
  assert.ok(!types.includes("u25_development_delta"),
    `1yr youth må ikke indeholde u25_development_delta, got: ${types.join(",")}`);
  assert.equal(goals.length, 4, "1yr youth = 4 mål (uden u25_development_delta)");
});

test("generateBoardGoals star_signing includes signature_rider as 5th goal", () => {
  const goals = generateBoardGoals({ focus: "star_signing", planType: "1yr" });
  assert.equal(goals.length, 5);
  const types = goals.map((g) => g.type);
  assert.ok(types.includes("signature_rider"),
    `star_signing should include signature_rider, got: ${types.join(",")}`);
});

test("generateBoardGoals balanced includes relative_rank as 5th goal", () => {
  const goals = generateBoardGoals({ focus: "balanced", planType: "1yr" });
  assert.equal(goals.length, 5);
  const types = goals.map((g) => g.type);
  assert.ok(types.includes("relative_rank"),
    `balanced should include relative_rank, got: ${types.join(",")}`);
});

test("generateBoardGoals new goals carry correct metadata category + weight", () => {
  const youth = generateBoardGoals({ focus: "youth_development", planType: "3yr" });
  const u25Delta = youth.find((g) => g.type === "u25_development_delta");
  assert.equal(u25Delta.category, "identity");

  const star = generateBoardGoals({ focus: "star_signing", planType: "1yr" });
  const sig = star.find((g) => g.type === "signature_rider");
  assert.equal(sig.category, "identity");

  const bal = generateBoardGoals({ focus: "balanced", planType: "1yr" });
  const rank = bal.find((g) => g.type === "relative_rank");
  assert.equal(rank.category, "ranking");
});
