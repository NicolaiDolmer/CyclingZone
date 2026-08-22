import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTeamOrder,
  mergeOrderWithRoster,
  stanceI18nKey,
  effortCounts,
  setRiderEffort,
  toggleTryBreak,
  setBreakawayStance,
  isOrderLocked,
  teamPlanKey,
} from "./tacticsPlan.js";

test("defaultTeamOrder — neutrale defaults for hver rytter (T4)", () => {
  const order = defaultTeamOrder(["r1", "r2"]);
  assert.equal(order.breakaway_stance, "neutral");
  assert.deepEqual(order.riders, [
    { rider_id: "r1", effort: "normal", try_break: false },
    { rider_id: "r2", effort: "normal", try_break: false },
  ]);
});

test("mergeOrderWithRoster — beholder kendte ordrer, tilføjer neutrale for nye ryttere", () => {
  const saved = { team_id: "t1", breakaway_stance: "chase", riders: [{ rider_id: "r1", effort: "protect", try_break: true }] };
  const merged = mergeOrderWithRoster(saved, ["r1", "r2"]);
  assert.equal(merged.breakaway_stance, "chase");
  assert.deepEqual(merged.riders, [
    { rider_id: "r1", effort: "protect", try_break: true },
    { rider_id: "r2", effort: "normal", try_break: false },
  ]);
});

test("mergeOrderWithRoster — dropper ryttere der ikke længere er i truppen", () => {
  const saved = { team_id: "t1", breakaway_stance: "neutral", riders: [{ rider_id: "r1", effort: "save", try_break: false }] };
  const merged = mergeOrderWithRoster(saved, ["r2"]);
  assert.equal(merged.riders.length, 1);
  assert.equal(merged.riders[0].rider_id, "r2");
});

test("stanceI18nKey — let_go mappes til letGo, resten uændret", () => {
  assert.equal(stanceI18nKey("let_go"), "letGo");
  assert.equal(stanceI18nKey("chase"), "chase");
  assert.equal(stanceI18nKey("neutral"), "neutral");
});

test("effortCounts — tæller pr. niveau", () => {
  const riders = [
    { rider_id: "a", effort: "protect" },
    { rider_id: "b", effort: "normal" },
    { rider_id: "c", effort: "normal" },
    { rider_id: "d", effort: "save" },
  ];
  assert.deepEqual(effortCounts(riders), { protect: 1, normal: 2, save: 1 });
});

test("setRiderEffort / toggleTryBreak / setBreakawayStance — muterer aldrig input", () => {
  const order = defaultTeamOrder(["r1", "r2"]);
  const withEffort = setRiderEffort(order, "r1", "protect");
  assert.equal(order.riders[0].effort, "normal", "originalen er urørt");
  assert.equal(withEffort.riders[0].effort, "protect");

  const withBreak = toggleTryBreak(withEffort, "r2");
  assert.equal(withBreak.riders[1].try_break, true);
  const toggledBack = toggleTryBreak(withBreak, "r2");
  assert.equal(toggledBack.riders[1].try_break, false);

  const withStance = setBreakawayStance(order, "let_go");
  assert.equal(withStance.breakaway_stance, "let_go");
  assert.equal(order.breakaway_stance, "neutral", "originalen er urørt");
});

test("isOrderLocked — sammenligner mod now, ingen lock-tid = ulåst", () => {
  assert.equal(isOrderLocked(null, 1000), false);
  assert.equal(isOrderLocked("2026-08-25T09:00:00.000Z", new Date("2026-08-25T08:00:00.000Z").getTime()), false);
  assert.equal(isOrderLocked("2026-08-25T09:00:00.000Z", new Date("2026-08-25T09:00:00.000Z").getTime()), true);
  assert.equal(isOrderLocked("2026-08-25T09:00:00.000Z", new Date("2026-08-25T10:00:00.000Z").getTime()), true);
});

test("teamPlanKey — ingen kaptajn giver noCaptain-nøglen uden params", () => {
  assert.deepEqual(teamPlanKey("chase", null), { key: "tacticsOrders.plan.noCaptain", params: {} });
});

test("teamPlanKey — stance + kaptajnnavn giver den rette planbesked-nøgle", () => {
  assert.deepEqual(teamPlanKey("let_go", "Ada Pedersen"), { key: "tacticsOrders.plan.letGo", params: { captain: "Ada Pedersen" } });
  assert.deepEqual(teamPlanKey("neutral", "Mikkel Hansen"), { key: "tacticsOrders.plan.neutral", params: { captain: "Mikkel Hansen" } });
});
