import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_NEGOTIATION_STATES,
  ONBOARDING_PLAN_SEQUENCE,
  buildBoardOutlook,
  buildBoardProposal,
  buildBoardRequestOptions,
  computeSeasonOneIdentity,
  createBaselineProfile,
  deriveDefaultFocusFromIdentity,
  deriveTeamIdentityProfile,
  deriveBoardPersonality,
  evaluateBoardSeason,
  finalizeBoardGoals,
  generate1YrFromLongerPlans,
  inferNegotiationIndexesFromGoals,
  resolveBoardRequest,
  startSequentialNegotiation,
} from "./boardEngine.js";
import { processBoardAutoAcceptCron } from "./boardAutoAccept.js";

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
  // #1084 · i18n-koder ved siden af de danske labels (frontend resolve-on-read).
  assert.equal(profile.primary_specialization_label_key, "specialization.sprint");
  assert.equal(profile.competitive_tier_label_key, "competitiveTier.competitive");
  assert.match(profile.squad_status_label_key, /^squadStatus\./);
  assert.equal(profile.summary_key, "identitySummary.template");
  assert.equal(profile.summary_params.primarySpecialization, "sprint");
  assert.equal(profile.summary_params.squadStatus, profile.squad_status);
});

test("deriveTeamIdentityProfile exposes national core and star profile markers", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `core-${index}`,
    firstname: `Star${index}`,
    lastname: `Rider${index}`,
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
  // #1084 · label-koder: national kerne (med {country}-param) + stjerneprofil.
  assert.equal(profile.national_core.label_key, "nationalCoreLabel.clearCore");
  assert.deepEqual(profile.national_core.label_params, { country: "DK" });
  assert.equal(profile.star_profile.label_key, "starProfileLevel.high");
  assert.equal(profile.summary_params.nationalCoreCode, "DK");
  assert.equal(profile.summary_params.starProfileLevel, "high");
  // #1889 · star_profile navngiver nu de kvalificerende profilryttere; listen
  // matcher star_rider_count, er sorteret faldende på score og bærer id + navn.
  assert.equal(profile.star_profile.star_riders.length, profile.star_profile.star_rider_count);
  assert.ok(profile.star_profile.star_riders.length >= 1);
  assert.ok(profile.star_profile.star_riders.every((rider) => rider.score >= 68));
  assert.equal(profile.star_profile.star_riders[0].id, "core-0");
  assert.equal(profile.star_profile.star_riders[0].name, "Star0 Rider0");
  assert.ok(
    profile.star_profile.star_riders[0].score >= profile.star_profile.star_riders.at(-1).score
  );
});

test("deriveTeamIdentityProfile returns an empty star_riders list when no rider clears the threshold", () => {
  const riders = Array.from({ length: 8 }, (_, index) => ({
    id: `domestique-${index}`,
    firstname: `Worker${index}`,
    lastname: `Bee${index}`,
    is_u25: false,
    nationality_code: "DK",
    popularity: 20,
    uci_points: 10,
    stat_fl: 50,
    stat_bj: 50,
    stat_kb: 50,
    stat_bk: 50,
    stat_tt: 50,
    stat_bro: 50,
    stat_sp: 50,
    stat_acc: 50,
    stat_udh: 50,
    stat_mod: 50,
    stat_res: 50,
    stat_ftr: 50,
  }));

  const profile = deriveTeamIdentityProfile({ team: { division: 3 }, riders });

  assert.equal(profile.star_profile.level, "low");
  assert.equal(profile.star_profile.star_rider_count, 0);
  assert.deepEqual(profile.star_profile.star_riders, []);
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

  // S-02d · balanced-pakken har nu 5 mål (relative_rank tilføjet)
  assert.equal(proposal.goals.length, 5);
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

// #1234 · Binære/minimums-mål (no_outstanding_debt m.fl.) kunne "forhandles"
// til et IDENTISK mål med halveret penalty (no-op-rabat). Nu: ingen option i
// forslaget, finalize falder tilbage til originalen, og infer afviser payloads
// der påstår forhandling af dem.
test("#1234 · binary goals expose no negotiation option and cannot be discounted", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
  });

  const debtIndex = proposal.goals.findIndex((goal) => goal.type === "no_outstanding_debt");
  assert.ok(debtIndex >= 0, "balanced-pakken skal indeholde no_outstanding_debt");
  assert.equal(proposal.negotiation_options[debtIndex], null);

  // Råt negotiations-index direkte mod et binært mål → originalen bevares uændret.
  const finalizedGoals = finalizeBoardGoals({
    goals: proposal.goals,
    negotiationIndexes: [debtIndex],
  });
  assert.equal(Boolean(finalizedGoals[debtIndex].negotiated), false);
  assert.equal(
    finalizedGoals[debtIndex].satisfaction_penalty,
    proposal.goals[debtIndex].satisfaction_penalty
  );

  // Legacy goals-payload med den gamle no-op-rabat (samme target, halv penalty)
  // afvises som tampering.
  const noOpDiscountGoals = proposal.goals.map((goal, index) => (
    index === debtIndex
      ? {
        ...goal,
        satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5),
        negotiated: true,
      }
      : goal
  ));
  assert.throws(
    () => inferNegotiationIndexesFromGoals({
      goals: proposal.goals,
      negotiationOptions: proposal.negotiation_options,
      submittedGoals: noOpDiscountGoals,
    }),
    /Invalid goal payload/
  );
});

