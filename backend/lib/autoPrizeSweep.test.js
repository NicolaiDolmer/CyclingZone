import test from "node:test";
import assert from "node:assert/strict";

import { runAutoPrizeSweep } from "./autoPrizeSweep.js";
import { FINANCE_ACTOR_TYPE } from "./economyConstants.js";

test("runAutoPrizeSweep: skip når flag OFF", async () => {
  const r = await runAutoPrizeSweep({
    supabase: {},
    isEnabled: async () => false,
    payFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.deepEqual(r, { paid: 0, skipped: "flag_off" });
});

test("runAutoPrizeSweep: skip når ingen aktiv sæson", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  };
  const r = await runAutoPrizeSweep({
    supabase,
    isEnabled: async () => true,
    payFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.deepEqual(r, { paid: 0, skipped: "no_active_season" });
});

test("runAutoPrizeSweep: kalder payFn med aktiv sæson + actorType SYSTEM", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1" }, error: null }) }) }),
    }),
  };
  let called = null;
  const payFn = async (seasonId, actorId, sb, opts) => {
    called = { seasonId, actorId, opts };
    return { races_paid: 2, total_paid: 5000 };
  };
  const sponsorFn = async () => ({ credited: 0 });
  const r = await runAutoPrizeSweep({ supabase, isEnabled: async () => true, payFn, sponsorFn });

  assert.equal(called.seasonId, "s1");
  assert.equal(called.actorId, null);
  assert.equal(called.opts.actorType, FINANCE_ACTOR_TYPE.SYSTEM);
  assert.equal(r.paid, 2);
  assert.equal(r.total, 5000);
});

test("runAutoPrizeSweep: kalder sponsorFn med aktiv sæson + actorType SYSTEM", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1" }, error: null }) }) }),
    }),
  };
  let sponsorCalled = null;
  const payFn = async () => ({ races_paid: 0, total_paid: 0 });
  const sponsorFn = async (seasonId, sb, opts) => {
    sponsorCalled = { seasonId, opts };
    return { credited: 3 };
  };
  const r = await runAutoPrizeSweep({ supabase, isEnabled: async () => true, payFn, sponsorFn });

  assert.equal(sponsorCalled.seasonId, "s1");
  assert.equal(sponsorCalled.opts.actorType, FINANCE_ACTOR_TYPE.SYSTEM);
  assert.equal(r.sponsor_credited, 3);
});

test("runAutoPrizeSweep: kaster hvis seasons-query fejler", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }),
    }),
  };
  await assert.rejects(
    () => runAutoPrizeSweep({ supabase, isEnabled: async () => true, payFn: async () => ({}) }),
    /seasons: boom/
  );
});
