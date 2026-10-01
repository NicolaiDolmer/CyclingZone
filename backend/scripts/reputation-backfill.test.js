import test from "node:test";
import assert from "node:assert/strict";
import { planBackfill, applyBackfill } from "./reputation-backfill.js";

test("#5828 backfill refreshes riders without race events as well as winners", async () => {
  const replay = {
    events: [{ rider_id: "winner", event_kind: "stage_win" }],
    byRider: new Map([["winner", [{}]]]),
    perSeasonClass: [],
    racesWithEvents: 1,
    skippedResults: 0,
    races: [{}],
    seasons: [{ id: "s4", number: 4 }],
    activeSeason: { number: 4 },
  };
  const plan = await planBackfill({
    supabase: {},
    replayFn: async () => replay,
    fetchRiderIds: async () => ["winner", "no-events"],
  });
  assert.deepEqual(plan.riderIds, ["winner", "no-events"]);
  assert.equal(plan.riders_to_refresh, 2);

  const refreshed = [];
  const result = await applyBackfill({
    supabase: {},
    plan,
    persistEvents: async () => ({ inserted: 1, deduped: 0 }),
    refreshRiders: async ({ riderIds }) => {
      refreshed.push(...riderIds);
      return { updated: riderIds.length };
    },
  });
  assert.deepEqual(refreshed, ["winner", "no-events"]);
  assert.equal(result.ridersUpdated, 2);
});
