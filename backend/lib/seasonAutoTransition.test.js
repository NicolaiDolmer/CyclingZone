import test from "node:test";
import assert from "node:assert/strict";

import { processSeasonAutoTransitionCron } from "./seasonAutoTransition.js";

// Mock builder for transfer_windows query with .eq, .not, .order, .limit, .maybeSingle.
function makeWindowQuery(windowRow) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    not() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle: () => Promise.resolve({ data: windowRow, error: null }),
  };
  return builder;
}

function makeSeasonQuery(seasonRow) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    maybeSingle: () => Promise.resolve({ data: seasonRow, error: null }),
  };
  return builder;
}

function makeSupabase({ window: w, season: s }) {
  return {
    from(table) {
      if (table === "transfer_windows") return makeWindowQuery(w);
      if (table === "seasons") return makeSeasonQuery(s);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("processSeasonAutoTransitionCron: no wrapped window → no-op", async () => {
  const supabase = makeSupabase({ window: null, season: null });
  let transitionCalled = false;
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { transitionCalled = true; return { ok: true }; },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "no_wrapped_window");
  assert.equal(transitionCalled, false);
});

test("processSeasonAutoTransitionCron: window without season_id → no-op", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: null, status: "closed", final_whistle_sent_at: "x", squad_enforcement_completed_at: "y" },
    season: null,
  });
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "no_season_id");
});

test("processSeasonAutoTransitionCron: season already completed → no-op (idempotent)", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: "s0", status: "closed", final_whistle_sent_at: "x", squad_enforcement_completed_at: "y" },
    season: { id: "s0", number: 0, status: "completed" },
  });
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "season_status_completed");
});

test("processSeasonAutoTransitionCron: season not found → no-op", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: "ghost", status: "closed", final_whistle_sent_at: "x", squad_enforcement_completed_at: "y" },
    season: null,
  });
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "season_not_found");
});

test("processSeasonAutoTransitionCron: all flags set + season active → transitions", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: "s0", status: "closed", final_whistle_sent_at: "2026-05-21T21:00Z", squad_enforcement_completed_at: "2026-05-21T21:05Z" },
    season: { id: "s0", number: 0, status: "active" },
  });
  const capturedArgs = [];
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async (args) => {
      capturedArgs.push(args);
      return { ok: true, log: [{ phase: "insert_next_season", inserted: true }] };
    },
  });
  assert.equal(result.transitioned, true);
  assert.equal(result.fromSeason, 0);
  assert.equal(result.toSeason, 1);
  assert.equal(capturedArgs.length, 1);
  assert.equal(capturedArgs[0].fromSeasonId, "s0");
  assert.ok(capturedArgs[0].transitionAt instanceof Date);
});

test("processSeasonAutoTransitionCron: rejects missing supabase client", async () => {
  await assert.rejects(
    () => processSeasonAutoTransitionCron({ supabase: null }),
    /Supabase client required/
  );
});
