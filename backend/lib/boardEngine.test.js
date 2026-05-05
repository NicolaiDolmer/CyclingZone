import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_NEGOTIATION_STATES,
  ONBOARDING_PLAN_SEQUENCE,
  buildBoardOutlook,
  buildBoardProposal,
  buildBoardRequestOptions,
  createBaselineProfile,
  deriveTeamIdentityProfile,
  deriveBoardPersonality,
  evaluateBoardSeason,
  finalizeBoardGoals,
  inferNegotiationIndexesFromGoals,
  resolveBoardRequest,
  startSequentialNegotiation,
} from "./boardEngine.js";

test("deriveTeamIdentityProfile reads a sprint-heavy squad and exposes board-facing labels", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `sprinter-${index}`,
    is_u25: index < 3,
    uci_points: 120 + (index * 10),
    stat_fl: 77,
    stat_bj: 58,
    stat_kb: 60,
    stat_bk: 64,
    stat_tt: 61,
    stat_bro: 63,
    stat_sp: 80,
    stat_acc: 79,
    stat_udh: 67,
    stat_mod: 66,
    stat_res: 70,
    stat_ftr: 62,
  }));

  const profile = deriveTeamIdentityProfile({
    team: { division: 3 },
    riders,
    standing: { rank_in_division: 3 },
  });

  assert.equal(profile.primary_specialization, "sprint");
  assert.equal(profile.competitive_tier, "competitive");
  assert.equal(profile.squad_limits.max, 10);
  assert.equal(profile.u25_share_pct, 38);
  assert.match(profile.summary, /sprinthold|trup/i);
});

test("deriveTeamIdentityProfile exposes national core and star profile markers", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `core-${index}`,
    is_u25: index < 2,
    nationality_code: index < 5 ? "DK" : index === 5 ? "NO" : "SE",
    popularity: index < 2 ? 85 - (index * 5) : 30,
    uci_points: 230 - (index * 10),
    stat_fl: 72,
    stat_bj: 69,
    stat_kb: 68,
    stat_bk: 70,
    stat_tt: 67,
    stat_bro: 69,
    stat_sp: 71,
    stat_acc: 70,
    stat_udh: 68,
    stat_mod: 67,
    stat_res: 69,
    stat_ftr: 66,
  }));

  const profile = deriveTeamIdentityProfile({
    team: { division: 3 },
    riders,
    standing: { rank_in_division: 4 },
  });

  assert.equal(profile.national_core.code, "DK");
  assert.equal(profile.national_core.share_pct, 63);
  assert.equal(profile.national_core.established, true);
  assert.equal(profile.star_profile.label, "Nationalt kendt");
});

test("buildBoardProposal keeps squad-size goals inside division limits", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `rider-${index}`,
    is_u25: index < 2,
    uci_points: 180 + (index * 12),
    stat_fl: 72,
    stat_bj: 75,
    stat_kb: 74,
    stat_bk: 68,
    stat_tt: 73,
    stat_bro: 60,
    stat_sp: 64,
    stat_acc: 63,
    stat_udh: 76,
    stat_mod: 74,
    stat_res: 75,
    stat_ftr: 69,
  }));

  const proposal = buildBoardProposal({
    focus: "star_signing",
    planType: "1yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 4,
      stage_wins: 1,
      gc_wins: 0,
    },
  });

  const minRidersGoal = proposal.goals.find((goal) => goal.type === "min_riders");

  assert.ok(minRidersGoal);
  assert.equal(minRidersGoal.target >= 8, true);
  assert.equal(minRidersGoal.target <= 10, true);
  assert.equal(minRidersGoal.max_target, 10);
  assert.equal(proposal.identity_profile.squad_limits.min, 8);
});

test("buildBoardProposal can turn balanced identity into a national core requirement", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `nation-${index}`,
    is_u25: index < 2,
    nationality_code: index < 5 ? "DK" : index === 5 ? "NO" : "SE",
    popularity: index < 2 ? 85 - (index * 5) : 35,
    uci_points: 220 - (index * 8),
    stat_fl: 70,
    stat_bj: 70,
    stat_kb: 69,
    stat_bk: 71,
    stat_tt: 68,
    stat_bro: 68,
    stat_sp: 69,
    stat_acc: 68,
    stat_udh: 70,
    stat_mod: 69,
    stat_res: 70,
    stat_ftr: 67,
  }));

  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 5,
      stage_wins: 1,
      gc_wins: 0,
    },
  });

  const nationalGoal = proposal.goals.find((goal) => goal.type === "min_national_riders");

  assert.ok(nationalGoal);
  assert.equal(nationalGoal.nationality_code, "DK");
  assert.equal(nationalGoal.target, 4);
});

