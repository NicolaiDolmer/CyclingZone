import assert from "node:assert/strict";
import test from "node:test";
import { boardJudgmentHold } from "./boardComeback.js";

test("a parked team remains exempt even after an earlier comeback", () => {
  assert.equal(boardJudgmentHold({ parked_at: "2026-11-24", comeback_season_id: "S5" }, "S6", 6), "parked_team");
});

test("a midseason comeback is exempt only for the season it returns in", () => {
  const team = { parked_at: null, comeback_season_id: "S5" };
  assert.equal(boardJudgmentHold(team, "S5", 5), "comeback_season");
  assert.equal(boardJudgmentHold(team, "S6", 6), null);
});

test("a season-change comeback uses the receiving season, including before its row exists", () => {
  const team = { parked_at: null, comeback_board_season_number: 6 };
  assert.equal(boardJudgmentHold(team, "S5", 5), "comeback_season");
  assert.equal(boardJudgmentHold(team, "S6", 6), "comeback_season");
  assert.equal(boardJudgmentHold(team, "S7", 7), null);
});

test("the legacy season id can identify a later comeback during rollout", () => {
  const team = { parked_at: null, comeback_board_season_number: 4, comeback_season_id: "S6" };
  assert.equal(boardJudgmentHold(team, "S6", 6), "comeback_season");
});
