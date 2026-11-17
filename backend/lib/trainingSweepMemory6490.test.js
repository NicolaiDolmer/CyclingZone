// #6490 B: the evening run with the train-now press memory (switch training_sweep_memory_6490).
//
// The golden (trainingSweepMemory6490.golden.json) was produced by trainingSweepMemory6490.harness.js
// on the merge base, before the switch existed (rule #7587: never regenerated with this code).
//  - Off: answers, every write and save call, the final tables, every read and the call counts are
//    the merge base's, bit for bit.
//  - On: answers, writes, final tables and who settled which race day are the merge base's; reads may
//    only get fewer, and the database waits per sweep (rounds) must drop.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSweepScenario, SWEEP_SCENARIOS } from "./trainingSweepMemory6490.harness.js";
import { isTrainingSweepMemoryEnabled, runNormalizedTrainingDateSweep, TRAINING_SWEEP_MEMORY_KEY } from "./trainingDateClose.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./trainingSweepMemory6490.golden.json", import.meta.url), "utf8"));

test("the golden covers every scenario and comes from a merge base", () => {
  assert.match(GOLDEN.mergeBase, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(GOLDEN.scenarios), Object.keys(SWEEP_SCENARIOS));
});

for (const name of Object.keys(SWEEP_SCENARIOS)) {
  test(`off = merge base bit for bit: ${name}`, async () => {
    const base = GOLDEN.scenarios[name];
    const off = await runSweepScenario(name, { memory: false });
    assert.deepEqual(off.unsupported, [], "the stand-in must know every call");
    assert.equal(off.answers, base.answers, "sweep answers");
    assert.equal(off.writes, base.writes, "writes and save calls");
    assert.equal(off.state, base.state, "final tables");
    assert.equal(off.reads, base.reads, "reads");
    assert.deepEqual(off.sweeps, base.sweeps, "calls per sweep");
    assert.deepEqual(off.outcome, base.outcome);
  });

  test(`on = same result as the merge base, fewer database waits: ${name}`, async () => {
    const base = GOLDEN.scenarios[name];
    const on = await runSweepScenario(name, { memory: true });
    assert.deepEqual(on.unsupported, []);
    assert.equal(on.answers, base.answers, "sweep answers");
    assert.equal(on.writes, base.writes, "writes and save calls, in order");
    assert.equal(on.state, base.state, "final tables");
    assert.deepEqual(on.outcome, base.outcome, "receipts per rider, quarantine and departures");
    on.sweeps.forEach((sweep, i) => {
      const before = base.sweeps[i];
      assert.equal(sweep.writes, before.writes, `sweep ${i + 1}: same writes`);
      assert.ok(sweep.rounds <= before.rounds, `sweep ${i + 1}: database waits ${sweep.rounds} > ${before.rounds}`);
      if (before.rounds > 0) assert.ok(sweep.rounds < before.rounds, `sweep ${i + 1}: no fewer database waits`);
    });
  });
}

test("the scenarios exercise the evening's fields: deadline, quarantine, departure, follow-the-rider, a failed save", () => {
  const out = GOLDEN.scenarios;
  // At the deadline the waiting race riders settle without their stage (missing evidence → review).
  assert.equal(out.aften_efter_fristen.outcome.status, "needs_reconciliation", "deadline sweep settles the date");
  assert.ok(Object.values(out.aften_efter_fristen.outcome.receiptDays).every((days) => days.length === 5), "every rider has all five race days");
  assert.ok(out.karantaene.outcome.quarantined.length > 0, "a rider is quarantined");
  assert.ok(out.rytter_frigivet_og_solgt.outcome.departed.length > 0, "a released rider is departed");
  assert.ok(out.frigivet_midt_i_holdet.outcome.departed.length > 0, "a rider released mid-team is departed, not quarantined");
  assert.equal(out.frigivet_midt_i_holdet.outcome.status, "complete");
  const failed = out.gemmekald_fejler;
  assert.ok(failed.sweeps[1].byTarget["rpc:commit_training_date_tick"] > 0, "the retry sweep saves the race days left");
  assert.equal(failed.outcome.status, "complete");
});

test("a failed save is retained and retried, with and without the memory", async () => {
  for (const memory of [false, true]) {
    const run = await runSweepScenario("gemmekald_fejler", { memory });
    assert.equal(run.answers, GOLDEN.scenarios.gemmekald_fejler.answers, `memory ${memory}`);
  }
});