test("buildBoardProposal exposes negotiated variants that can be finalized server-side", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "3yr",
  });

  assert.equal(proposal.goals.length, 4);
  assert.equal(proposal.negotiation_options.length, proposal.goals.length);
  assert.notEqual(
    proposal.negotiation_options[0].satisfaction_penalty,
    proposal.goals[0].satisfaction_penalty
  );

  const finalizedGoals = finalizeBoardGoals({
    goals: proposal.goals,
    negotiationIndexes: [0, 2],
  });

  assert.equal(finalizedGoals[0].negotiated, true);
  assert.equal(Boolean(finalizedGoals[1].negotiated), false);
  assert.equal(finalizedGoals[2].negotiated, true);
});

test("inferNegotiationIndexesFromGoals accepts legacy goal payloads but rejects tampering", () => {
  const proposal = buildBoardProposal({
    focus: "star_signing",
    planType: "1yr",
  });

  const legacySubmittedGoals = proposal.goals.map((goal, index) => (
    index === 1 ? proposal.negotiation_options[index] : goal
  ));

  const inferredIndexes = inferNegotiationIndexesFromGoals({
    goals: proposal.goals,
    negotiationOptions: proposal.negotiation_options,
    submittedGoals: legacySubmittedGoals,
  });

  assert.deepEqual(inferredIndexes, [1]);

  const tamperedGoals = proposal.goals.map((goal, index) => (
    index === 0
      ? { ...goal, target: 999 }
      : goal
  ));

  assert.throws(
    () => inferNegotiationIndexesFromGoals({
      goals: proposal.goals,
      negotiationOptions: proposal.negotiation_options,
      submittedGoals: tamperedGoals,
    }),
    /Invalid goal payload/
  );
});

test("board outlook uses derived personality and gradual weighted scoring", () => {
  const proposal = buildBoardProposal({
    focus: "youth_development",
    planType: "5yr",
  });

  const personality = deriveBoardPersonality({
    focus: "youth_development",
    planType: "5yr",
  });

  assert.equal(personality.identity_strength, "high");
  assert.equal(personality.financial_risk, "cautious");

  const board = {
    focus: proposal.focus,
    plan_type: proposal.plan_type,
    satisfaction: 50,
    current_goals: proposal.goals,
  };

  const team = {
    sponsor_income: 108,
    riders: Array.from({ length: 5 }, (_, index) => ({
      id: `rider-${index}`,
      is_u25: index < 4,
    })),
  };

  const standing = {
    rank_in_division: 6,
    stage_wins: 1,
    gc_wins: 0,
  };

  const outlook = buildBoardOutlook({
    board,
    standing,
    team,
    context: {
      activeLoanCount: 1,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 108,
      planDuration: 5,
      seasonsCompleted: 2,
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: 2,
        gcWins: 0,
      },
      recentSnapshots: [
        { goals_met: 2, goals_total: 4, satisfaction_delta: 3 },
        { goals_met: 1, goals_total: 4, satisfaction_delta: -4 },
      ],
    },
  });

  assert.equal(outlook.personality.identity_strength, "high");
  assert.equal(outlook.score_breakdown.categories.ranking.score > 0, true);
  assert.equal(outlook.score_breakdown.categories.identity.score > 0.7, true);
  assert.match(outlook.feedback.summary, /Identitet|Rangering|Okonomi|Resultater/);
});

