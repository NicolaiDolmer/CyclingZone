import test from "node:test";
import assert from "node:assert/strict";
import { planYouthPoolReplacements } from "./youthPoolReplacementPlan.js";

const team = (id, extra = {}) => ({
  id, is_ai: true, user_id: null, is_bank: false, is_frozen: false,
  is_test_account: false, parked_at: null, retired_at: null,
  pending_removal_at: null, league_division_id: 10,
  u23_league_division_id: null, junior_league_division_id: null,
  u23Riders: 8, juniorRiders: 8, futureYouthEntries: 0,
  ...extra,
});

test("#4753 dry-run gives the retired ghost and race-bound club distinct safe AI reserves", () => {
  const targets = [
    team("ghost", { retired_at: "2026-09-28T08:00:00Z", league_division_id: null, u23_league_division_id: 21, junior_league_division_id: 33, futureEntries: 0 }),
    team("racing", { pending_removal_at: "2026-09-28T20:00:00Z", u23_league_division_id: 22, junior_league_division_id: 34, blockingRaces: [{ lastScheduledAt: "2026-10-01T12:30:00Z" }] }),
  ];
  const candidates = [
    team("a-future", { futureYouthEntries: 1 }),
    team("b-too-small", { juniorRiders: 5 }),
    team("c-spare"),
    team("d-spare"),
  ];
  const plan = planYouthPoolReplacements({ targets, candidates, groupCounts: new Map([[21, 24], [33, 24], [22, 24], [34, 24]]) });
  assert.deepEqual(plan.repairs.map((r) => [r.targetId, r.replacementId, r.when]), [
    ["ghost", "c-spare", "owner_go_now"],
    ["racing", "d-spare", "after_last_race"],
  ]);
  assert.equal(plan.repairs[1].lastScheduledAt, "2026-10-01T12:30:00Z");
  assert.deepEqual(plan.blockers, []);
});

test("#4753 dry-run fails closed on a changed group or no second reserve", () => {
  const targets = [
    team("ghost", { retired_at: "2026-09-28T08:00:00Z", u23_league_division_id: 21, junior_league_division_id: 33, futureEntries: 0 }),
    team("racing", { pending_removal_at: "2026-09-28T20:00:00Z", u23_league_division_id: 22, junior_league_division_id: 34, blockingRaces: [{ lastScheduledAt: "2026-10-01T12:30:00Z" }] }),
  ];
  const plan = planYouthPoolReplacements({ targets, candidates: [team("only-spare")], groupCounts: new Map([[21, 24], [33, 24], [22, 23], [34, 24]]) });
  assert.equal(plan.repairs.length, 1);
  assert.deepEqual(plan.blockers.map((b) => b.reason), ["group_size_changed"]);
});

test("#4753 dry-run never moves a manager or retires a club still racing", () => {
  const plan = planYouthPoolReplacements({
    targets: [team("human", { is_ai: false, retired_at: "2026-09-28T08:00:00Z", u23_league_division_id: 21 })],
    candidates: [team("spare")], groupCounts: new Map([[21, 24]]),
  });
  assert.equal(plan.repairs.length, 0);
  assert.deepEqual(plan.blockers.map((b) => b.reason), ["not_ai"]);
});
