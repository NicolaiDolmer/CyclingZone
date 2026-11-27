import test from "node:test";
import assert from "node:assert/strict";

import { asFormerTeamRiders, parseArgs, runFormerRiderEstimateBackfill } from "./former-rider-estimate-backfill.mjs";

function fakeSupabase(tables) {
  return {
    from(table) {
      let filtered = tables[table] ?? [];
      const q = {
        select() { return q; },
        in(col, values) { filtered = filtered.filter((row) => values.includes(row[col])); return q; },
        order() { return q; },
        range() { return Promise.resolve({ data: filtered, error: null }); },
      };
      return q;
    },
  };
}

const TABLES = {
  rider_ownership_events: [
    { id: 1, rider_id: "r1", from_team_id: "human", to_team_id: "other", occurred_at: "2026-09-01T10:00:00Z" },
    { id: 2, rider_id: "r2", from_team_id: "human", to_team_id: "ai", occurred_at: "2026-09-01T10:00:00Z" },
    { id: 3, rider_id: "r3", from_team_id: "other", to_team_id: "human", occurred_at: "2026-09-01T10:00:00Z" },
  ],
  riders: [
    { id: "r1", team_id: "other", talent_ceiling: 60, is_retired: false },
    { id: "r2", team_id: "ai", talent_ceiling: 55, is_retired: false },
    { id: "r3", team_id: "human", talent_ceiling: 50, is_retired: false },
  ],
};

function fakeWriter({ enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    loadEstimateWriteConfig: async () => (enabled ? { enabled: true, params: {}, paramsVersion: "v" } : { enabled: false, reason: "flag_off" }),
    loadEstimateTeamIds: async () => ["human", "other"],
    planTeamEstimatesFromDb: async (args) => { calls.push({ kind: "plan", ...args }); return { counts: { written: args.riders.length, kept: 0, noKnowledge: 0, noCeiling: 0 } }; },
    writeTeamEstimates: async (args) => { calls.push({ kind: "write", ...args }); return { written: args.riders.length, kept: 0, noKnowledge: 0, noCeiling: 0 }; },
  };
}

test("#7455 backfill: dry-run planlægger kun, som om rytteren stod på det tidligere hold", async () => {
  const writer = fakeWriter();
  const report = await runFormerRiderEstimateBackfill({ supabase: fakeSupabase(TABLES), writer, now: new Date("2026-11-27T12:00:00Z") });
  assert.equal(report.ran, true);
  assert.equal(report.mode, "dry-run");
  assert.equal(writer.calls.every((call) => call.kind === "plan"), true);
  const human = writer.calls.find((call) => call.teamId === "human");
  assert.deepEqual(human.riders.map((rider) => rider.id).sort(), ["r1", "r2"]);
  assert.equal(human.riders.every((rider) => rider.team_id === "human"), true);
  assert.equal(human.trigger, "backfill");
  // "other" mistede r3 til "human", men r3's seneste hændelse med "other" er afgangen.
  const other = writer.calls.find((call) => call.teamId === "other");
  assert.deepEqual(other.riders.map((rider) => rider.id), ["r3"]);
  assert.equal(report.riders, 3);
});

test("#7455 backfill: apply skriver via writeren; slukket skrivning kører ikke", async () => {
  const writer = fakeWriter();
  const report = await runFormerRiderEstimateBackfill({ supabase: fakeSupabase(TABLES), writer, apply: true, now: new Date("2026-11-27T12:00:00Z") });
  assert.equal(report.mode, "apply");
  assert.equal(writer.calls.every((call) => call.kind === "write"), true);
  const off = await runFormerRiderEstimateBackfill({ supabase: fakeSupabase(TABLES), writer: fakeWriter({ enabled: false }), now: new Date("2026-11-27T12:00:00Z") });
  assert.deepEqual(off, { ran: false, mode: "dry-run", reason: "flag_off" });
});

test("#7455 backfill: hjælpere", () => {
  assert.deepEqual(asFormerTeamRiders([{ id: "r1", team_id: "x" }], "t"), [{ id: "r1", team_id: "t" }]);
  assert.deepEqual(parseArgs(["--apply", "--owner-go"]), { apply: true, ownerGo: true });
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false });
});
