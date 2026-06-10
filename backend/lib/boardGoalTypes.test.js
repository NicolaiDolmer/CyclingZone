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
  countGoalsMet,
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

test("computeU25StatSum prefers joined abilities over PCM-stats (#1137)", () => {
  const FIFTEEN_ABILITIES = {
    climbing: 4, time_trial: 4, prolog: 4, flat: 4, tempo: 4, sprint: 4, acceleration: 4,
    punch: 4, endurance: 4, recovery: 4, durability: 4, descending: 4, cobblestone: 4, positioning: 4, aggression: 4,
  };
  const riders = [
    // U25 med abilities-join → summer 15 abilities (15*4=60), ignorér de høje stats
    { is_u25: true, stat_fl: 99, stat_bj: 99, rider_derived_abilities: FIFTEEN_ABILITIES },
    // U25 uden join → fallback til 12 stats (12*10=120)
    {
      is_u25: true, stat_fl: 10, stat_bj: 10, stat_kb: 10, stat_bk: 10, stat_tt: 10, stat_bro: 10,
      stat_sp: 10, stat_acc: 10, stat_udh: 10, stat_mod: 10, stat_res: 10, stat_ftr: 10,
    },
  ];
  assert.equal(computeU25StatSum(riders), 60 + 120);
});

test("computeU25StatSum handles PostgREST array-embed of abilities (#1137)", () => {
  const riders = [{ is_u25: true, rider_derived_abilities: [{ climbing: 10, sprint: 5 }] }];
  assert.equal(computeU25StatSum(riders), 15);
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
// #1234 · No-op-rabat: mål uden reel lempelse kan ikke forhandles
// =====================================================================

test("#1234 · buildNegotiatedGoal returns null when target cannot genuinely be relaxed", () => {
  // Binært mål — target=0 er absolut minimum
  assert.equal(buildNegotiatedGoal({
    type: "no_outstanding_debt", target: 0, satisfaction_penalty: 8,
  }), null);

  // Minimums-mål på target=1 — relax-formlen rammer sit gulv
  assert.equal(buildNegotiatedGoal({
    type: "monument_podium", target: 1, cumulative: true, satisfaction_penalty: 12,
  }), null);
  assert.equal(buildNegotiatedGoal({
    type: "signature_rider", target: 1, satisfaction_penalty: 10,
  }), null);

  // Alle typer hvis floor allerede er nået
  assert.equal(buildNegotiatedGoal({
    type: "stage_wins", target: 1, satisfaction_penalty: 5,
  }), null);
  assert.equal(buildNegotiatedGoal({
    type: "gc_wins", target: 1, satisfaction_penalty: 10,
  }), null);
  assert.equal(buildNegotiatedGoal({
    type: "sponsor_growth", target: 5, satisfaction_penalty: 10,
  }), null);
  assert.equal(buildNegotiatedGoal({
    type: "min_riders", target: 5, min_target: 5, satisfaction_penalty: 10,
  }), null);
  assert.equal(buildNegotiatedGoal({
    type: "profitable_transfers", target: 50_000, satisfaction_penalty: 10,
  }), null);

  // Ukendte typer kan heller ikke forhandles
  assert.equal(buildNegotiatedGoal({
    type: "future_unknown_type", target: 3, satisfaction_penalty: 10,
  }), null);
});

test("#1234 · monument_podium and signature_rider with target > 1 relax on target", () => {
  const monument = buildNegotiatedGoal({
    type: "monument_podium", target: 2, cumulative: true, satisfaction_penalty: 12,
  });
  assert.equal(monument.target, 1);
  assert.equal(monument.satisfaction_penalty, 6);
  assert.equal(monument.negotiated, true);

  const sig = buildNegotiatedGoal({
    type: "signature_rider", target: 2, satisfaction_penalty: 10,
  });
  assert.equal(sig.target, 1);
  assert.equal(sig.satisfaction_penalty, 5);
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

// =====================================================================
// #1074 · countGoalsMet medregner opfyldte cumulative stage/gc-mål
// (før: altid ekskluderet → goals_met/goals_total kunne aldrig nå 100% for
// multi-year-planer → bonus-offer matematisk umulig).
// =====================================================================

test("#1074 · opfyldte cumulative stage/gc-mål tæller med i countGoalsMet", () => {
  const goals = [
    { type: "stage_wins", target: 6, cumulative: true },
    { type: "gc_wins", target: 2, cumulative: true },
    { type: "top_n_finish", target: 3 },
  ];
  const standing = { rank_in_division: 2 };
  // Alle mål opfyldt → ratio kan nå 100% (bonus-offer-eligibility mulig).
  assert.equal(
    countGoalsMet(goals, standing, null, { cumulativeStats: { stageWins: 6, gcWins: 2 } }),
    3,
    "2 cumulative + 1 ranking opfyldt"
  );
  // Cumulative ikke nået → tæller ikke (men over-tæller heller ikke).
  assert.equal(
    countGoalsMet(goals, standing, null, { cumulativeStats: { stageWins: 3, gcWins: 0 } }),
    1,
    "kun top_n_finish opfyldt"
  );
  // Uden cumulativeStats → cumulative tæller som ikke-opfyldt (graceful).
  assert.equal(countGoalsMet(goals, standing, null, {}), 1);
});

// =====================================================================
// #55 · evaluateGoalProgress.met — autoritativt "opnået"-flag (fuldt mål).
// Forward-guard: `met` MÅ ikke følge den pro-ratede `status` ("ahead") midt-i-
// plan for cumulative/multi-year-typer, ellers over-tæller BoardPage opnåede mål.
// =====================================================================

test("#55 · monument_podium: status pro-rates midt-i-plan men met kræver fuldt mål", () => {
  const goal = { type: "monument_podium", target: 4 };
  // 5yr-plan, sæson 1: pro-rated target = max(1, ceil(4*1/5)) = 1.
  const onPace = evaluateGoalProgress(goal, null, null, {
    planDuration: 5, seasonsCompleted: 1, cumulativeMonumentPodiums: 1,
  });
  assert.equal(onPace.status, "ahead", "1 podie møder det pro-ratede mål → status ahead");
  assert.equal(onPace.met, false, "men det fulde mål (4) er IKKE nået → met false");

  const fullyMet = evaluateGoalProgress(goal, null, null, {
    planDuration: 5, seasonsCompleted: 1, cumulativeMonumentPodiums: 4,
  });
  assert.equal(fullyMet.met, true, "4 podier = fuldt mål → met true");
});

test("#55 · profitable_transfers: defer-til-final i status, men met = fuldt mål nået", () => {
  const goal = { type: "profitable_transfers", target: 200000 };
  // Mid-plan: evaluateGoal defererer (null) → met false; status pro-rates ikke til ahead.
  const midNotMet = evaluateGoalProgress(goal, null, null, {
    planDuration: 3, seasonsCompleted: 1, cumulativeTransferBalance: 50000,
  });
  assert.equal(midNotMet.met, false);
  // Fuldt mål allerede nået tidligt → met true (evaluateGoal med isFinalSeason).
  const earlyMet = evaluateGoalProgress(goal, null, null, {
    planDuration: 3, seasonsCompleted: 1, cumulativeTransferBalance: 250000,
  });
  assert.equal(earlyMet.met, true);
});

test("#55 · legacy non-cumulative type: met = nuværende tilstand møder målet", () => {
  const goal = { type: "top_n_finish", target: 3 };
  assert.equal(evaluateGoalProgress(goal, { rank_in_division: 2 }, null, {}).met, true);
  assert.equal(evaluateGoalProgress(goal, { rank_in_division: 5 }, null, {}).met, false);
});

test("#55 · relative_rank (early-return case) bærer met-flaget", () => {
  // relative_rank har en tidlig return i evaluateGoalProgress (rich payload) —
  // den SKAL også indeholde met, ellers falder frontend til fallback (default:false)
  // og under-tæller netop denne type (default 'balanced'-focus-mål).
  const goal = { type: "relative_rank", target: 3 };
  const met = evaluateGoalProgress(goal, { rank_in_division: 2 }, null, { divisionManagerCount: 10 });
  assert.equal(met.met, true, "slår 8 managere (≥3) → met true");
  assert.ok("rank_in_division" in met && "division_manager_count" in met, "rich payload bevaret");
  const notMet = evaluateGoalProgress(goal, { rank_in_division: 9 }, null, { divisionManagerCount: 10 });
  assert.equal(notMet.met, false, "slår kun 1 manager (<3) → met false");
});

test("#55 · cumulative stage_wins: met = fuld kumulativ optælling, ikke pro-rated", () => {
  const goal = { type: "stage_wins", target: 6, cumulative: true };
  // 3yr-plan, sæson 1: pro-rated target = max(1, 6*1/3) = 2. 2 sejre = on pace.
  const onPace = evaluateGoalProgress(goal, null, null, {
    planDuration: 3, seasonsCompleted: 1, cumulativeStats: { stageWins: 2 },
  });
  assert.equal(onPace.status, "ahead", "2 sejre møder pro-rated mål → status ahead");
  assert.equal(onPace.met, false, "men fuldt mål (6) er ikke nået → met false");
  // Fuldt mål nået → met true.
  const fullyMet = evaluateGoalProgress(goal, null, null, {
    planDuration: 3, seasonsCompleted: 1, cumulativeStats: { stageWins: 6 },
  });
  assert.equal(fullyMet.met, true);
});

// =====================================================================
// #1238 · monument_podium med race_scope "classics" — klassiker-orienterede
// boards honorerer hele klassiker-kategorien (Monuments ⊂ klassikere)
// =====================================================================

test("#1238 · monument_podium with race_scope classics counts classics podiums", () => {
  const goal = { type: "monument_podium", target: 2, cumulative: true, race_scope: "classics" };
  // 2 klassiker-podier (heraf 0 monumenter) opfylder målet
  assert.equal(evaluateGoal(goal, null, {}, {
    cumulativeClassicPodiums: 2, cumulativeMonumentPodiums: 0,
  }), true);
  // 1 klassiker-podie er ikke nok
  assert.equal(evaluateGoal(goal, null, {}, {
    cumulativeClassicPodiums: 1, cumulativeMonumentPodiums: 1,
  }), false);
  // Manglende klassiker-optælling → awaiting data (null), selv med monument-count
  assert.equal(evaluateGoal(goal, null, {}, {
    cumulativeMonumentPodiums: 2,
  }), null);
});

test("#1238 · default monument scope ignores the broader classics count", () => {
  const goal = { type: "monument_podium", target: 1, cumulative: true };
  assert.equal(evaluateGoal(goal, null, {}, {
    cumulativeClassicPodiums: 5, cumulativeMonumentPodiums: 0,
  }), false);
  assert.equal(evaluateGoal(goal, null, {}, {
    cumulativeClassicPodiums: 5, cumulativeMonumentPodiums: 1,
  }), true);
});

test("#1238 · evaluateGoalProgress monument_podium reads classics count for classics scope", () => {
  const goal = { type: "monument_podium", target: 1, cumulative: true, race_scope: "classics" };
  const progress = evaluateGoalProgress(goal, null, {}, {
    planDuration: 5, seasonsCompleted: 5, isFinalSeason: true,
    cumulativeClassicPodiums: 1, cumulativeMonumentPodiums: 0,
  });
  assert.equal(progress.actual, 1);
  assert.equal(progress.status, "ahead");
  assert.equal(progress.met, true);

  const awaiting = evaluateGoalProgress(goal, null, {}, {
    planDuration: 5, seasonsCompleted: 1, cumulativeMonumentPodiums: 3,
  });
  assert.equal(awaiting.status, "awaiting_data");
});

test("#1238 · buildGoalLabel for classics scope mentions klassikere, default mentions Monuments", () => {
  const classicsLabel = buildGoalLabel({
    type: "monument_podium", target: 1, cumulative: true, race_scope: "classics",
  });
  assert.match(classicsLabel, /klassiker/i);
  const monumentLabel = buildGoalLabel({
    type: "monument_podium", target: 1, cumulative: true,
  });
  assert.match(monumentLabel, /Monuments/);
});