test("inferNegotiationIndexesFromGoals accepts legacy goal payloads but rejects tampering", () => {
  const proposal = buildBoardProposal({
    focus: "star_signing",
    planType: "1yr",
  });

  // #1234 · negotiation_options kan nu indeholde null (mål uden reel lempelse)
  // — vælg et mål der faktisk har en option.
  const negotiableIndex = proposal.negotiation_options.findIndex((option) => option != null);
  assert.ok(negotiableIndex >= 0, "mindst ét mål skal have en negotiation-option");

  const legacySubmittedGoals = proposal.goals.map((goal, index) => (
    index === negotiableIndex ? proposal.negotiation_options[index] : goal
  ));

  const inferredIndexes = inferNegotiationIndexesFromGoals({
    goals: proposal.goals,
    negotiationOptions: proposal.negotiation_options,
    submittedGoals: legacySubmittedGoals,
  });

  assert.deepEqual(inferredIndexes, [negotiableIndex]);

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
      seasonsCompleted: 2,
      hasSeasonData: true,
      planStartSponsorIncome: 100,
      currentSponsorIncome: 110,
      cumulativeStats: {
        stageWins: 2,
        gcWins: 0,
      },
      // S-02g · 2/3 saesoner = 66% > 50% mid-cycle-graense → re-orientering aabnet
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
  // #1267 · sponsor_growth er fjernet fra 1yr-planer (uvindbar i én sæson) —
  // bar-hævningen sker nu via top_n_finish/gc_wins, ikke sponsor-målet.
  assert.equal(proposal.goals.find((goal) => goal.type === "sponsor_growth"), undefined);
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
      { id: "team-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "team-2", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "team-ai", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "team-frozen", is_ai: false, is_bank: false, is_frozen: true, is_test_account: false },
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
    teams: [{ id: "team-ai", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false }],
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

// ─── S-02b · 1yr-auto-gen + identity-feeding + auto-accept tests ────────────

test("computeSeasonOneIdentity captures only the stable axes from season 1", () => {
  const riders = Array.from({ length: 8 }, (_, i) => ({
    is_u25: i < 4,
    nationality_code: i < 5 ? "FR" : i === 5 ? "BE" : "ESP",
    popularity: i < 2 ? 78 : 25,
    uci_points: 220 - (i * 10),
    stat_fl: 60, stat_bj: 75, stat_kb: 72, stat_bk: 65, stat_tt: 70,
    stat_bro: 60, stat_sp: 58, stat_acc: 60, stat_udh: 70, stat_mod: 70,
    stat_res: 70, stat_ftr: 65,
  }));

  const basis = computeSeasonOneIdentity({
    team: { division: 3 },
    riders,
    seasonNumber: 1,
  });

  assert.equal(basis.season_number_observed, 1);
  assert.equal(basis.rider_count, 8);
  assert.equal(basis.national_core.code, "FR");
  assert.equal(basis.national_core.established, true);
  assert.equal(basis.youth_share_pct, 50);
  assert.equal(basis.youth_level, "high");
  assert.ok(basis.primary_specialization);
  assert.ok(basis.star_profile);
  // Standing-derived fields skal IKKE være på basis (de skifter naturligt)
  assert.equal(basis.competitive_tier, undefined);
});

test("deriveDefaultFocusFromIdentity prefers youth when youth_level is high", () => {
  const focus = deriveDefaultFocusFromIdentity({
    youth_level: "high",
    star_profile: { level: "low" },
    primary_specialization: "balanced",
  });
  assert.equal(focus, "youth_development");
});

test("deriveDefaultFocusFromIdentity prefers star_signing for elite stars", () => {
  const focus = deriveDefaultFocusFromIdentity({
    youth_level: "low",
    star_profile: { level: "elite" },
    primary_specialization: "gc",
  });
  assert.equal(focus, "star_signing");
});

test("deriveDefaultFocusFromIdentity falls back to balanced when nothing strong", () => {
  const focus = deriveDefaultFocusFromIdentity({
    youth_level: "low",
    star_profile: { level: "low" },
    primary_specialization: "balanced",
  });
  assert.equal(focus, "balanced");
});

test("deriveDefaultFocusFromIdentity returns balanced when no basis is provided", () => {
  assert.equal(deriveDefaultFocusFromIdentity(null), "balanced");
});

test("buildBoardProposal annotates 5yr goals with identity-basis rationale", () => {
  const riders = Array.from({ length: 8 }, (_, i) => ({
    is_u25: i < 5,
    nationality_code: i < 5 ? "FR" : "BE",
    uci_points: 100,
    stat_fl: 65, stat_bj: 70, stat_kb: 70, stat_bk: 65, stat_tt: 70,
    stat_bro: 60, stat_sp: 60, stat_acc: 62, stat_udh: 70, stat_mod: 68,
    stat_res: 70, stat_ftr: 62,
  }));

  const identityBasis = {
    season_number_observed: 1,
    rider_count: 8,
    primary_specialization: "balanced",
    youth_share_pct: 63,
    youth_level: "high",
    national_core: { code: "FR", count: 5, share_pct: 63, strength: "high", established: true },
    star_profile: { level: "low" },
  };

  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "5yr",
    team: { division: 3 },
    riders,
    standing: { rank_in_division: 4 },
    identityBasis,
  });

  assert.equal(proposal.identity_basis, identityBasis);
  // Mindst én goal skal have rationale tilknyttet (national_core er stærk)
  const annotated = proposal.goals.filter((g) => g.identity_basis_rationale);
  assert.ok(annotated.length > 0, "5yr-mål skal annoteres med identity rationale");

  const nationalGoal = proposal.goals.find((g) => g.type === "min_national_riders");
  if (nationalGoal) {
    assert.equal(nationalGoal.identity_basis_rationale.kind, "national_core");
    assert.match(nationalGoal.identity_basis_rationale.short, /FR-kerne/);
  }
});

test("buildBoardProposal does NOT annotate 1yr goals (identity-feeding only on 5yr)", () => {
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
    team: { division: 3 },
    riders: [],
    standing: null,
    identityBasis: {
      youth_share_pct: 50,
      youth_level: "high",
      national_core: { code: "FR", count: 5, share_pct: 63, strength: "high", established: true },
      primary_specialization: "balanced",
      rider_count: 8,
    },
  });

  const annotated = proposal.goals.filter((g) => g.identity_basis_rationale);
  assert.equal(annotated.length, 0, "1yr-mål må ikke have identity-feeding-badge");
});

test("generate1YrFromLongerPlans returns two variants (stable + results_focus)", () => {
  const result = generate1YrFromLongerPlans({
    team: { division: 3, balance: 0, sponsor_income: 100 },
    riders: [],
    standing: null,
    fiveYrBoard: { focus: "youth_development" },
    threeYrBoard: { focus: "youth_development" },
  });

  assert.equal(result.inherited_focus, "youth_development");
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].key, "stable");
  assert.equal(result.variants[0].proposal.focus, "youth_development");
  assert.equal(result.variants[1].key, "results_focus");
  // results_focus skal IKKE være youth_development når den arver youth (Q-bekræftelse)
  assert.notEqual(result.variants[1].proposal.focus, "youth_development");
});

