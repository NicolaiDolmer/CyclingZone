import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBoardOutlook,
  buildBoardProposal,
  buildBoardRequestOptions,
  deriveBoardPersonality,
  evaluateBoardSeason,
  finalizeBoardGoals,
  inferNegotiationIndexesFromGoals,
  resolveBoardRequest,
} from "./boardEngine.js";

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