test("evaluateBoardSeason keeps near misses partially alive instead of fully failing", () => {
  const board = {
    focus: "balanced",
    plan_type: "3yr",
    satisfaction: 55,
    current_goals: [
      {
        type: "top_n_finish",
        target: 4,
        label: "Top 4 i divisionen",
        satisfaction_bonus: 15,
        satisfaction_penalty: 8,
      },
      {
        type: "stage_wins",
        target: 3,
        label: "Mindst 3 etapesejre over planperioden",
        cumulative: true,
        satisfaction_bonus: 10,
        satisfaction_penalty: 5,
      },
      {
        type: "min_riders",
        target: 15,
        label: "Hold pa min. 15 ryttere",
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestaende gaeld ved saesonslut",
        satisfaction_bonus: 12,
        satisfaction_penalty: 8,
      },
    ],
  };

  const result = evaluateBoardSeason({
    board,
    standing: {
      rank_in_division: 5,
      stage_wins: 1,
      gc_wins: 0,
    },
    team: {
      sponsor_income: 100,
      riders: Array.from({ length: 14 }, (_, index) => ({
        id: `rider-${index}`,
        is_u25: false,
      })),
    },
    context: {
      activeLoanCount: 1,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 100,
      planDuration: 3,
      seasonsCompleted: 1,
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: 1,
        gcWins: 0,
      },
    },
  });

  assert.equal(result.scoreBreakdown.categories.ranking.score > 0.7, true);
  assert.equal(result.scoreBreakdown.categories.results.score > 0.5, true);
  assert.equal(result.newSatisfaction > 55, true);
  assert.match(result.feedback.summary, /plan|fokus|pres|halter/i);
});

test("evaluateBoardSeason scores national core identity goals against the live squad", () => {
  const result = evaluateBoardSeason({
    board: {
      focus: "balanced",
      plan_type: "1yr",
      satisfaction: 50,
      current_goals: [
        {
          type: "min_national_riders",
          target: 4,
          nationality_code: "DK",
          label: "Min. 4 ryttere fra DK",
          satisfaction_bonus: 8,
          satisfaction_penalty: 8,
        },
      ],
    },
    standing: {
      rank_in_division: 4,
      stage_wins: 0,
      gc_wins: 0,
    },
    team: {
      sponsor_income: 100,
      riders: [
        { id: "dk-1", nationality_code: "DK", is_u25: false },
        { id: "dk-2", nationality_code: "DK", is_u25: true },
        { id: "dk-3", nationality_code: "DK", is_u25: false },
        { id: "dk-4", nationality_code: "DK", is_u25: false },
        { id: "no-1", nationality_code: "NO", is_u25: false },
      ],
    },
    context: {
      isFinalSeason: true,
      planDuration: 1,
      seasonsCompleted: 1,
      hasSeasonData: true,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 100,
      cumulativeStats: {
        stageWins: 0,
        gcWins: 0,
      },
    },
  });

  assert.equal(result.goalEvaluations[0].actual, 4);
  assert.equal(result.goalsMet, 1);
});

test("buildBoardRequestOptions disables requests already spent this season", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "3yr",
  });

  const options = buildBoardRequestOptions({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 62,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    context: {
      requestUsedThisSeason: true,
    },
  });

  assert.equal(options.length, 4);
  assert.equal(options.every((option) => option.disabled), true);
  assert.equal(options[0].disabled_reason, "Du har allerede brugt saesonens board request.");
});

test("resolveBoardRequest can lower results pressure in exchange for stricter economy", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "3yr",
  });

  const result = resolveBoardRequest({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 68,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    standing: {
      rank_in_division: 4,
      stage_wins: 2,
      gc_wins: 0,
    },
    team: {
      sponsor_income: 110,
      riders: Array.from({ length: 16 }, (_, index) => ({
        id: `rider-${index}`,
        is_u25: index < 4,
      })),
    },
    context: {
      overallScore: 0.74,
      activeLoanCount: 0,
      planDuration: 3,
      seasonsCompleted: 1,
      hasSeasonData: true,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 110,
      cumulativeStats: {
        stageWins: 2,
        gcWins: 0,
      },
    },
    requestType: "lower_results_pressure",
  });

  assert.equal(result.outcome, "tradeoff");
  assert.equal(result.updated_board.focus, "balanced");
  assert.equal(result.updated_board.current_goals[0].target, 6);
  assert.equal(result.updated_board.current_goals[2].target, 3);
  assert.equal(
    result.updated_board.current_goals[3].satisfaction_penalty > proposal.goals[3].satisfaction_penalty,
    true
  );
});

test("resolveBoardRequest can pivot the active plan toward results focus", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
  });

  const result = resolveBoardRequest({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 55,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    standing: {
      rank_in_division: 4,
      stage_wins: 1,
      gc_wins: 0,
    },
    team: {
      sponsor_income: 100,
      riders: Array.from({ length: 15 }, (_, index) => ({
        id: `rider-${index}`,
        is_u25: index < 3,
      })),
    },
    context: {
      planDuration: 1,
      seasonsCompleted: 1,
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: 1,
        gcWins: 0,
      },
    },
    requestType: "more_results_focus",
  });

  assert.equal(result.outcome, "approved");
  assert.equal(result.updated_board.focus, "star_signing");
  assert.equal(result.updated_board.current_goals[0].target, 3);
  assert.equal(result.updated_board.current_goals[2].type, "gc_wins");
  assert.equal(result.updated_board.current_goals[1].target, 12);
});