test("generate1YrFromLongerPlans falls back to balanced when no longer plans exist", () => {
  const result = generate1YrFromLongerPlans({
    team: { division: 3 },
    riders: [],
    standing: null,
    fiveYrBoard: null,
    threeYrBoard: null,
  });

  assert.equal(result.inherited_focus, "balanced");
  assert.equal(result.variants[0].proposal.focus, "balanced");
  assert.equal(result.variants[1].proposal.focus, "star_signing");
});

test("startSequentialNegotiation persists season_1_identity_basis on each human team", async () => {
  const state = {
    teams: [
      { id: "team-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, season_1_identity_basis: null },
      { id: "team-ai", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, division: 3, season_1_identity_basis: null },
    ],
    riders: [
      { team_id: "team-1", is_u25: true, nationality_code: "FR", uci_points: 100, popularity: 50,
        stat_fl: 70, stat_bj: 70, stat_kb: 70, stat_bk: 70, stat_tt: 70, stat_bro: 70,
        stat_sp: 70, stat_acc: 70, stat_udh: 70, stat_mod: 70, stat_res: 70, stat_ftr: 70 },
      { team_id: "team-1", is_u25: false, nationality_code: "FR", uci_points: 90, popularity: 40,
        stat_fl: 70, stat_bj: 70, stat_kb: 70, stat_bk: 70, stat_tt: 70, stat_bro: 70,
        stat_sp: 70, stat_acc: 70, stat_udh: 70, stat_mod: 70, stat_res: 70, stat_ftr: 70 },
    ],
    board_profiles: [
      { id: "bp-1", team_id: "team-1", plan_type: "baseline", is_baseline: true },
    ],
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "locked", created_at: "2026-05-01T00:00:00Z" },
    ],
  };

  const supabase = makeFakeSupabase(state);
  const result = await startSequentialNegotiation({ supabase });

  assert.equal(result.identity_bases_written, 1);
  assert.equal(result.baseline_rows_deleted, 1);

  const team1 = state.teams.find((t) => t.id === "team-1");
  assert.ok(team1.season_1_identity_basis, "Identity basis skal persisteres");
  assert.equal(team1.season_1_identity_basis.rider_count, 2);
  assert.equal(team1.season_1_identity_basis.national_core.code, "FR");

  const teamAi = state.teams.find((t) => t.id === "team-ai");
  assert.equal(teamAi.season_1_identity_basis, null, "AI hold må ikke få basis");
});

test("startSequentialNegotiation skips identity_basis-write when team already has one (idempotent replay)", async () => {
  const existingBasis = { rider_count: 99, national_core: { code: "OLD" } };
  const state = {
    teams: [
      { id: "team-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, season_1_identity_basis: existingBasis },
    ],
    riders: [],
    board_profiles: [],
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "locked", created_at: "2026-05-01T00:00:00Z" },
    ],
  };

  const supabase = makeFakeSupabase(state);
  const result = await startSequentialNegotiation({ supabase });

  assert.equal(result.identity_bases_written, 0, "Bevarer eksisterende basis");
  assert.deepEqual(state.teams[0].season_1_identity_basis, existingBasis);
});

test("processBoardAutoAcceptCron sends T-3 reminder at race_days_completed=2", async () => {
  const notifications = [];
  const state = makeAutoAcceptState({ raceDaysCompleted: 2 });
  const supabase = makeFakeSupabase(state);

  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async (args) => {
      notifications.push({ ...args });
      return { delivered: true, deduped: false };
    },
    now: new Date("2026-05-05T10:00:00Z"),
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.reminders_sent, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "board_update");
  // #666: title nu EN ("5-year plan"); locale-rendering via metadata.titleParams.planLabelKey.
  assert.match(notifications[0].title, /5-year plan/);
  assert.equal(notifications[0].metadata?.titleParams?.planLabelKey, "planLabel.5yr");
});

test("processBoardAutoAcceptCron sends T-1 critical reminder at race_days_completed=4", async () => {
  const notifications = [];
  const state = makeAutoAcceptState({ raceDaysCompleted: 4 });
  const supabase = makeFakeSupabase(state);

  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async (args) => {
      notifications.push({ ...args });
      return { delivered: true, deduped: false };
    },
  });

  assert.equal(summary.reminders_sent, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(notifications[0].type, "board_critical");
  // #666: title nu EN ("Last chance: 5-year plan").
  assert.match(notifications[0].title, /Last chance/);
  assert.equal(notifications[0].metadata?.titleCode, "notif.boardT1Reminder.title");
});

test("processBoardAutoAcceptCron auto-signs default plan at race_days_completed=5 using identity-derived focus", async () => {
  const notifications = [];
  const state = makeAutoAcceptState({
    raceDaysCompleted: 5,
    identityBasis: {
      youth_level: "high",
      youth_share_pct: 60,
      primary_specialization: "youth",
      national_core: { code: "DK", count: 5, share_pct: 60, strength: "high", established: true },
      star_profile: { level: "medium" },
      rider_count: 8,
      season_number_observed: 1,
    },
  });
  const supabase = makeFakeSupabase(state);

  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async (args) => {
      notifications.push({ ...args });
      return { delivered: true, deduped: false };
    },
  });

  assert.equal(summary.auto_accepted, 1);
  assert.equal(summary.errors, 0);

  const created = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.ok(created, "Auto-accept skal upserte 5yr-row");
  assert.equal(created.focus, "youth_development", "Identity youth_level=high → youth_development focus");
  assert.equal(created.negotiation_status, "completed");
  assert.ok(created.current_goals?.length > 0, "Default-mål skal være populeret");
  assert.equal(state.teams[0].team_dna_key, "skandinavisk_udvikling");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, TEAM_BOARD_MEMBERS_COUNT);
});

