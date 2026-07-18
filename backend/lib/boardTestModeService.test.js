// #805 · Tests for board test-mode orkestrering (open/close).

import test from "node:test";
import assert from "node:assert/strict";

import { openBoardTestMode, openBoardLive, closeBoardTestMode } from "./boardTestModeService.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

// #2598 · openBoardTestMode/openBoardLive delegerer alt supabase-arbejde til
// injicerede deps (resetBetaBoardProfiles/startSequentialNegotiation/
// setLatestWindowTestMode) — selve klienten rører intet direkte, den skal
// blot bestå `supabase?.from`-guarden. Delt fake bruges for konsistens.
const fakeSupabase = createFakeSupabase({});

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
  // #2598 · Delt fake: setLatestWindowTestMode læser seneste window (order+
  // limit+maybeSingle) og opdaterer board_test_mode via .update().eq(id).
  const supabase = createFakeSupabase({ transfer_windows: [{ id: "w-1", created_at: "2026-01-01", board_test_mode: true }] });

  const result = await closeBoardTestMode(supabase);
  assert.equal(result.ok, true);
  assert.equal(result.board_test_mode, false);
  assert.equal(supabase.state.transfer_windows[0].board_test_mode, false);
});