test("buildBoardProposal raises the bar for star-led teams with clear profile riders", () => {
  const riders = Array.from({ length: 9 }, (_, index) => ({
    id: `star-${index}`,
    is_u25: index < 2,
    nationality_code: index < 5 ? "DK" : "SE",
    popularity: index < 3 ? 95 : 48,
    uci_points: index < 3 ? 420 : 165,
    stat_fl: 72,
    stat_bj: 72,
    stat_kb: 71,
    stat_bk: 71,
    stat_tt: 70,
    stat_bro: 70,
    stat_sp: 72,
    stat_acc: 71,
    stat_udh: 70,
    stat_mod: 70,
    stat_res: 71,
    stat_ftr: 69,
  }));

  const proposal = buildBoardProposal({
    focus: "star_signing",
    planType: "1yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 3,
      stage_wins: 1,
      gc_wins: 0,
    },
  });

  assert.equal(proposal.identity_profile.star_profile.level, "elite");
  assert.equal(proposal.goals.find((goal) => goal.type === "top_n_finish")?.target, 3);
  assert.equal(proposal.goals.find((goal) => goal.type === "gc_wins")?.target, 2);
  assert.equal(proposal.goals.find((goal) => goal.type === "sponsor_growth")?.target, 15);
});

test("board outlook turns national core and star profile into visible runtime signals", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `signal-${index}`,
    is_u25: index < 3,
    nationality_code: index < 5 ? "DK" : index === 5 ? "NO" : "SE",
    popularity: index < 3 ? 92 : 44,
    uci_points: index < 3 ? 360 : 150,
    stat_fl: 72,
    stat_bj: 72,
    stat_kb: 71,
    stat_bk: 71,
    stat_tt: 70,
    stat_bro: 69,
    stat_sp: 72,
    stat_acc: 71,
    stat_udh: 70,
    stat_mod: 69,
    stat_res: 71,
    stat_ftr: 68,
  }));

  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "3yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 4,
      stage_wins: 1,
      gc_wins: 0,
    },
  });

  const outlook = buildBoardOutlook({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 58,
      current_goals: proposal.goals,
    },
    standing: {
      rank_in_division: 4,
      stage_wins: 2,
      gc_wins: 0,
    },
    team: {
      sponsor_income: 110,
      riders,
    },
    context: {
      activeLoanCount: 0,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 110,
      planDuration: 3,
      seasonsCompleted: 2,
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: 3,
        gcWins: 0,
      },
    },
  });

  assert.equal(outlook.score_breakdown.signal_adjustments.identity > 0, true);
  assert.equal(outlook.score_breakdown.signal_adjustments.economy > 0, true);
  assert.match(outlook.feedback.summary, /kerne|identitet/i);
  assert.match(outlook.feedback.summary, /sponsor|profiler/i);
});

test("buildBoardRequestOptions blocks easing identity when a national core is central", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `core-block-${index}`,
    is_u25: index < 2,
    nationality_code: index < 5 ? "DK" : index === 5 ? "NO" : "SE",
    popularity: 45,
    uci_points: 180 - (index * 5),
    stat_fl: 70,
    stat_bj: 69,
    stat_kb: 69,
    stat_bk: 70,
    stat_tt: 68,
    stat_bro: 68,
    stat_sp: 69,
    stat_acc: 68,
    stat_udh: 70,
    stat_mod: 69,
    stat_res: 69,
    stat_ftr: 67,
  }));

  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 4,
      stage_wins: 1,
      gc_wins: 0,
    },
  });

  const options = buildBoardRequestOptions({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 60,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    context: {
      overallScore: 0.8,
      identityProfile: proposal.identity_profile,
    },
  });

  const easeIdentityOption = options.find((option) => option.type === "ease_identity_requirements");
  assert.equal(easeIdentityOption?.disabled, true);
  assert.match(easeIdentityOption?.disabled_reason || "", /nationale kerne|DNA/i);
});