test("processBoardAutoAcceptCron: per-team fail kalder captureExceptionFn med teamId+seasonId+raceDaysCompleted (Refs #614 P2-A)", async () => {
  const state = makeAutoAcceptState({ raceDaysCompleted: 2 });
  const supabase = makeFakeSupabase(state);

  const captureCalls = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const summary = await processBoardAutoAcceptCron({
      supabase,
      notifyUser: async () => { throw new Error("simulated notify failure"); },
      captureExceptionFn: (err, ctx) => { captureCalls.push({ err, ctx }); },
      now: new Date("2026-05-05T10:00:00Z"),
    });
    assert.equal(summary.errors, 1);
  } finally {
    console.error = originalError;
  }

  assert.equal(captureCalls.length, 1);
  assert.equal(captureCalls[0].ctx.tags.cron, "board-auto-accept");
  assert.equal(captureCalls[0].ctx.extra.teamId, "team-1");
  assert.equal(captureCalls[0].ctx.extra.seasonId, "season-2");
  assert.equal(captureCalls[0].ctx.extra.raceDaysCompleted, 2);
});

test("processBoardAutoAcceptCron skips when window is locked (baseline phase)", async () => {
  const state = makeAutoAcceptState({ raceDaysCompleted: 5, windowState: "locked" });
  const supabase = makeFakeSupabase(state);

  const summary = await processBoardAutoAcceptCron({
    supabase,
    notifyUser: async () => ({ delivered: true, deduped: false }),
  });

  assert.equal(summary.teams_checked, 0);
  assert.equal(summary.auto_accepted, 0);
});

test("processBoardAutoAcceptCron rolls back team_dna_key when board regeneration fails (#878 atomicity)", async () => {
  const state = makeAutoAcceptState({
    raceDaysCompleted: 5,
    identityBasis: {
      youth_level: "high",
      youth_share_pct: 60,
      primary_specialization: "youth",
      national_core: { code: "DK", count: 5, share_pct: 60, strength: "high", established: true },
      star_profile: { level: "medium" },
      rider_count: 8,
      season_number_observed: 1,
    },
  });
  // Lad insert i team_board_members fejle → regenerateBoardMembersForTeam kaster
  // EFTER team-UPDATE (team_dna_key) er committet.
  const supabase = makeFakeSupabase(state, { failInsertOn: "team_board_members" });

  const originalError = console.error;
  console.error = () => {};
  try {
    const summary = await processBoardAutoAcceptCron({
      supabase,
      notifyUser: async () => ({ delivered: true, deduped: false }),
    });
    assert.equal(summary.errors, 1, "regenererings-fejl skal tælles som per-team error");
    assert.equal(summary.auto_accepted, 0, "auto-accept må ikke rapporteres når regenerering fejler");
  } finally {
    console.error = originalError;
  }

  // Teamet må IKKE efterlades dna-sat-men-boardless — ellers låser 409-guarden i
  // POST /board/dna-choose manageren ude af onboarding (#878).
  assert.equal(state.teams[0].team_dna_key, null, "team_dna_key skal være rullet tilbage");
  assert.equal(state.teams[0].team_dna_chosen_at, null, "team_dna_chosen_at skal være rullet tilbage");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, 0);
});

function makeAutoAcceptState({
  raceDaysCompleted = 0,
  windowState = "pending_5yr",
  identityBasis = null,
} = {}) {
  return {
    teams: [{
      id: "team-1",
      user_id: "user-1",
      is_ai: false,
      is_bank: false,
      is_frozen: false,
      is_test_account: false,
      division: 3,
      balance: 800000,
      sponsor_income: 240000,
      name: "Test Hold",
      season_1_identity_basis: identityBasis,
      team_dna_key: null,
    }],
    riders: [],
    seasons: [{
      id: "season-2",
      number: 2,
      status: "active",
      race_days_completed: raceDaysCompleted,
      race_days_total: 60,
    }],
    board_profiles: [],
    team_board_members: [],
    season_standings: [],
    transfer_windows: [{
      id: "tw-1",
      board_negotiation_state: windowState,
      created_at: "2026-05-05T00:00:00Z",
    }],
  };
}

// Minimal fake supabase-client for sequential-negotiation-tests.
// Mønster matcher betaResetService.test.js's createBetaResetSupabase men er trimmet ned.
// ─── S-02c · Navngivne board-members tests ──────────────────────────────────

import {
  BOARD_ARCHETYPE_KEYS,
  BOARD_ARCHETYPES,
  archetypesConflict,
  computeArchetypeAlignmentScore,
  selectBoardMembers,
  assignBoardMembersForTeam,
  regenerateBoardMembersForTeam,
  repairBoardMembersAfterDna,
  chooseDnaForTeam,
  selectDominantMember,
  sampleReactionForFeedback,
  sampleReactionForGoal,
  processReplacementTrigger,
  TEAM_BOARD_MEMBERS_COUNT,
  REPLACEMENT_TRIGGER_THRESHOLD,
} from "./boardEngine.js";

const FRENCH_GC_BASIS = {
  season_number_observed: 1,
  rider_count: 8,
  primary_specialization: "gc",
  primary_specialization_label: "GC-hold",
  secondary_specialization: "classics",
  youth_share_pct: 38,
  youth_level: "medium",
  national_core: { code: "FR", count: 5, share_pct: 63, strength: "high", established: true, label: "Tydelig FR-kerne" },
  star_profile: { level: "high", label: "Nationalt kendt", headline_score: 72, star_rider_count: 2, share_pct: 25 },
};

const YOUTH_HEAVY_BASIS = {
  season_number_observed: 1,
  rider_count: 9,
  primary_specialization: "youth",
  primary_specialization_label: "Ungdomshold",
  secondary_specialization: "balanced",
  youth_share_pct: 67,
  youth_level: "high",
  national_core: { code: null, established: false, strength: "none" },
  star_profile: { level: "low", label: "Ukendt", headline_score: 30, star_rider_count: 0, share_pct: 0 },
};

test("BOARD_ARCHETYPES contains exactly 9 archetypes med 30 reactions hver (Q-batch 1B Q9 + A4)", () => {
  assert.equal(BOARD_ARCHETYPE_KEYS.length, 9);
  for (const key of BOARD_ARCHETYPE_KEYS) {
    const arc = BOARD_ARCHETYPES[key];
    assert.ok(arc, `archetype ${key} mangler`);
    assert.ok(arc.label && arc.emoji);
    const total = Object.values(arc.reactions).reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, 30, `${key} skal have 30 reactions (har ${total})`);
  }
});

