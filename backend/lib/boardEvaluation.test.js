// #1267 · Tests for results-konkurrencedygtigheds-gulvet (option A).
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeResultsCompetitivenessFloor,
  evaluateBoardSeason,
  RESULTS_COMPETITIVENESS_FLOOR_SCALE,
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