// ── The switch ─────────────────────────────────────────────────────────────────────────────────
const switchClient = (answer) => ({
  calls: 0,
  from(table) {
    assert.equal(table, "app_config");
    const self = this;
    return { select() { return this; }, eq(col, key) { assert.equal(key, TRAINING_SWEEP_MEMORY_KEY); return this; },
      async maybeSingle() { self.calls++; if (answer instanceof Error) throw answer; return answer; } };
  },
});

test("switch: only on (or legacy true) turns the memory on; off, beta, missing and failures are off", async () => {
  assert.equal(await isTrainingSweepMemoryEnabled(switchClient({ data: { value: "on" }, error: null })), true);
  assert.equal(await isTrainingSweepMemoryEnabled(switchClient({ data: { value: true }, error: null })), true);
  for (const value of ["off", "beta", false, null]) {
    assert.equal(await isTrainingSweepMemoryEnabled(switchClient({ data: { value }, error: null })), false, String(value));
  }
  assert.equal(await isTrainingSweepMemoryEnabled(switchClient({ data: null, error: null })), false);
  assert.equal(await isTrainingSweepMemoryEnabled(switchClient({ data: null, error: { message: "down" } })), false);
  assert.equal(await isTrainingSweepMemoryEnabled(switchClient(new Error("network"))), false);
});

test("switch: read once per sweep, lazily; a failing reader means off and the sweep goes on", async () => {
  const team = { id: "t1", league_division_id: "d1", created_at: "2026-01-01T00:00:00Z" };
  const job = { season: { id: "s1", number: 5 }, tickDate: "2026-11-09" };
  const runs = [];
  let reads = 0;
  const sweepWith = (loadSweepMemory, teams = [team, { ...team, id: "t2" }]) => runNormalizedTrainingDateSweep({
    supabase: {}, now: new Date("2026-11-09T19:30:00Z"), logger: { error() {} },
    runDay: async (args) => { runs.push(args); return { alreadyRan: false }; },
    loadIndex: async () => ({ jobs: [job], today: job.tickDate, activeSeasonId: "s1" }),
    loadContext: async () => ({ teams, riders: teams.map((t) => ({ id: `r-${t.id}`, team_id: t.id })), gameDaysByDivision: new Map([["d1", [41, 42, 43, 44, 45]]]) }),
    loadWorkRows: async () => teams.map((t) => ({ team_id: t.id, game_days: [41, 42, 43, 44, 45], expected_rider_ids: [`r-${t.id}`], quarantined_rider_ids: [], opening_conditions: { [`r-${t.id}`]: {} }, status: "pending" })),
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }), refreshRankings: async () => {},
    loadSweepMemory,
  });
  const { __resetNormalizedTrainingDateCacheForTests } = await import("./trainingDateClose.js");

  __resetNormalizedTrainingDateCacheForTests();
  await sweepWith(async () => { reads++; return true; });
  assert.equal(reads, 1, "one switch read for the whole sweep");
  assert.equal(runs.length, 10);
  const firstTeam = runs.filter((r) => r.teamId === "t1");
  assert.ok(firstTeam.every((r) => r.pressReads === true && r.pressMemory === firstTeam[0].pressMemory), "one memory per team");
  assert.notEqual(firstTeam[0].pressMemory, runs.find((r) => r.teamId === "t2").pressMemory, "never shared between teams");
  assert.deepEqual(firstTeam[0].pressRuns.map((r) => r.gameDay), [41, 42, 43, 44, 45]);

  runs.length = 0; reads = 0;
  __resetNormalizedTrainingDateCacheForTests();
  const summary = await sweepWith(async () => { reads++; throw new Error("down"); });
  assert.equal(reads, 1);
  assert.equal(summary.failed, 0);
  assert.equal(runs.length, 10);
  assert.ok(runs.every((r) => !("pressMemory" in r) && !("pressReads" in r) && !("pressRuns" in r)), "off: the old arguments, nothing added");

  runs.length = 0; reads = 0;
  __resetNormalizedTrainingDateCacheForTests();
  await sweepWith(async () => { reads++; return true; }, []);
  assert.equal(reads, 0, "a sweep with no team to settle never asks");
});