test("archetypesConflict detects high vs. low på friction-aksen debt_aversion", () => {
  // Sponsoraten (debt_aversion=high) vs. Resultatjægeren (debt_aversion=low) → konflikt
  assert.equal(
    archetypesConflict(BOARD_ARCHETYPES.sponsoraten, BOARD_ARCHETYPES.resultatjaegeren),
    true,
  );
  // Pragmatikeren (medium) vs. Sponsoraten (high) → ingen friction-konflikt
  assert.equal(
    archetypesConflict(BOARD_ARCHETYPES.pragmatikeren, BOARD_ARCHETYPES.sponsoraten),
    false,
  );
});

test("computeArchetypeAlignmentScore favoriserer GC-elsker for fransk GC-hold", () => {
  const gcScore = computeArchetypeAlignmentScore(BOARD_ARCHETYPES.gc_elsker, FRENCH_GC_BASIS);
  const ungdomsScore = computeArchetypeAlignmentScore(BOARD_ARCHETYPES.ungdomsidealisten, FRENCH_GC_BASIS);
  assert.ok(gcScore > ungdomsScore, `gc_elsker (${gcScore}) skal score højere end ungdomsidealisten (${ungdomsScore})`);
});

test("selectBoardMembers returnerer 5 medlemmer (3 identity + 2 wildcard) med præcis én chairman", () => {
  const selection = selectBoardMembers({ identityBasis: FRENCH_GC_BASIS, teamId: "team-fr-gc" });
  assert.equal(selection.length, TEAM_BOARD_MEMBERS_COUNT);
  const identityCount = selection.filter((m) => m.selection_kind === "identity").length;
  const wildcardCount = selection.filter((m) => m.selection_kind === "wildcard").length;
  assert.equal(identityCount, 3);
  assert.equal(wildcardCount, 2);
  const chairmen = selection.filter((m) => m.is_chairman);
  assert.equal(chairmen.length, 1, "præcis én chairman");
  // Chairman = højeste alignment_score
  const maxScore = Math.max(...selection.map((m) => m.alignment_score));
  assert.equal(chairmen[0].alignment_score, maxScore);
});

test("selectBoardMembers undgår friction-konflikt 'hvis muligt' — fransk GC-basis har ingen konflikter", () => {
  // Brugerens A2-præmis (2026-05-05): "Må dog ikke være modsigende, hvis muligt".
  // FRENCH_GC_BASIS giver gc_elsker + klassiker_purist + traditionalisten som identity-picks.
  // Wildcard-pool indeholder mindst 4 non-conflicting kandidater, så algoritmen
  // SKAL undgå alle konflikter her.
  const selection = selectBoardMembers({ identityBasis: FRENCH_GC_BASIS, teamId: "team-fr-gc-conflict" });
  const allMembers = selection.map((m) => BOARD_ARCHETYPES[m.archetype_key]);
  for (let i = 0; i < allMembers.length; i++) {
    for (let j = i + 1; j < allMembers.length; j++) {
      assert.equal(
        archetypesConflict(allMembers[i], allMembers[j]),
        false,
        `Konflikt mellem ${allMembers[i].key} og ${allMembers[j].key}`,
      );
    }
  }
});

test("selectBoardMembers tillader konflikt-fallback når non-conflicting pool er tom (youth-heavy edge case)", () => {
  // Youth-heavy basis identity-matcher Talentspejderen + Ungdoms-idealisten + tredje (begge youth_focus=high).
  // 5 af 6 resterende arketyper har youth_focus=low → konflikter er uundgåelige med 2 wildcards.
  // Algoritmen skal STADIG returnere 5 medlemmer (fallback er bedre end crash).
  const selection = selectBoardMembers({ identityBasis: YOUTH_HEAVY_BASIS, teamId: "team-youth-edge" });
  assert.equal(selection.length, TEAM_BOARD_MEMBERS_COUNT);
  // Antallet af konflikter må ikke være højere end nødvendigt: max 1 wildcard er ikke-conflicting,
  // så vi forventer 0-1 wildcards uden konflikt og 1-2 med.
  const wildcards = selection.filter((m) => m.selection_kind === "wildcard");
  assert.equal(wildcards.length, 2, "stadig 2 wildcards selv ved konflikt-fallback");
});

test("selectBoardMembers er deterministisk for samme team_id + identity_basis", () => {
  const a = selectBoardMembers({ identityBasis: FRENCH_GC_BASIS, teamId: "team-x" });
  const b = selectBoardMembers({ identityBasis: FRENCH_GC_BASIS, teamId: "team-x" });
  assert.deepEqual(
    a.map((m) => m.archetype_key).sort(),
    b.map((m) => m.archetype_key).sort(),
  );
});

