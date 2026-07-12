import test from "node:test";
import assert from "node:assert/strict";

import { runRaceEntryGeneratorSweep } from "./raceEntryGeneratorSweep.js";

test("runRaceEntryGeneratorSweep: skip når flag OFF", async () => {
  const r = await runRaceEntryGeneratorSweep({
    supabase: {},
    isEnabled: async () => false,
    runGeneratorFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
});

test("runRaceEntryGeneratorSweep: skip når ingen aktiv sæson", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  };
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.deepEqual(r, { ran: false, reason: "no_active_season" });
});

test("runRaceEntryGeneratorSweep: kalder runGeneratorFn med aktiv sæson + dryRun:false", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1" }, error: null }) }) }),
    }),
  };
  let called = null;
  const runGeneratorFn = async (args) => {
    called = args;
    return { dryRun: false, races: 3, teams: 5, generated: 20, skipped: 1 };
  };
  const r = await runRaceEntryGeneratorSweep({ supabase, isEnabled: async () => true, runGeneratorFn });

  assert.equal(called.supabase, supabase);
  assert.equal(called.seasonId, "s1");
  assert.equal(called.dryRun, false);
  assert.equal(r.ran, true);
  assert.equal(r.seasonId, "s1");
  assert.equal(r.races, 3);
  assert.equal(r.teams, 5);
  assert.equal(r.generated, 20);
  assert.equal(r.skipped, 1);
});

test("runRaceEntryGeneratorSweep: kaster hvis seasons-query fejler", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }),
    }),
  };
  await assert.rejects(
    () => runRaceEntryGeneratorSweep({ supabase, isEnabled: async () => true, runGeneratorFn: async () => ({}) }),
    /seasons: boom/
  );
});

test("runRaceEntryGeneratorSweep: kaster videre hvis generatoren fejler (trackedTick fanger i cron.js)", async () => {
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1" }, error: null }) }) }),
    }),
  };
  await assert.rejects(
    () => runRaceEntryGeneratorSweep({
      supabase,
      isEnabled: async () => true,
      runGeneratorFn: async () => { throw new Error("race_entries insert boom"); },
    }),
    /race_entries insert boom/
  );
});
