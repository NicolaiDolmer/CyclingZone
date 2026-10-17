// #6740 (Friis 17/10): hold der ikke stillede op frigives med en "did_not_start"-afmelding.
import test from "node:test";
import assert from "node:assert/strict";
import { releaseTeamsThatDidNotStart, splitWithdrawals, DID_NOT_START_REASON } from "./raceWithdrawal.js";
import { planDidNotStartReleases } from "../scripts/release-6740-did-not-start-bindings.mjs";

test("releaseTeamsThatDidNotStart: én idempotent upsert med årsagen, dubletter samlet", async () => {
  const calls = [];
  const supabase = { from: (table) => ({ upsert: async (rows, opts) => { calls.push({ table, rows, opts }); return { error: null }; } }) };
  const out = await releaseTeamsThatDidNotStart({ supabase, raceId: "leman", teamIds: ["lorraine", "lorraine", null, "csc"] });
  assert.deepEqual(out, { released: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "race_withdrawals");
  assert.deepEqual(calls[0].rows, [
    { race_id: "leman", team_id: "lorraine", withdrawn_reason: DID_NOT_START_REASON },
    { race_id: "leman", team_id: "csc", withdrawn_reason: DID_NOT_START_REASON },
  ]);
  assert.deepEqual(calls[0].opts, { onConflict: "race_id,team_id", ignoreDuplicates: true }, "en frivillig afmelding overskrives aldrig");
});

test("releaseTeamsThatDidNotStart: intet at frigive -> intet kald; DB-fejl kastes", async () => {
  const supabase = { from: () => { throw new Error("should not query"); } };
  assert.deepEqual(await releaseTeamsThatDidNotStart({ supabase, raceId: "r", teamIds: [] }), { released: 0 });
  const failing = { from: () => ({ upsert: async () => ({ error: { message: "boom" } }) }) };
  await assert.rejects(() => releaseTeamsThatDidNotStart({ supabase: failing, raceId: "r", teamIds: ["t"] }), /did not start\): boom/);
});

test("splitWithdrawals: frivillige og did_not_start adskilles", () => {
  const { withdrawn, didNotStart } = splitWithdrawals([
    { race_id: "a", withdrawn_reason: null }, { race_id: "b", withdrawn_reason: DID_NOT_START_REASON }, { race_id: null },
  ]);
  assert.deepEqual([...withdrawn], ["a"]);
  assert.deepEqual([...didNotStart], ["b"]);
});

test("planDidNotStartReleases: kun hold uden rytter i startfeltet, aldrig afmeldte, aldrig legacy-løb", () => {
  const plan = planDidNotStartReleases({
    races: [{ id: "leman" }, { id: "legacy" }],
    snapshots: new Map([["leman", new Set(["x1", "x2", "s1"])]]),
    entries: [
      { race_id: "leman", team_id: "lorraine", rider_id: "l1" },
      { race_id: "leman", team_id: "lorraine", rider_id: "l2" },
      { race_id: "leman", team_id: "started", rider_id: "s1" },
      { race_id: "leman", team_id: "withdrawn", rider_id: "w1" },
      { race_id: "legacy", team_id: "lorraine", rider_id: "g1" },
    ],
    withdrawals: [{ race_id: "leman", team_id: "withdrawn" }],
  });
  assert.deepEqual(plan, [{ raceId: "leman", teamIds: ["lorraine"] }]);
});