test("assignBoardMembersForTeam er idempotent — skipper hvis 5 members allerede findes", async () => {
  const state = {
    team_board_members: [
      { id: "m1", team_id: "t1", archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 5, is_chairman: false },
      { id: "m2", team_id: "t1", archetype_key: "traditionalisten", selection_kind: "identity", alignment_score: 4, is_chairman: false },
      { id: "m3", team_id: "t1", archetype_key: "pragmatikeren", selection_kind: "identity", alignment_score: 3, is_chairman: true },
      { id: "m4", team_id: "t1", archetype_key: "klassiker_purist", selection_kind: "wildcard", alignment_score: 2, is_chairman: false },
      { id: "m5", team_id: "t1", archetype_key: "gc_elsker", selection_kind: "wildcard", alignment_score: 1, is_chairman: false },
    ],
  };
  const supabase = makeFakeSupabase(state);
  const result = await assignBoardMembersForTeam({
    supabase, teamId: "t1", identityBasis: FRENCH_GC_BASIS,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_assigned");
  assert.equal(state.team_board_members.length, 5, "ingen nye rows tilføjet");
});

test("assignBoardMembersForTeam inserter 5 rows ved første kald", async () => {
  const state = { team_board_members: [] };
  const supabase = makeFakeSupabase(state);
  const result = await assignBoardMembersForTeam({
    supabase, teamId: "t-new", identityBasis: FRENCH_GC_BASIS,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.assigned, 5);
  assert.equal(state.team_board_members.length, 5);
  const chairmenInDb = state.team_board_members.filter((m) => m.is_chairman);
  assert.equal(chairmenInDb.length, 1);
});

test("selectDominantMember bruger category_alignment til at vælge taler", () => {
  const members = [
    { archetype_key: "sponsoraten", is_chairman: false },
    { archetype_key: "resultatjaegeren", is_chairman: false },
    { archetype_key: "pragmatikeren", is_chairman: true },
  ];
  const economyTalker = selectDominantMember({ assignedMembers: members, category: "economy" });
  assert.equal(economyTalker?.key, "sponsoraten", "Sponsoraten ejer økonomi-kategorien");
  const resultsTalker = selectDominantMember({ assignedMembers: members, category: "results" });
  assert.equal(resultsTalker?.key, "resultatjaegeren", "Resultatjægeren ejer results-kategorien");
});

test("selectDominantMember falder tilbage til chairman ved manglende category-match", () => {
  const members = [
    { archetype_key: "sponsoraten", is_chairman: false },
    { archetype_key: "pragmatikeren", is_chairman: true },
  ];
  // Ingen category givet → chairman taler (A6 låst 2026-05-05)
  const speaker = selectDominantMember({ assignedMembers: members, category: null });
  assert.equal(speaker?.key, "pragmatikeren");
});

test("sampleReactionForFeedback vælger feedback_negative for negativ tone", () => {
  const reaction = sampleReactionForFeedback({
    archetype: BOARD_ARCHETYPES.resultatjaegeren,
    tone: "negative",
    seed: "team-x:5yr:0:feedback:negative",
  });
  assert.ok(reaction);
  assert.equal(reaction.bucket, "feedback_negative");
  assert.equal(reaction.archetype_key, "resultatjaegeren");
  assert.ok(BOARD_ARCHETYPES.resultatjaegeren.reactions.feedback_negative.includes(reaction.quote));
});

test("sampleReactionForGoal vælger goal_failure for behind status", () => {
  const reaction = sampleReactionForGoal({
    archetype: BOARD_ARCHETYPES.sponsoraten,
    goalContext: { type: "no_outstanding_debt", status: "behind" },
    seed: "team-x:5yr:0:goal:no_outstanding_debt:behind",
  });
  assert.ok(reaction);
  assert.equal(reaction.bucket, "goal_failure");
});

test("processReplacementTrigger inkrementerer counter ved første lav-sat-udløb", async () => {
  const state = {
    teams: [{
      id: "t1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      consecutive_low_satisfaction_expirations: 0,
      season_1_identity_basis: FRENCH_GC_BASIS,
    }],
    team_board_members: [],
  };
  const supabase = makeFakeSupabase(state);
  const result = await processReplacementTrigger({
    supabase, teamId: "t1", satisfaction: 25, identityBasis: FRENCH_GC_BASIS,
  });
  assert.equal(result.replaced, false);
  assert.equal(result.counter, 1);
  assert.equal(state.teams[0].consecutive_low_satisfaction_expirations, 1);
});

test("processReplacementTrigger nulstiller counter ved sat>=30", async () => {
  const state = {
    teams: [{
      id: "t1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      consecutive_low_satisfaction_expirations: 1,
      season_1_identity_basis: FRENCH_GC_BASIS,
    }],
    team_board_members: [],
  };
  const supabase = makeFakeSupabase(state);
  const result = await processReplacementTrigger({
    supabase, teamId: "t1", satisfaction: 45, identityBasis: FRENCH_GC_BASIS,
  });
  assert.equal(result.replaced, false);
  assert.equal(result.counter, 0);
  assert.equal(state.teams[0].consecutive_low_satisfaction_expirations, 0);
});

test("processReplacementTrigger udskifter formanden når counter rammer threshold", async () => {
  const initialMembers = selectBoardMembers({ identityBasis: FRENCH_GC_BASIS, teamId: "t1" });
  const oldChairman = initialMembers.find((m) => m.is_chairman);
  assert.ok(oldChairman);

  const state = {
    teams: [{
      id: "t1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      consecutive_low_satisfaction_expirations: REPLACEMENT_TRIGGER_THRESHOLD - 1,
      season_1_identity_basis: FRENCH_GC_BASIS,
    }],
    team_board_members: initialMembers.map((m, idx) => ({
      id: `m${idx}`,
      team_id: "t1",
      archetype_key: m.archetype_key,
      selection_kind: m.selection_kind,
      alignment_score: m.alignment_score,
      is_chairman: m.is_chairman,
    })),
  };
  const supabase = makeFakeSupabase(state);
  const result = await processReplacementTrigger({
    supabase, teamId: "t1", satisfaction: 20, identityBasis: FRENCH_GC_BASIS,
  });

  assert.equal(result.replaced, true);
  assert.equal(result.old_chairman_key, oldChairman.archetype_key);
  assert.ok(result.new_chairman_key && result.new_chairman_key !== oldChairman.archetype_key);
  assert.equal(result.counter, 0, "counter resettet efter trigger");
  // Old chairman fjernet, ny chairman tilføjet
  const oldChairmanRow = state.team_board_members.find((m) => m.archetype_key === oldChairman.archetype_key);
  assert.equal(oldChairmanRow, undefined);
  assert.equal(state.team_board_members.length, 5, "stadig 5 medlemmer");
});

test("processReplacementTrigger skipper AI/bank/frozen teams (Q-batch 1A Q8 — manager-only)", async () => {
  const state = {
    teams: [{
      id: "t-ai", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false,
      consecutive_low_satisfaction_expirations: 1,
    }],
    team_board_members: [],
  };
  const supabase = makeFakeSupabase(state);
  const result = await processReplacementTrigger({
    supabase, teamId: "t-ai", satisfaction: 10, identityBasis: FRENCH_GC_BASIS,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.replaced, false);
});

test("startSequentialNegotiation waits to assign board members until DNA is chosen", async () => {
  const state = {
    teams: [
      {
        id: "team-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3,
        season_1_identity_basis: null,
      },
      {
        id: "team-2", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 2,
        season_1_identity_basis: FRENCH_GC_BASIS,
      },
    ],
    riders: [
      { team_id: "team-1", is_u25: true, nationality_code: "DK", uci_points: 100, popularity: 40,
        stat_fl: 60, stat_bj: 60, stat_kb: 60, stat_bk: 60, stat_tt: 60, stat_bro: 60,
        stat_sp: 60, stat_acc: 60, stat_udh: 60, stat_mod: 60, stat_res: 60, stat_ftr: 60 },
    ],
    board_profiles: [
      { id: "bp-1", team_id: "team-1", plan_type: "baseline", is_baseline: true },
      { id: "bp-2", team_id: "team-2", plan_type: "baseline", is_baseline: true },
    ],
    transfer_windows: [
      { id: "tw-new", board_negotiation_state: "locked", created_at: "2026-05-01T00:00:00Z" },
    ],
    team_board_members: [],
  };

  const supabase = makeFakeSupabase(state);
  const result = await startSequentialNegotiation({ supabase });

  assert.equal(result.identity_bases_written, 1, "kun team-1 manglede basis");
  assert.equal(result.board_members_assigned, 0);
  assert.equal(result.window_state, BOARD_NEGOTIATION_STATES.PENDING_5YR);

  const team1Members = state.team_board_members.filter((m) => m.team_id === "team-1");
  const team2Members = state.team_board_members.filter((m) => m.team_id === "team-2");
  assert.equal(team1Members.length, 0);
  assert.equal(team2Members.length, 0);
});

test("regenerateBoardMembersForTeam rebuilds 5 members with selected DNA", async () => {
  const state = {
    team_board_members: [
      { id: "old-1", team_id: "team-1", archetype_key: "gc_elsker", selection_kind: "identity", alignment_score: 4, is_chairman: true },
    ],
  };
  const supabase = makeFakeSupabase(state);

  const result = await regenerateBoardMembersForTeam({
    supabase,
    teamId: "team-1",
    identityBasis: FRENCH_GC_BASIS,
    dnaKey: "italiensk_klassiker",
  });

  assert.equal(result.deleted, 1);
  assert.equal(result.assigned, TEAM_BOARD_MEMBERS_COUNT);
  const members = state.team_board_members.filter((m) => m.team_id === "team-1");
  assert.equal(members.length, TEAM_BOARD_MEMBERS_COUNT);
  assert.equal(members.filter((m) => m.is_chairman).length, 1);
  assert.ok(members.some((m) => m.archetype_key === "klassiker_purist"));
});

test("repairBoardMembersAfterDna is idempotent and skips teams without DNA", async () => {
  const state = {
    teams: [
      { id: "team-1", is_ai: false, is_bank: false, is_frozen: false, season_1_identity_basis: FRENCH_GC_BASIS, team_dna_key: "fransk_klatrer" },
      { id: "team-2", is_ai: false, is_bank: false, is_frozen: false, season_1_identity_basis: FRENCH_GC_BASIS, team_dna_key: null },
      { id: "team-ai", is_ai: true, is_bank: false, is_frozen: false, season_1_identity_basis: FRENCH_GC_BASIS, team_dna_key: "fransk_klatrer" },
    ],
    team_board_members: [
      { id: "old-1", team_id: "team-1", archetype_key: "klassiker_purist", selection_kind: "identity", alignment_score: 4, is_chairman: true },
    ],
  };
  const supabase = makeFakeSupabase(state);

  const summary = await repairBoardMembersAfterDna({ supabase });

  assert.equal(summary.teams_checked, 2);
  assert.equal(summary.teams_repaired, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, TEAM_BOARD_MEMBERS_COUNT);
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-2").length, 0);
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-ai").length, 0);
});

// ─── #878 · chooseDnaForTeam: atomisk + idempotent DNA-valg ──────────────────

test("chooseDnaForTeam (first choice) assigns members and reports chosen key", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: null, team_dna_chosen_at: null, season_1_identity_basis: FRENCH_GC_BASIS }],
    team_board_members: [],
  };
  const supabase = makeFakeSupabase(state);

  const result = await chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "italiensk_klassiker" });

  assert.equal(result.recovered, false);
  assert.equal(result.dnaKey, "italiensk_klassiker");
  assert.equal(result.members.length, TEAM_BOARD_MEMBERS_COUNT);
  assert.equal(state.teams[0].team_dna_key, "italiensk_klassiker");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, TEAM_BOARD_MEMBERS_COUNT);
});

