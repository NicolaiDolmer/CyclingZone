// #805 · Tests for board test-mode helper.

import test from "node:test";
import assert from "node:assert/strict";

import { isBoardTestModeActive, setLatestWindowTestMode } from "./boardTestMode.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

// #2598 · Delt, projektion-aware fake (backend/lib/testUtils/fakeSupabase.js)
// erstatter den tidligere lokale, ikke-projicerende variant.
function makeFakeSupabase(windows = []) {
  return createFakeSupabase({ transfer_windows: windows.map((w) => ({ ...w })) });
}

test("isBoardTestModeActive returns false when no windows exist", async () => {
  const supabase = makeFakeSupabase([]);
  assert.equal(await isBoardTestModeActive(supabase), false);
});

test("isBoardTestModeActive returns true when latest window has board_test_mode", async () => {
  const supabase = makeFakeSupabase([
    { id: "w-1", created_at: "2026-01-01", board_test_mode: false },
    { id: "w-2", created_at: "2026-02-01", board_test_mode: true },
  ]);
  assert.equal(await isBoardTestModeActive(supabase), true);
});

test("isBoardTestModeActive reads the LATEST window only", async () => {
  // Seneste window (w-2) har test-mode false → false selv om et ældre window er true.
  const supabase = makeFakeSupabase([
    { id: "w-1", created_at: "2026-01-01", board_test_mode: true },
    { id: "w-2", created_at: "2026-02-01", board_test_mode: false },
  ]);
  assert.equal(await isBoardTestModeActive(supabase), false);
});

test("isBoardTestModeActive is defensive against a null client", async () => {
  assert.equal(await isBoardTestModeActive(null), false);
  assert.equal(await isBoardTestModeActive({}), false);
});

test("setLatestWindowTestMode flips the latest window flag", async () => {
  const supabase = makeFakeSupabase([
    { id: "w-1", created_at: "2026-01-01", board_test_mode: false },
    { id: "w-2", created_at: "2026-02-01", board_test_mode: false },
  ]);
  const result = await setLatestWindowTestMode(supabase, true);
  assert.equal(result.window_id, "w-2");
  assert.equal(result.board_test_mode, true);
  assert.equal(supabase.state.transfer_windows.find((w) => w.id === "w-2").board_test_mode, true);
  assert.equal(supabase.state.transfer_windows.find((w) => w.id === "w-1").board_test_mode, false);
});

test("setLatestWindowTestMode is a no-op when no window exists", async () => {
  const supabase = makeFakeSupabase([]);
  const result = await setLatestWindowTestMode(supabase, true);
  assert.equal(result.window_id, null);
});
