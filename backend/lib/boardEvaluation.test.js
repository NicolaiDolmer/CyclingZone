// #1267 · Tests for results-konkurrencedygtigheds-gulvet (option A).
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBoardOutlook,
  computeResultsCompetitivenessFloor,
  evaluateBoardSeason,
  RESULTS_COMPETITIVENESS_FLOOR_SCALE,
  satisfactionToModifier,
} from "./boardEvaluation.js";

test("#1267 · floor: top-placering → ~fuldt gulv, bund → 0, manglende data → 0", () => {
  // rank 1 af 20 → competitiveness 1.0 → fuldt gulv (×scale).
  assert.equal(
    computeResultsCompetitivenessFloor({ rank_in_division: 1 }, { divisionTeamCount: 20 }),
    RESULTS_COMPETITIVENESS_FLOOR_SCALE,
  );
  // sidsteplads → 0.
  assert.equal(
    computeResultsCompetitivenessFloor({ rank_in_division: 20 }, { divisionTeamCount: 20 }),
    0,
  );
  // midt → mellem 0 og scale.
  const mid = computeResultsCompetitivenessFloor({ rank_in_division: 10 }, { divisionTeamCount: 20 });
  assert.ok(mid > 0 && mid < RESULTS_COMPETITIVENESS_FLOOR_SCALE, `mid floor ${mid} skal være mellem 0 og scale`);
  // manglende standing/division → 0 (intet gulv, uændret adfærd).
  assert.equal(computeResultsCompetitivenessFloor(null, {}), 0);
  assert.equal(computeResultsCompetitivenessFloor({ rank_in_division: 5 }, {}), 0);
});

test("#1267 · floor: divisionTeamCount (fuld, inkl. AI) foretrækkes over divisionManagerCount", () => {
  // rank 13 mod fuld division 26 → competitiveness 0.52; mod human-tælling 20 ville
  // give 0.37. Den fulde tælling skal vinde (rank er mod hele feltet).
  const full = computeResultsCompetitivenessFloor(
    { rank_in_division: 13 },
    { divisionTeamCount: 26, divisionManagerCount: 20 },
  );
  const humanOnly = computeResultsCompetitivenessFloor(
    { rank_in_division: 13 },
    { divisionManagerCount: 20 },
  );
  assert.ok(full > humanOnly, `fuld-divisions-gulv ${full} skal være > human-only ${humanOnly}`);
});

test("#1267 · et vinderløst hold der slutter højt straffes ikke som et bundhold", () => {
  // Samme hold, samme 0 etapesejre — kun placeringen adskiller dem. Det højt-
  // placerede hold skal ende med markant højere satisfaction pga. results-gulvet.
  const board = {
    satisfaction: 50,
    plan_type: "1yr",
    focus: "balanced",
    current_goals: [
      { type: "stage_wins", target: 2, satisfaction_bonus: 10, satisfaction_penalty: 5 },
      { type: "no_outstanding_debt", target: 0, satisfaction_bonus: 12, satisfaction_penalty: 8 },
    ],
  };
  const team = { id: "t", division: 1, sponsor_income: 240000, riders: [] };
  const ctx = () => ({
    planDuration: 1, seasonsCompleted: 1, isFinalSeason: true,
    activeLoanCount: 0, hasSeasonData: true,
    cumulativeStats: { stageWins: 0, gcWins: 0 },
    divisionManagerCount: 20, divisionTeamCount: 26,
  });
  const high = evaluateBoardSeason({
    board, team, context: ctx(),
    standing: { team_id: "t", division: 1, rank_in_division: 2, stage_wins: 0, gc_wins: 0 },
  });
  const low = evaluateBoardSeason({
    board, team, context: ctx(),
    standing: { team_id: "t", division: 1, rank_in_division: 25, stage_wins: 0, gc_wins: 0 },
  });
  assert.ok(
    high.newSatisfaction > low.newSatisfaction + 10,
    `højt-placeret (${high.newSatisfaction}) skal ligge klart over bundhold (${low.newSatisfaction})`,
  );
});