test("resolveBoardRequest bridges direct youth-to-results pivots through balanced focus", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `pivot-${index}`,
    is_u25: index < 5,
    nationality_code: index < 4 ? "DK" : "SE",
    popularity: 32,
    uci_points: 150 - (index * 4),
    stat_fl: 68,
    stat_bj: 69,
    stat_kb: 70,
    stat_bk: 68,
    stat_tt: 67,
    stat_bro: 66,
    stat_sp: 67,
    stat_acc: 67,
    stat_udh: 71,
    stat_mod: 70,
    stat_res: 71,
    stat_ftr: 68,
  }));

  const proposal = buildBoardProposal({
    focus: "youth_development",
    planType: "1yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 4,
      stage_wins: 1,
      gc_wins: 0,
    },
  });

  const result = resolveBoardRequest({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 60,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    standing: {
      rank_in_division: 4,
      stage_wins: 1,
      gc_wins: 0,
    },
    team: {
      sponsor_income: 100,
      riders,
    },
    context: {
      planDuration: 1,
      seasonsCompleted: 1,
      hasSeasonData: true,
      cumulativeStats: {
        stageWins: 1,
        gcWins: 0,
      },
    },
    requestType: "more_results_focus",
  });

  assert.equal(result.outcome, "tradeoff");
  assert.equal(result.updated_board.focus, "balanced");
  assert.equal(result.updated_board.current_goals.some((goal) => goal.type === "min_u25_riders"), true);
  assert.match(result.summary, /gradvis|mellemposition/i);
});

test("resolveBoardRequest rejects lowering results pressure for a star-led team", () => {
  const riders = Array.from({ length: 9 }, (_, index) => ({
    id: `reject-star-${index}`,
    is_u25: index < 2,
    popularity: index < 3 ? 96 : 45,
    uci_points: index < 3 ? 430 : 175,
    stat_fl: 72,
    stat_bj: 72,
    stat_kb: 71,
    stat_bk: 71,
    stat_tt: 70,
    stat_bro: 70,
    stat_sp: 72,
    stat_acc: 71,
    stat_udh: 70,
    stat_mod: 70,
    stat_res: 71,
    stat_ftr: 69,
  }));

  const proposal = buildBoardProposal({
    focus: "star_signing",
    planType: "1yr",
    team: {
      division: 3,
      sponsor_income: 100,
      balance: 500,
    },
    riders,
    standing: {
      rank_in_division: 1,
      stage_wins: 3,
      gc_wins: 2,
    },
  });

  const result = resolveBoardRequest({
    board: {
      focus: proposal.focus,
      plan_type: proposal.plan_type,
      satisfaction: 55,
      negotiation_status: "completed",
      current_goals: proposal.goals,
    },
    standing: {
      rank_in_division: 1,
      stage_wins: 3,
      gc_wins: 2,
    },
    team: {
      sponsor_income: 120,
      riders,
    },
    context: {
      overallScore: 0.7,
      activeLoanCount: 0,
      planDuration: 1,
      seasonsCompleted: 1,
      hasSeasonData: true,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 120,
      cumulativeStats: {
        stageWins: 3,
        gcWins: 2,
      },
    },
    requestType: "lower_results_pressure",
  });

  assert.equal(result.outcome, "rejected");
  assert.match(result.summary, /profiler|sponsor/i);
});

// ─── S-02a · Foundation tests ────────────────────────────────────────────────

test("createBaselineProfile produces a season-1 observation row with no goals and modifier 1.0", () => {
  const baseline = createBaselineProfile({
    teamId: "team-1",
    seasonId: "season-1",
    balance: 800000,
    sponsorIncome: 240000,
  });

  assert.equal(baseline.team_id, "team-1");
  assert.equal(baseline.plan_type, "baseline");
  assert.equal(baseline.is_baseline, true);
  assert.equal(baseline.budget_modifier, 1.0);
  assert.equal(baseline.satisfaction, 50);
  assert.equal(baseline.negotiation_status, "completed");
  assert.deepEqual(baseline.current_goals, []);
  assert.equal(baseline.plan_start_balance, 800000);
  assert.equal(baseline.plan_start_sponsor_income, 240000);
});

test("ONBOARDING_PLAN_SEQUENCE is locked to 5yr → 3yr → 1yr (Q-batch 1A Q2)", () => {
  assert.deepEqual(ONBOARDING_PLAN_SEQUENCE, ["5yr", "3yr", "1yr"]);
});

