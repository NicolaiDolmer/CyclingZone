import test from "node:test";
import assert from "node:assert/strict";
import { planBestRoleBackfill, parseArgs } from "./bestRoleBackfill5443.mjs";
import { createFakeSupabase } from "../../lib/testUtils/fakeSupabase.js";

test("backfill reads every page, excludes missing data and never writes", async () => {
  const state = { riders: Array.from({ length: 1003 }, (_, i) => ({ id: `fixture-${String(i).padStart(4, "0")}` })) };
  state.rider_derived_abilities = state.riders.slice(0, -1).map((r) => ({ rider_id: r.id, sprint: 40 }));
  const before = structuredClone(state);
  const db = createFakeSupabase(state);
  const result = await planBestRoleBackfill(db);
  assert.equal(result.scanned, 1003);
  assert.equal(result.planned, 1002);
  assert.equal(result.missing, 1);
  assert.equal(result.written, 0);
  assert.deepEqual(state, before);
  for (const row of result.updates) assert.deepEqual(Object.keys(row).sort(), ["best_role", "best_role_rating", "id"]);
  state.riders = state.riders.map((r) => ({ ...r, ...result.updates.find((u) => u.id === r.id) }));
  assert.equal((await planBestRoleBackfill(db, { compareStored: true })).planned, 0);
});

test("CLI rejects apply and unknown arguments", () => {
  for (const args of [["--apply"], ["--apply=false"], ["--typo"]]) assert.throws(() => parseArgs(args), /read-only/);
  assert.deepEqual(parseArgs([]), { compareStored: false, out: null });
});

test("read failure aborts rather than reporting an empty plan", async () => {
  const db = createFakeSupabase({}, { errors: { riders: { select: "permission denied" } } });
  await assert.rejects(planBestRoleBackfill(db), /permission denied/);
});