// #2596 · Drift-guard (backend-side): satisfactionToModifier-båndene pinnes mod
// den delte, dokumenterede tabel. SAMME tabel pinnes frontend-side i
// frontend/src/lib/boardUtils.test.js. Ændres ét bånd på én side uden den
// anden, fejler den sides pin — så board.budget_modifier og frontendens
// forklaringstekst (#2307) ikke kan drifte fra hinanden.
test("#2596 · satisfactionToModifier: bånd-tabel (autoritativ, matcher frontend-pin)", () => {
  const expected = [
    [-10, 0.80], [0, 0.80], [19, 0.80],
    [20, 0.90], [21, 0.90], [39, 0.90],
    [40, 1.00], [41, 1.00], [59, 1.00],
    [60, 1.10], [61, 1.10], [79, 1.10],
    [80, 1.20], [81, 1.20], [100, 1.20], [150, 1.20],
  ];
  for (const [satisfaction, modifier] of expected) {
    assert.equal(
      satisfactionToModifier(satisfaction),
      modifier,
      `satisfaction=${satisfaction}: backend satisfactionToModifier divergerer fra delt bånd-tabel`,
    );
  }
});

// ── #4556 S-M2b addendum ("Stemme-kontrakten" punkt 2) ───────────────────────
// buildBoardOutlook skal berige dominant_member/member_reaction med
// full_name+initials når context.teamId er sat (samme determinisme-nøgle som
// Boardroom-siden), og ALDRIG opfinde et navn når teamId mangler.

const NAME_TEST_MEMBERS = [
  { archetype_key: "sponsoraten", is_chairman: true },
  { archetype_key: "ungdomsidealisten", is_chairman: false },
  { archetype_key: "resultatjaegeren", is_chairman: false },
];

function buildNameTestOutlook(context = {}) {
  const board = {
    satisfaction: 50,
    plan_type: "1yr",
    focus: "balanced",
    current_goals: [
      { type: "stage_wins", target: 2, satisfaction_bonus: 10, satisfaction_penalty: 5 },
      { type: "no_outstanding_debt", target: 0, satisfaction_bonus: 12, satisfaction_penalty: 8 },
    ],
  };
  const team = { id: "t-name-test", division: 1, sponsor_income: 240000, riders: [] };
  const standing = { team_id: "t-name-test", division: 1, rank_in_division: 2, stage_wins: 1, gc_wins: 0 };
  return buildBoardOutlook({
    board,
    standing,
    team,
    context: {
      planDuration: 1, seasonsCompleted: 1, isFinalSeason: true,
      activeLoanCount: 0, hasSeasonData: true,
      cumulativeStats: { stageWins: 0, gcWins: 0 },
      assignedMembers: NAME_TEST_MEMBERS,
      ...context,
    },
  });
}

test("#4556 · buildBoardOutlook beriger dominant_member + member_reaction med full_name/initials naar teamId er sat", () => {
  const outlook = buildNameTestOutlook({ teamId: "team-4556-a", dnaKey: "italiensk_klassiker" });

  assert.ok(outlook.feedback.dominant_member, "dominant_member skal vaere sat");
  assert.ok(outlook.feedback.dominant_member.full_name, "dominant_member skal have full_name");
  assert.equal(outlook.feedback.dominant_member.initials.length, 2);

  const evaluationWithReaction = outlook.goal_evaluations.find((e) => e.member_reaction);
  assert.ok(evaluationWithReaction, "mindst ét mål skal have member_reaction");
  assert.ok(evaluationWithReaction.member_reaction.full_name, "member_reaction skal have full_name");
  assert.equal(evaluationWithReaction.member_reaction.initials.length, 2);
});

test("#4556 · buildBoardOutlook-navngivning er deterministisk pr. (teamId, archetype_key, dnaKey)", () => {
  const a = buildNameTestOutlook({ teamId: "team-4556-stable", dnaKey: "fransk_klatrer" });
  const b = buildNameTestOutlook({ teamId: "team-4556-stable", dnaKey: "fransk_klatrer" });
  assert.equal(a.feedback.dominant_member.full_name, b.feedback.dominant_member.full_name);
  assert.equal(a.feedback.dominant_member.initials, b.feedback.dominant_member.initials);
});

test("#4556 · buildBoardOutlook opfinder ALDRIG et navn naar teamId mangler i konteksten", () => {
  const outlook = buildNameTestOutlook({}); // ingen teamId

  assert.ok(outlook.feedback.dominant_member, "dominant_member skal stadig vaere sat (label alene)");
  assert.equal(outlook.feedback.dominant_member.full_name, undefined, "intet teamId => intet opfundet navn");
  assert.ok(outlook.feedback.dominant_member.label, "label skal stadig vaere til stede som fallback");

  const evaluationWithReaction = outlook.goal_evaluations.find((e) => e.member_reaction);
  assert.ok(evaluationWithReaction, "mindst ét mål skal have member_reaction");
  assert.equal(evaluationWithReaction.member_reaction.full_name, undefined, "intet teamId => intet opfundet navn");
});