test("chooseDnaForTeam rolls back team_dna_key when member regeneration fails (#878 atomicity)", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: null, team_dna_chosen_at: null, season_1_identity_basis: FRENCH_GC_BASIS }],
    team_board_members: [],
  };
  // Lad insert i team_board_members fejle → regenerateBoardMembersForTeam kaster midt i.
  const supabase = makeFakeSupabase(state, { failInsertOn: "team_board_members" });

  await assert.rejects(
    () => chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "italiensk_klassiker" }),
    /insert blew up/,
  );

  // Teamet må IKKE efterlades dna-sat-men-boardless (ellers låser 409-guarden manageren ude).
  assert.equal(state.teams[0].team_dna_key, null, "team_dna_key skal være rullet tilbage");
  assert.equal(state.teams[0].team_dna_chosen_at, null, "team_dna_chosen_at skal være rullet tilbage");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, 0);
});

test("chooseDnaForTeam is idempotent: recovers a dna-set-but-boardless team with the existing key", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: "fransk_klatrer", team_dna_chosen_at: "2026-06-01T00:00:00Z", season_1_identity_basis: FRENCH_GC_BASIS }],
    team_board_members: [],
  };
  const supabase = makeFakeSupabase(state);

  // Selv om kalderen sender en ANDEN nøgle, skal recovery bruge den allerede valgte.
  const result = await chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "italiensk_klassiker" });

  assert.equal(result.recovered, true);
  assert.equal(result.dnaKey, "fransk_klatrer", "recovery må ikke skifte DNA");
  assert.equal(result.members.length, TEAM_BOARD_MEMBERS_COUNT);
  assert.equal(state.teams[0].team_dna_key, "fransk_klatrer");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, TEAM_BOARD_MEMBERS_COUNT);
});

