import test from "node:test";
import assert from "node:assert/strict";

import { retireLegacyRiders, reactivateLegacyRiders } from "./legacyRiderRetirement.js";

// Mock der fanger update-kæden (.update().not().select()) og count-kæden
// (.select(_, {count,head}).not().is()). Returnerer konfigurerbare resultater.
function makeMock({ updateData = [], count = 0 } = {}) {
  const calls = { updates: [], counts: [] };
  const supabase = {
    from() {
      return {
        update(patch) {
          return {
            not(col, op, val) {
              return {
                select() {
                  calls.updates.push({ patch, col, op, val });
                  return Promise.resolve({ data: updateData, error: null });
                },
              };
            },
          };
        },
        select(_cols, opts) {
          return {
            not(col, op, val) {
              return {
                is(isCol, isVal) {
                  calls.counts.push({ opts, col, op, val, isCol, isVal });
                  return Promise.resolve({ count, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { supabase, calls };
}

test("retireLegacyRiders (apply) sætter is_retired+team_id=null kun for pcm_id IS NOT NULL", async () => {
  const { supabase, calls } = makeMock({ updateData: [{ id: "a" }, { id: "b" }] });
  const res = await retireLegacyRiders(supabase, { dryRun: false });
  assert.equal(res.retired, 2);
  assert.deepEqual(calls.updates[0].patch, { is_retired: true, team_id: null });
  assert.equal(calls.updates[0].col, "pcm_id");
  assert.equal(calls.updates[0].op, "is");
  assert.equal(calls.updates[0].val, null);
});

test("retireLegacyRiders (dryRun) tæller aktive legacy uden writes", async () => {
  const { supabase, calls } = makeMock({ count: 8969 });
  const res = await retireLegacyRiders(supabase, { dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.wouldRetire, 8969);
  assert.equal(calls.updates.length, 0, "ingen update i dry-run");
  assert.equal(calls.counts[0].isCol, "is_retired");
  assert.equal(calls.counts[0].isVal, false);
});

test("reactivateLegacyRiders (apply) un-retirer pcm_id IS NOT NULL (rollback)", async () => {
  const { supabase, calls } = makeMock({ updateData: [{ id: "a" }] });
  const res = await reactivateLegacyRiders(supabase, { dryRun: false });
  assert.equal(res.reactivated, 1);
  assert.deepEqual(calls.updates[0].patch, { is_retired: false });
  assert.equal(calls.updates[0].col, "pcm_id");
});

test("reactivateLegacyRiders (dryRun) tæller retirede legacy uden writes", async () => {
  const { supabase, calls } = makeMock({ count: 8969 });
  const res = await reactivateLegacyRiders(supabase, { dryRun: true });
  assert.equal(res.wouldReactivate, 8969);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.counts[0].isVal, true);
});

test("kaster hvis supabase-klient mangler", async () => {
  await assert.rejects(() => retireLegacyRiders(null, { dryRun: true }), /client required/);
});