test("startSequentialNegotiation deletes baseline rows for human teams and sets window to pending_5yr", async () => {
  const state = {
    teams: [
      { id: "team-1", is_ai: false, is_bank: false, is_frozen: false },
      { id: "team-2", is_ai: false, is_bank: false, is_frozen: false },
      { id: "team-ai", is_ai: true, is_bank: false, is_frozen: false },
      { id: "team-frozen", is_ai: false, is_bank: false, is_frozen: true },
    ],
    board_profiles: [
      { id: "bp-1", team_id: "team-1", plan_type: "baseline", is_baseline: true },
      { id: "bp-2", team_id: "team-2", plan_type: "baseline", is_baseline: true },
      { id: "bp-keep", team_id: "team-1", plan_type: "5yr", is_baseline: false },
      { id: "bp-ai", team_id: "team-ai", plan_type: "baseline", is_baseline: true },
    ],
    transfer_windows: [
      { id: "tw-old", board_negotiation_state: "locked", created_at: "2026-04-01T00:00:00Z" },
      { id: "tw-new", board_negotiation_state: "locked", created_at: "2026-05-01T00:00:00Z" },
    ],
  };

  const supabase = makeFakeSupabase(state);
  const result = await startSequentialNegotiation({ supabase, completedSeasonId: "season-1" });

  assert.equal(result.baseline_rows_deleted, 2);
  assert.equal(result.window_state, BOARD_NEGOTIATION_STATES.PENDING_5YR);
  assert.equal(result.completed_season_id, "season-1");

  const remainingBaselines = state.board_profiles.filter((b) => b.plan_type === "baseline");
  assert.equal(remainingBaselines.length, 1);
  assert.equal(remainingBaselines[0].id, "bp-ai", "AI baseline must not be touched");

  assert.ok(state.board_profiles.find((b) => b.id === "bp-keep"), "Non-baseline rows must survive");

  const newestWindow = state.transfer_windows.find((w) => w.id === "tw-new");
  assert.equal(newestWindow.board_negotiation_state, "pending_5yr");

  const olderWindow = state.transfer_windows.find((w) => w.id === "tw-old");
  assert.equal(olderWindow.board_negotiation_state, "locked", "Older windows are not touched");
});

test("startSequentialNegotiation handles empty manager pool without crashing", async () => {
  const state = {
    teams: [{ id: "team-ai", is_ai: true, is_bank: false, is_frozen: false }],
    board_profiles: [],
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "locked", created_at: "2026-05-01T00:00:00Z" },
    ],
  };

  const supabase = makeFakeSupabase(state);
  const result = await startSequentialNegotiation({ supabase });

  assert.equal(result.baseline_rows_deleted, 0);
  assert.equal(result.window_state, BOARD_NEGOTIATION_STATES.PENDING_5YR);
});

// Minimal fake supabase-client for sequential-negotiation-tests.
// Mønster matcher betaResetService.test.js's createBetaResetSupabase men er trimmet ned.
function makeFakeSupabase(state) {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function makeQuery(table, action, payload = null) {
    const filters = [];
    let order = null;
    let limit = null;

    function matches(row) {
      return filters.every((filter) => {
        if (filter.type === "eq") return row[filter.column] === filter.value;
        if (filter.type === "in") return filter.values.includes(row[filter.column]);
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);

      if (action === "select") {
        let result = rows.filter(matches);
        if (order) {
          result = [...result].sort((a, b) => {
            const av = a[order.column];
            const bv = b[order.column];
            if (av === bv) return 0;
            const cmp = av < bv ? -1 : 1;
            return order.ascending ? cmp : -cmp;
          });
        }
        if (limit != null) result = result.slice(0, limit);
        return Promise.resolve({ data: clone(result), error: null });
      }

      if (action === "delete") {
        const deleted = rows.filter(matches);
        state[table] = rows.filter((row) => !matches(row));
        return Promise.resolve({ data: clone(deleted), error: null });
      }

      if (action === "update") {
        const updated = [];
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, clone(payload));
            updated.push(row);
          }
        }
        return Promise.resolve({ data: clone(updated), error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      in(column, values) { filters.push({ type: "in", column, values }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select() { return query; },
      maybeSingle() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };

    return query;
  }

  return {
    from(table) {
      ensureTable(table);
      return {
        select() { return makeQuery(table, "select"); },
        delete() { return makeQuery(table, "delete"); },
        update(payload) { return makeQuery(table, "update", payload); },
      };
    },
  };
}