test("chooseDnaForTeam rejects re-choice once the team has completed its first season (#2022)", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: "fransk_klatrer", team_dna_chosen_at: "2026-06-01T00:00:00Z", season_1_identity_basis: FRENCH_GC_BASIS }],
    // seasons_completed >= 1 → holdet er forbi sin første sæson → DNA er låst.
    board_profiles: [{ id: "bp-1", team_id: "team-1", plan_type: "1yr", seasons_completed: 1 }],
    team_board_members: [
      { id: "m-1", team_id: "team-1", archetype_key: "klassiker_purist", selection_kind: "identity", alignment_score: 4, is_chairman: true },
    ],
  };
  const supabase = makeFakeSupabase(state);

  await assert.rejects(
    () => chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "italiensk_klassiker" }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, "DNA_ALREADY_CHOSEN");
      return true;
    },
  );
  // Uændret: DNA og board står som før.
  assert.equal(state.teams[0].team_dna_key, "fransk_klatrer");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, 1);
});

test("chooseDnaForTeam allows re-choice during the first season and re-assigns members (#2022)", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: "fransk_klatrer", team_dna_chosen_at: "2026-06-01T00:00:00Z", season_1_identity_basis: FRENCH_GC_BASIS }],
    // seasons_completed === 0 → holdet er stadig i sin første sæson → DNA er om-vælgeligt.
    board_profiles: [{ id: "bp-1", team_id: "team-1", plan_type: "1yr", seasons_completed: 0 }],
    team_board_members: [
      { id: "m-1", team_id: "team-1", archetype_key: "klassiker_purist", selection_kind: "identity", alignment_score: 4, is_chairman: true },
    ],
  };
  const supabase = makeFakeSupabase(state);

  const result = await chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "italiensk_klassiker" });

  assert.equal(result.rechosen, true, "et skift i sæson 1 rapporteres som rechosen");
  assert.equal(result.dnaKey, "italiensk_klassiker", "den nye nøgle er valgt");
  assert.equal(state.teams[0].team_dna_key, "italiensk_klassiker", "team_dna_key er opdateret");
  assert.notEqual(state.teams[0].team_dna_chosen_at, "2026-06-01T00:00:00Z", "chosen_at opdateres ved skift");
  // De gamle medlemmer er erstattet af et nyt sæt for den nye DNA.
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, TEAM_BOARD_MEMBERS_COUNT);
  assert.equal(state.team_board_members.some((m) => m.id === "m-1"), false, "gamle medlemmer er ryddet");
});

test("chooseDnaForTeam re-picking the SAME DNA in the first season is an idempotent no-op (#2022)", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: "fransk_klatrer", team_dna_chosen_at: "2026-06-01T00:00:00Z", season_1_identity_basis: FRENCH_GC_BASIS }],
    board_profiles: [{ id: "bp-1", team_id: "team-1", plan_type: "1yr", seasons_completed: 0 }],
    team_board_members: [
      { id: "m-1", team_id: "team-1", archetype_key: "klassiker_purist", selection_kind: "identity", alignment_score: 4, is_chairman: true },
    ],
  };
  const supabase = makeFakeSupabase(state);

  const result = await chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "fransk_klatrer" });

  assert.equal(result.dnaKey, "fransk_klatrer", "DNA er uændret");
  assert.equal(state.teams[0].team_dna_key, "fransk_klatrer");
  assert.equal(state.team_board_members.filter((m) => m.team_id === "team-1").length, TEAM_BOARD_MEMBERS_COUNT);
});

test("chooseDnaForTeam refuses with the season-agnostic code when identity basis is missing (#2022)", async () => {
  const state = {
    teams: [{ id: "team-1", team_dna_key: null, team_dna_chosen_at: null, season_1_identity_basis: null }],
    team_board_members: [],
  };
  const supabase = makeFakeSupabase(state);

  await assert.rejects(
    () => chooseDnaForTeam({ supabase, teamId: "team-1", dnaKey: "italiensk_klassiker" }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.errorCode, "dna_requires_identity_basis", "sæson-agnostisk error-kode, ikke dna_requires_season_1");
      return true;
    },
  );
  assert.equal(state.teams[0].team_dna_key, null);
});

function makeFakeSupabase(state, options = {}) {
  const { failInsertOn = null } = options;
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
        if (filter.type === "gte") return row[filter.column] >= filter.value;
        if (filter.type === "is") return row[filter.column] === filter.value;
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

      if (action === "insert") {
        if (failInsertOn && table === failInsertOn) {
          return Promise.resolve({ data: null, error: { message: "insert blew up" } });
        }
        const newRows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
          id: row.id || `${table}-${Math.random().toString(36).slice(2, 8)}`,
          ...clone(row),
        }));
        rows.push(...newRows);
        return Promise.resolve({ data: clone(newRows), error: null });
      }

      if (action === "upsert") {
        const conflictKeys = (payload?._onConflict || "id").split(",").map((k) => k.trim());
        const data = payload?._payload ?? payload;
        const incoming = Array.isArray(data) ? data : [data];
        const result = [];

        for (const row of incoming) {
          const existing = rows.find((existingRow) =>
            conflictKeys.every((key) => existingRow[key] === row[key])
          );
          if (existing) {
            Object.assign(existing, clone(row));
            result.push(existing);
          } else {
            const inserted = { id: row.id || `${table}-${Math.random().toString(36).slice(2, 8)}`, ...clone(row) };
            rows.push(inserted);
            result.push(inserted);
          }
        }
        return Promise.resolve({ data: clone(result), error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      in(column, values) { filters.push({ type: "in", column, values }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select() { return query; },
      single() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      maybeSingle() {
        return execute().then((result) => ({ data: result.data[0] || null, error: result.error }));
      },
      gte(column, value) { filters.push({ type: "gte", column, value }); return query; },
      is(column, value) { filters.push({ type: "is", column, value }); return query; },
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
        insert(payload) { return makeQuery(table, "insert", payload); },
        upsert(payload, opts = {}) {
          return makeQuery(table, "upsert", { _payload: payload, _onConflict: opts.onConflict });
        },
      };
    },
  };
}
