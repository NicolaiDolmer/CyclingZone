// #805 · Tests for board test-mode orkestrering (open/close).

import test from "node:test";
import assert from "node:assert/strict";

import { openBoardTestMode, openBoardLive, closeBoardTestMode } from "./boardTestModeService.js";

const fakeSupabase = { from() { return {}; } };

test("openBoardTestMode kører reset → onboarding → set-flag i den rækkefølge", async () => {
  const order = [];
  const result = await openBoardTestMode(fakeSupabase, {
    resetBetaBoardProfiles: async () => { order.push("reset"); return { reset: 23, created: 23 }; },
    startSequentialNegotiation: async () => { order.push("onboarding"); return { baseline_rows_deleted: 23, window_state: "pending_5yr" }; },
    setLatestWindowTestMode: async (_sb, value) => { order.push(`flag:${value}`); return { window_id: "w-1", board_test_mode: value }; },
  });

  // Flaget SKAL sættes sidst — ellers ville økonomi-frysning slå til midt i reset.
  assert.deepEqual(order, ["reset", "onboarding", "flag:true"]);
  assert.equal(result.ok, true);
  assert.equal(result.board_test_mode, true);
  assert.equal(result.window_id, "w-1");
  assert.equal(result.board_profiles_reset.reset, 23);
  assert.equal(result.negotiation.window_state, "pending_5yr");
});

test("openBoardTestMode kræver en supabase-client", async () => {
  await assert.rejects(() => openBoardTestMode(null), /Supabase client is required/);
});

test("openBoardLive kører samme sekvens men med flag:false (ægte økonomi)", async () => {
  const order = [];
  const result = await openBoardLive(fakeSupabase, {
    resetBetaBoardProfiles: async () => { order.push("reset"); return { reset: 23, created: 23 }; },
    startSequentialNegotiation: async () => { order.push("onboarding"); return { baseline_rows_deleted: 23, window_state: "pending_5yr" }; },
    setLatestWindowTestMode: async (_sb, value) => { order.push(`flag:${value}`); return { window_id: "w-1", board_test_mode: value }; },
  });

  // Samme rækkefølge som test-varianten, men flaget sættes til false → ingen økonomi-frysning.
  assert.deepEqual(order, ["reset", "onboarding", "flag:false"]);
  assert.equal(result.ok, true);
  assert.equal(result.board_test_mode, false);
  assert.equal(result.window_id, "w-1");
  assert.equal(result.negotiation.window_state, "pending_5yr");
});

test("openBoardLive kræver en supabase-client", async () => {
  await assert.rejects(() => openBoardLive(null), /Supabase client is required/);
});

test("closeBoardTestMode sætter flaget til false (idempotent rollback)", async () => {
  let captured = null;
  const supabase = {
    from() {
      return {
        select() { return { order() { return { limit() { return { maybeSingle: () => Promise.resolve({ data: { id: "w-1" }, error: null }) }; } }; } }; },
        update(payload) { captured = payload; return { eq: () => Promise.resolve({ error: null }) }; },
      };
    },
  };

  const result = await closeBoardTestMode(supabase);
  assert.equal(result.ok, true);
  assert.equal(result.board_test_mode, false);
  assert.deepEqual(captured, { board_test_mode: false });
});
