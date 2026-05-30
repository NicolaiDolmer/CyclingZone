// #805 · Tests for board test-mode helper.

import test from "node:test";
import assert from "node:assert/strict";

import { isBoardTestModeActive, setLatestWindowTestMode } from "./boardTestMode.js";

// Minimal fake supabase: én tabel (transfer_windows) med order/limit/maybeSingle + update.
function makeFakeSupabase(windows = []) {
  const state = { transfer_windows: windows.map((w) => ({ ...w })) };

  function makeQuery(table) {
    let descByCreated = false;
    let limitN = Infinity;
    const filters = [];
    let updatePayload = null;
    let isUpdate = false;

    function rows() {
      let r = state[table].filter((row) =>
        filters.every((f) => row[f.column] === f.value)
      );
      if (descByCreated) {
        r = [...r].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      }
      if (limitN !== Infinity) r = r.slice(0, limitN);
      return r;
    }

    const query = {
      select() { return query; },
      eq(column, value) { filters.push({ column, value }); return query; },
      order(column, opts) { if (column === "created_at") descByCreated = !opts?.ascending; return query; },
      limit(n) { limitN = n; return query; },
      update(payload) { isUpdate = true; updatePayload = payload; return query; },
      maybeSingle() {
        const r = rows();
        return Promise.resolve({ data: r[0] || null, error: null });
      },
      then(resolve, reject) {
        if (isUpdate) {
          for (const row of state[table]) {
            if (filters.every((f) => row[f.column] === f.value)) Object.assign(row, updatePayload);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    state,
    from(table) {
      if (!state[table]) state[table] = [];
      return {
        select() { return makeQuery(table).select(); },
        update(payload) { return makeQuery(table).update(payload); },
      };
    },
  };
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
