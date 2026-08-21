// Tests for teamOrdersAdapter (#4030/#3855) — DB-raekker → StageInput.orders.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowToTacticsOrder,
  toEngineTeamOrder,
  buildStageOrders,
  neutralOrder,
} from "./teamOrdersAdapter.ts";

test("rowToTacticsOrder: gyldig raekke oversaettes 1:1", () => {
  const o = rowToTacticsOrder({
    team_id: "t1",
    stage_number: 3,
    breakaway_stance: "let_go",
    riders: [{ rider_id: "r1", race_role: "captain", effort: "protect", try_break: true }],
  });
  assert.deepEqual(o, {
    team_id: "t1",
    breakaway_stance: "let_go",
    riders: [{ rider_id: "r1", race_role: "captain", effort: "protect", try_break: true }],
  });
});

test("rowToTacticsOrder: defensiv mod jsonb-drift (korrupt raekke vaelter aldrig sim)", () => {
  const o = rowToTacticsOrder({
    team_id: "t1",
    stage_number: 1,
    breakaway_stance: "ATTACK!!",
    riders: [
      null,
      42,
      { race_role: "helper" }, // mangler rider_id → droppes
      { rider_id: "r9", race_role: 7, effort: "turbo", try_break: "ja" },
    ],
  });
  assert.equal(o.breakaway_stance, "neutral");
  assert.deepEqual(o.riders, [{ rider_id: "r9", race_role: "helper", effort: "normal", try_break: false }]);
});

test("toEngineTeamOrder: pakker T3-formen i placeholder-kontrakten (kind=team_tactics)", () => {
  const eng = toEngineTeamOrder(neutralOrder("t1"));
  assert.equal(eng.team_id, "t1");
  assert.equal(eng.kind, "team_tactics");
  assert.deepEqual(eng.params, { breakaway_stance: "neutral", riders: [] });
});

test("buildStageOrders: T4-default for hold uden raekke, fremmede hold droppes, etape-filter", () => {
  const rows = [
    { team_id: "t1", stage_number: 2, breakaway_stance: "chase", riders: [] },
    { team_id: "t1", stage_number: 3, breakaway_stance: "let_go", riders: [] }, // anden etape → ignoreres
    { team_id: "ukendt", stage_number: 2, breakaway_stance: "chase", riders: [] }, // ikke i startlisten
  ];
  const orders = buildStageOrders({ rows, stageNumber: 2, teamIdsInStartlist: ["t1", "t2"] });
  assert.equal(orders.length, 2);
  assert.equal((orders[0].params as { breakaway_stance: string }).breakaway_stance, "chase");
  assert.equal(orders[1].team_id, "t2");
  assert.equal((orders[1].params as { breakaway_stance: string }).breakaway_stance, "neutral");
});

test("buildStageOrders: deterministisk orden = startlistens holdorden", () => {
  const orders = buildStageOrders({ rows: [], stageNumber: 1, teamIdsInStartlist: ["b", "a", "c"] });
  assert.deepEqual(orders.map((o) => o.team_id), ["b", "a", "c"]);
});
