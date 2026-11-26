// #8614: AI-hold fast tilstand (valg B) bag ai_team_frozen_state_8614.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AI_TEAM_FROZEN_STATE_KEY, AI_TEAM_FROZEN_RESET_CLAIM_KEY, AI_FROZEN_FATIGUE, AI_FROZEN_FORM,
  AI_FROZEN_RESET_STALE_CLAIM_MS, isAiTeamFrozenStateEnabled, skipsFrozenAiTeamTick,
  applyFrozenAiEntrantState, dropFrozenAiInjuryRows, frozenAiResetRow, applyAiFrozenStateResetOnce,
  runAiFrozenStateResetPhase, readAiTeamFrozenState, wasDateOpenWhenSwitchedOn, withoutFrozenAiTeams,
  hasFrozenAiPlanItems, refreezeAiEntrantsAfterStageStart, loadAiFrozenStateResetStatus,
  __resetFrozenAiReportsForTests,
} from "./aiTeamFrozenState8614.js";
import { applySameDateEnteringFatigueV2 } from "./raceFatigue.js";
import { runRaceSessionSettlement } from "./trainingSettleRaceSession7982.js";
import * as settleHarness from "./trainNowSameResult7982.harness.js";
import * as settleFacit from "./trainingSettleRaceSession7982.facit.test.js";
import { runAiSettleScenario } from "./__fixtures__/aiTeamFrozenState8614SettleScenarios.js";
import { runNormalizedTrainingDateSweep, __resetNormalizedTrainingDateCacheForTests } from "./trainingDateClose.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { findStageFlag } from "./stageFlagCatalog.js";
import { runSweepScenario, flagClient } from "./__fixtures__/aiTeamFrozenState8614Scenarios.js";
import { loadEntrantsForRace, simulateStageByIndex } from "./raceRunner.js";
import {
  runLoadEntrantsScenario, runCrashStageScenario, normalizeUuids, readsWithoutFrozenFlag, AI_FROZEN_FLAG_READ,
} from "./__fixtures__/aiTeamFrozenState8614RaceScenarios.js";
import * as readiness from "./seasonTransitionReadiness.js";

const ON = { [AI_TEAM_FROZEN_STATE_KEY]: "on" };

// ── Kontakten ─────────────────────────────────────────────────────────────────
test("the switch is binary: only the exact value on turns it on", async () => {
  for (const [value, expected] of [["on", true], ["beta", false], ["off", false], [true, false], [null, false]]) {
    assert.equal(await isAiTeamFrozenStateEnabled(flagClient({ [AI_TEAM_FROZEN_STATE_KEY]: value })), expected, String(value));
  }
  assert.equal(await isAiTeamFrozenStateEnabled(flagClient({})), false, "missing row is off");
  const broken = { from() { throw new Error("db down"); } };
  assert.equal(await isAiTeamFrozenStateEnabled(broken), false, "a failed read is off");
});

test("a failed switch read is off but never silent: it is reported to Sentry (Fable 26/11 fund 5)", async () => {
  const captured = [];
  const capture = (err, ctx) => captured.push({ message: err.message, fingerprint: ctx.fingerprint });
  const thrown = await readAiTeamFrozenState({ from() { throw new Error("db down"); } }, { capture });
  assert.deepEqual(thrown, { on: false, onSince: null, failed: true });
  const errored = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }) }) }) };
  assert.equal((await readAiTeamFrozenState(errored, { capture })).on, false);
  assert.equal(captured.length, 2);
  assert.match(captured[1].message, /timeout/);
  assert.deepEqual(captured[0].fingerprint, ["ai-team-frozen-state-8614-read-failed"]);
  // A good read is not reported, and carries the time the switch was last set.
  const ok = await readAiTeamFrozenState(flagClient({ [AI_TEAM_FROZEN_STATE_KEY]: "on" }, { [AI_TEAM_FROZEN_STATE_KEY]: "2026-11-27T13:00:00Z" }), { capture });
  assert.deepEqual(ok, { on: true, onSince: "2026-11-27T13:00:00Z" });
  assert.equal(captured.length, 2);
  const off = await readAiTeamFrozenState(flagClient({ [AI_TEAM_FROZEN_STATE_KEY]: "off" }, { [AI_TEAM_FROZEN_STATE_KEY]: "2026-11-27T13:00:00Z" }), { capture });
  assert.deepEqual(off, { on: false, onSince: null });
});

test("the switch is read fresh (engine input) and listed for the admin", () => {
  assert.ok(FRESH_FLAG_KEYS.has(AI_TEAM_FROZEN_STATE_KEY));
  assert.equal(findStageFlag(AI_TEAM_FROZEN_STATE_KEY)?.area, "training");
});

test("the seed migration seeds the switch off and never overwrites a value", () => {
  const sql = readFileSync(new URL("../../database/2026-11-26-8614-ai-team-frozen-state-flag.sql", import.meta.url), "utf8");
  assert.match(sql, /'ai_team_frozen_state_8614',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});

// ── Rene regler ───────────────────────────────────────────────────────────────
test("only an AI team without registered work is skipped, and only with the switch on", () => {
  const ai = { is_ai: true }, human = { is_ai: false }, unknown = {};
  assert.equal(skipsFrozenAiTeamTick(ai, { frozenOn: true, registered: false }), true);
  assert.equal(skipsFrozenAiTeamTick(ai, { frozenOn: true, registered: true }), false, "registered work finishes");
  assert.equal(skipsFrozenAiTeamTick(ai, { frozenOn: false, registered: false }), false);
  assert.equal(skipsFrozenAiTeamTick(human, { frozenOn: true, registered: false }), false);
  assert.equal(skipsFrozenAiTeamTick(unknown, { frozenOn: true, registered: false }), false);
  assert.equal(skipsFrozenAiTeamTick(null, { frozenOn: true, registered: false }), false);
});

test("registered AI work finishes only on a date that was open when the switch was turned on (Fable 26/11)", () => {
  const ai = { is_ai: true };
  // Turned on 27/11 at 14:00 Copenhagen time.
  const onSince = "2026-11-27T13:00:00Z";
  assert.equal(wasDateOpenWhenSwitchedOn("2026-11-26", onSince), true, "an earlier date still pending");
  assert.equal(wasDateOpenWhenSwitchedOn("2026-11-27", onSince), true, "the date of the flip");
  assert.equal(wasDateOpenWhenSwitchedOn("2026-11-28", onSince), false, "a later date was not open");
  // Copenhagen calendar date, not UTC: 23:30 UTC on 27/11 is already 28/11 in Copenhagen.
  assert.equal(wasDateOpenWhenSwitchedOn("2026-11-28", "2026-11-27T23:30:00Z"), true);
  assert.equal(wasDateOpenWhenSwitchedOn("2026-11-28", null), true, "unknown time: finish as before, never hang");
  assert.equal(wasDateOpenWhenSwitchedOn("2026-11-28", "garbage"), true);
  assert.equal(skipsFrozenAiTeamTick(ai, { frozenOn: true, registered: true, tickDate: "2026-11-27", onSince }), false);
  assert.equal(skipsFrozenAiTeamTick(ai, { frozenOn: true, registered: true, tickDate: "2026-11-28", onSince }), true);
  assert.equal(skipsFrozenAiTeamTick(ai, { frozenOn: false, registered: true, tickDate: "2026-11-28", onSince }), false);
  assert.equal(skipsFrozenAiTeamTick({ is_ai: false }, { frozenOn: true, registered: true, tickDate: "2026-11-28", onSince }), false);
});

test("the settlement plan drops AI teams only", () => {
  const teams = [{ id: "A", is_ai: true }, { id: "H", is_ai: false }, { id: "U" }];
  const plan = [{ teamId: "A", gameDay: 43 }, { teamId: "H", gameDay: 43 }, { teamId: "U", gameDay: 44 }];
  assert.equal(hasFrozenAiPlanItems(plan, teams), true);
  assert.deepEqual(withoutFrozenAiTeams(plan, teams).map((p) => p.teamId), ["H", "U"]);
  assert.equal(hasFrozenAiPlanItems(plan.slice(1), teams), false);
});

test("the engine sees an AI rider with the fixed fatigue and form; off and humans are untouched", () => {
  const ai = { rider_id: "x", team_is_ai: true, form: 61, fatigue: 37 };
  const human = { rider_id: "y", form: 61, fatigue: 37 };
  const noCondition = { rider_id: "z", team_is_ai: true };
  for (const entrant of [ai, human, noCondition]) {
    const before = structuredClone(entrant);
    assert.equal(applyFrozenAiEntrantState(entrant, false), entrant);
    assert.deepEqual(entrant, before, "off: same object, same keys, same values");
  }
  applyFrozenAiEntrantState(human, true);
  assert.deepEqual(human, { rider_id: "y", form: 61, fatigue: 37 });
  applyFrozenAiEntrantState(ai, true);
  assert.deepEqual(ai, { rider_id: "x", team_is_ai: true, form: AI_FROZEN_FORM, fatigue: AI_FROZEN_FATIGUE });
  applyFrozenAiEntrantState(noCondition, true);
  assert.equal(noCondition.fatigue, AI_FROZEN_FATIGUE);
  assert.equal(noCondition.form, AI_FROZEN_FORM);
});

test("the fixed state is option B: moderate base fatigue, neutral form", () => {
  assert.equal(AI_FROZEN_FORM, 50, "neutral form is the middle of the 0-100 scale");
  assert.ok(AI_FROZEN_FATIGUE > 0 && AI_FROZEN_FATIGUE < 50, "moderate, not fresh and not tired");
});

test("the reset row clears every injury field and sets the fixed fatigue, never form", () => {
  const row = frozenAiResetRow("r1");
  assert.deepEqual(row, {
    rider_id: "r1", fatigue: AI_FROZEN_FATIGUE, injured_until: null, injury_cause: null,
    injury_end_game_day: null, injury_season_id: null, injury_race_days_left: null,
  });
  assert.equal("form" in row, false);
});

// ── In-memory Supabase til skader og nulstilling ─────────────────────────────
function memoryDb({ flag = "on", teams = [], riders = [], claim = null, failUpsert = false } = {}) {
  const state = {
    app_config: new Map([[AI_TEAM_FROZEN_STATE_KEY, flag], ...(claim ? [[AI_TEAM_FROZEN_RESET_CLAIM_KEY, claim]] : [])]),
    teams, riders, upserts: [], calls: [], failUpsert,
  };
  const matches = (row, filters) => filters.every(([op, col, val]) => {
    const v = col.startsWith("value->>") ? row.value?.[col.slice(8)] : row[col];
    if (op === "eq") return v === val;
    if (op === "in") return val.includes(v);
    return true;
  });
  const rowsOf = (table) => (table === "app_config"
    ? [...state.app_config].map(([key, value]) => ({ key, value }))
    : state[table] ?? []);
  const client = {
    state,
    from(table) {
      const filters = [];
      let action = "select", payload = null, returning = false;
      const exec = async () => {
        state.calls.push(`${action}:${table}`);
        if (action === "select") {
          const data = rowsOf(table).filter((r) => matches(r, filters));
          return { data, error: null };
        }
        if (action === "insert") {
          if (state.app_config.has(payload.key)) return { data: null, error: { code: "23505", message: "duplicate" } };
          state.app_config.set(payload.key, payload.value);
          return { data: null, error: null };
        }
        if (action === "upsert") {
          if (state.failUpsert) return { data: null, error: { message: "upsert failed" } };
          state.upserts.push(...payload);
          return { data: null, error: null };
        }
        if (action === "update") {
          const hit = rowsOf(table).filter((r) => matches(r, filters));
          for (const r of hit) state.app_config.set(r.key, payload.value);
          return { data: returning ? hit.map((r) => ({ key: r.key })) : null, error: null };
        }
        if (action === "delete") {
          for (const r of rowsOf(table).filter((row) => matches(row, filters))) state.app_config.delete(r.key);
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      const chain = {
        select() { if (action !== "select") returning = true; return chain; },
        eq(col, val) { filters.push(["eq", col, val]); return chain; },
        in(col, val) { filters.push(["in", col, val]); return chain; },
        order() { return chain; },
        range() { return exec(); },
        insert(p) { action = "insert"; payload = p; return chain; },
        upsert(p) { action = "upsert"; payload = p; return chain; },
        update(p) { action = "update"; payload = p; return chain; },
        delete() { action = "delete"; return chain; },
        async maybeSingle() {
          const r = await exec();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        then(resolve, reject) { return exec().then(resolve, reject); },
      };
      return chain;
    },
  };
  return client;
}

const TEAMS = [{ id: "ai1", is_ai: true }, { id: "ai2", is_ai: true }, { id: "hum", is_ai: false }];
const RIDERS = [
  { id: "r-ai1", team_id: "ai1", is_retired: false }, { id: "r-ai2", team_id: "ai2", is_retired: false },
  { id: "r-old", team_id: "ai1", is_retired: true }, { id: "r-hum", team_id: "hum", is_retired: false },
];

test("race injuries: an AI rider's crash injury is dropped with the switch on; a human's stays", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS });
  const rows = [{ rider_id: "r-ai1", injured_until: "2026-12-01" }, { rider_id: "r-hum", injured_until: "2026-12-01" }];
  assert.equal(await dropFrozenAiInjuryRows({ supabase: db, rows }), 1);
  assert.deepEqual(rows.map((r) => r.rider_id), ["r-hum"]);
});

test("race injuries: off keeps every row and reads nothing but the switch", async () => {
  const db = memoryDb({ flag: "off", teams: TEAMS, riders: RIDERS });
  const rows = [{ rider_id: "r-ai1" }, { rider_id: "r-hum" }];
  assert.equal(await dropFrozenAiInjuryRows({ supabase: db, rows }), 0);
  assert.equal(rows.length, 2);
  assert.deepEqual(db.state.calls, ["select:app_config"]);
  const none = memoryDb({ flag: "on" });
  assert.equal(await dropFrozenAiInjuryRows({ supabase: none, rows: [] }), 0);
  assert.deepEqual(none.state.calls, [], "no rows: not even the switch is read");
});

// Fast ur i alle nulstillings-tests (AGENTS.md regel 16, Codex P1 26/11).
const RESET_NOW = new Date("2026-11-26T18:00:00Z");

test("one-time reset: off writes nothing", async () => {
  const db = memoryDb({ flag: "off", teams: TEAMS, riders: RIDERS });
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: db, now: RESET_NOW }), { ran: false, reason: "flag_off" });
  assert.deepEqual(db.state.calls, ["select:app_config"]);
  assert.equal(await runAiFrozenStateResetPhase({ supabase: db, now: RESET_NOW }), null, "off: no phase row");
});

test("one-time reset: no wall-clock default; a missing clock is refused before any write", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS });
  await assert.rejects(applyAiFrozenStateResetOnce({ supabase: db }), /Explicit valid now required/);
  await assert.rejects(applyAiFrozenStateResetOnce({ supabase: db, now: new Date("nope") }), /Explicit valid now required/);
  assert.equal(db.state.upserts.length, 0);
  assert.equal(db.state.app_config.has(AI_TEAM_FROZEN_RESET_CLAIM_KEY), false, "no claim taken");
});

test("one-time reset: resets only active AI riders, then never again", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS });
  const now = RESET_NOW;
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: db, now }), { ran: true, riders: 2 });
  assert.deepEqual(db.state.upserts.map((r) => r.rider_id).sort(), ["r-ai1", "r-ai2"]);
  assert.ok(db.state.upserts.every((r) => r.fatigue === AI_FROZEN_FATIGUE && r.injured_until === null));
  assert.equal(db.state.app_config.get(AI_TEAM_FROZEN_RESET_CLAIM_KEY).status, "done");
  // Codex P1 26/11: completion metadata comes from the injected clock, never the wall clock.
  assert.deepEqual(db.state.app_config.get(AI_TEAM_FROZEN_RESET_CLAIM_KEY),
    { status: "done", claimed_at: now.toISOString(), done_at: now.toISOString(), riders: 2 });
  const writes = db.state.upserts.length;
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: db, now }), { ran: false, reason: "already_done" });
  assert.equal(db.state.upserts.length, writes, "second run writes nothing");
  const phase = await runAiFrozenStateResetPhase({ supabase: db, now });
  assert.deepEqual(phase, { phase: "ai_team_frozen_reset_8614", ran: false, reason: "already_done" });
});

test("one-time reset: a fresh claim held elsewhere is respected; a stale one is retaken", async () => {
  const now = RESET_NOW;
  const fresh = memoryDb({ teams: TEAMS, riders: RIDERS, claim: { status: "claimed", claimed_at: new Date(now - 60_000).toISOString() } });
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: fresh, now }), { ran: false, reason: "claim_held" });
  assert.equal(fresh.state.upserts.length, 0);
  const staleAt = new Date(now - AI_FROZEN_RESET_STALE_CLAIM_MS - 1000).toISOString();
  const stale = memoryDb({ teams: TEAMS, riders: RIDERS, claim: { status: "claimed", claimed_at: staleAt } });
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: stale, now }), { ran: true, riders: 2 });
});

test("one-time reset: a failed write releases the claim so the next transition retries", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS, failUpsert: true });
  await assert.rejects(applyAiFrozenStateResetOnce({ supabase: db, now: RESET_NOW }), /upsert failed/);
  assert.equal(db.state.app_config.has(AI_TEAM_FROZEN_RESET_CLAIM_KEY), false);
  const phase = await runAiFrozenStateResetPhase({ supabase: memoryDb({ teams: TEAMS, riders: RIDERS, failUpsert: true }), now: RESET_NOW });
  assert.equal(phase.phase, "ai_team_frozen_reset_8614");
  assert.match(phase.error, /upsert failed/);
});

test("one-time reset can be re-run after a failure (Fable 26/11 fund 6): status, then the ops run", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS, failUpsert: true });
  await assert.rejects(applyAiFrozenStateResetOnce({ supabase: db, now: RESET_NOW }), /upsert failed/);
  assert.deepEqual(await loadAiFrozenStateResetStatus({ supabase: db }), { switchOn: true, switchReadFailed: false, claim: null },
    "the failed run left no claim, so the status shows it never completed");
  // The ops command runs the same idempotent reset again once the cause is gone.
  const { runAiFrozenResetOps } = await import("../scripts/ops/aiTeamFrozenReset8614.mjs");
  const lines = [];
  db.state.failUpsert = false;
  const later = new Date(RESET_NOW.getTime() + 60_000);
  const dry = await runAiFrozenResetOps({ supabase: db, now: later, apply: false, log: (l) => lines.push(l) });
  assert.equal(dry.applied, false);
  assert.equal(db.state.upserts.length, 0, "dry-run writes nothing");
  const run = await runAiFrozenResetOps({ supabase: db, now: later, apply: true, log: (l) => lines.push(l) });
  assert.deepEqual(run.result, { ran: true, riders: 2 });
  assert.equal(db.state.app_config.get(AI_TEAM_FROZEN_RESET_CLAIM_KEY).done_at, later.toISOString());
  const again = await runAiFrozenResetOps({ supabase: db, now: later, apply: true, log: (l) => lines.push(l) });
  assert.deepEqual(again.result, { ran: false, reason: "already_done" }, "a done reset is never run twice");
});

// ── Aftenopgørelsen ──────────────────────────────────────────────────────────
const sweep = (flag) => runSweepScenario({
  runNormalizedTrainingDateSweep, resetCache: __resetNormalizedTrainingDateCacheForTests,
  flags: { training_calendar_tick_ai_only: "on", [AI_TEAM_FROZEN_STATE_KEY]: flag },
});

test("golden: with the switch off the evening run is bit-identical to the merge base (#7587)", async () => {
  const golden = JSON.parse(readFileSync(new URL("./__fixtures__/aiTeamFrozenState8614.golden.json", import.meta.url), "utf8"));
  const out = await sweep("off");
  const outcome = { registers: out.registers, ticks: out.ticks, summary: out.summary };
  assert.deepEqual(outcome, golden.outcome);
  assert.equal(createHash("sha256").update(JSON.stringify(outcome)).digest("hex"), golden.sha256);
  // The only new database call under off is the switch itself, once per date.
  assert.equal(out.flagReads.filter((r) => r === `app_config:${AI_TEAM_FROZEN_STATE_KEY}`).length, 1);
});

test("with the switch on an AI team without registered work is neither registered nor ticked", async () => {
  const off = await sweep("off");
  const on = await sweep("on");
  const teamsOf = (rows) => [...new Set(rows.map((r) => r.teamId))].sort();
  assert.deepEqual(teamsOf(off.registers), ["a1", "h1"]);
  assert.deepEqual(teamsOf(on.registers), ["h1"], "no registration for an AI team");
  assert.deepEqual(teamsOf(off.ticks), ["a1", "a2", "a3", "h1"]);
  assert.deepEqual(teamsOf(on.ticks), ["a3", "h1"], "registered AI work still finishes; a2 gets no calendar tick");
  // Human teams are bit-identical between off and on.
  const human = (rows) => rows.filter((r) => r.teamId.startsWith("h"));
  assert.deepEqual(human(on.registers), human(off.registers));
  assert.deepEqual(human(on.ticks), human(off.ticks));
});

// #8808 (Fable 26/11): undtagelsen for registreret AI-arbejde gælder kun en dato, der var åben ved tændingen.
const sweepOnSince = (onSince, logger) => runSweepScenario({
  runNormalizedTrainingDateSweep, resetCache: __resetNormalizedTrainingDateCacheForTests,
  flags: { training_calendar_tick_ai_only: "on", [AI_TEAM_FROZEN_STATE_KEY]: "on" },
  updatedAt: { [AI_TEAM_FROZEN_STATE_KEY]: onSince }, logger,
});
const QUIET_LOG = { log() {}, warn() {}, error() {}, info() {} };

test("registered AI work on the date the switch was turned on (or earlier) finishes as before", async () => {
  // The scenario's date is 20/11; the switch was turned on that afternoon.
  const on = await sweepOnSince("2026-11-20T13:00:00Z", QUIET_LOG);
  assert.deepEqual([...new Set(on.ticks.map((t) => t.teamId))].sort(), ["a3", "h1"]);
  assert.equal(on.flagReads.filter((r) => r === `app_config:${AI_TEAM_FROZEN_STATE_KEY}`).length, 1, "one switch read per date");
});

test("registered AI work on a later date is not ticked, and it is reported (no silent skip)", async () => {
  __resetFrozenAiReportsForTests();
  const errors = [];
  const logger = { ...QUIET_LOG, error: (...args) => errors.push(args) };
  // Turned on the day before the scenario's date: 20/11 was not open yet.
  const on = await sweepOnSince("2026-11-19T13:00:00Z", logger);
  assert.deepEqual([...new Set(on.ticks.map((t) => t.teamId))].sort(), ["h1"], "no tick for any AI team");
  assert.deepEqual([...new Set(on.registers.map((r) => r.teamId))].sort(), ["h1"]);
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].slice(1), ["a3", "2026-11-20"]);
  // The human team is identical to the switch off.
  const off = await sweep("off");
  const human = (rows) => rows.filter((r) => r.teamId.startsWith("h"));
  assert.deepEqual(human(on.ticks), human(off.ticks));
  assert.deepEqual(human(on.registers), human(off.registers));
  // Reported once per team and date per process, not on every evening run.
  await sweepOnSince("2026-11-19T13:00:00Z", logger);
  assert.equal(errors.length, 1);
});

// ── Etape-afregningen (#8808, Fable 26/11 BLOCK) ──────────────────────────────
const settleGolden = JSON.parse(readFileSync(new URL("./__fixtures__/aiTeamFrozenState8614Settle.golden.json", import.meta.url), "utf8"));
const settleScenario = (flags) => runAiSettleScenario({ harness: settleHarness, facit: settleFacit, runRaceSessionSettlement, flags });

test("golden: with the switch off (or missing) the settlement after the stage is bit-identical to the merge base (#7587)", async () => {
  for (const [flags, expected] of [[{ [AI_TEAM_FROZEN_STATE_KEY]: "off" }, settleGolden.sha256], [{}, settleGolden.flag_missing_sha256]]) {
    const outcome = await settleScenario(flags);
    assert.deepEqual(outcome, settleGolden.outcome);
    assert.equal(sha(outcome), expected);
  }
  // The scenario reaches the branch: off, the AI team's date is opened and its race session ticked.
  assert.equal(settleGolden.outcome.work.length, 1);
  assert.ok(settleGolden.outcome.ticks.length > 0);
});

test("with the switch on an AI team in a settled stage gets no registration, no tick and no receipt", async () => {
  const outcome = await settleScenario({ [AI_TEAM_FROZEN_STATE_KEY]: "on" });
  assert.deepEqual(outcome.work, [], "no training_date_work row: the evening run has nothing to finish");
  assert.deepEqual(outcome.ticks, [], "no receipt");
  assert.deepEqual(outcome.runs, [], "no training run");
  assert.equal(outcome.summary.planned, 0);
  assert.equal(outcome.summary.aiFrozenSkipped, 1);
});

test("with the switch on a human team in a settled stage settles exactly as with it off", async () => {
  const human = async (flags) => {
    const state = settleHarness.seedState({ count: 6, entered: [1, 2], flags: { training_settle_race_session: "on", ...flags } });
    settleHarness.finishRace(state);
    const out = await settleFacit.settle(state, settleFacit.fakeWithRaceSessionRule(state));
    // Every table but the switch row itself (app_config differs by construction).
    const { app_config: _switches, ...tables } = state;
    return { out, digest: settleHarness.stateDigest(tables) };
  };
  const off = await human({ [AI_TEAM_FROZEN_STATE_KEY]: "off" });
  const on = await human({ [AI_TEAM_FROZEN_STATE_KEY]: "on" });
  assert.ok(off.out.settled > 0, "the human team's race session is settled");
  assert.equal(on.digest, off.digest);
  assert.deepEqual(on.out, off.out, "no AI team in the plan: the switch is not even read into the summary");
});

// ── Etapestarten: fast tilstand efter datoens tidligere etaper (Codex P1 26/11) ─
function stageStartClient({ flag, loads }) {
  const reads = [];
  const from = (table) => {
    const chain = {
      select() { return chain; }, eq() { return chain; }, in() { return chain; }, lt() { return chain; },
      is() { return chain; }, order() { return chain; },
      async maybeSingle() {
        reads.push(table);
        if (table === "race_stage_schedule") return { data: { game_day: 44, scheduled_at: "2026-11-20T15:00:00Z" }, error: null };
        if (table === "app_config") return { data: flag == null ? null : { value: flag }, error: null };
        return { data: null, error: null };
      },
      then(resolve, reject) {
        reads.push(table);
        const data = table === "training_race_loads" ? loads : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  return { from, reads };
}
const stageEntrants = () => [
  { rider_id: "x1", team_id: "X", team_is_ai: true, form: AI_FROZEN_FORM, fatigue: AI_FROZEN_FATIGUE, abilities: { recovery: 50 } },
  { rider_id: "h1", team_id: "H", form: AI_FROZEN_FORM, fatigue: AI_FROZEN_FATIGUE, abilities: { recovery: 50 } },
];
const earlierStageLoads = [{ rider_id: "x1", game_day: 43, load: 30 }, { rider_id: "h1", game_day: 43, load: 30 }];

test("integration: the day's earlier stage tires the AI rider in the engine's own stage start; the frozen state is applied after it", async () => {
  // Off: today's rule. Both riders enter the second stage of the day with the earlier stage's fatigue.
  const offClient = stageStartClient({ flag: "off", loads: earlierStageLoads });
  const off = stageEntrants();
  await applySameDateEnteringFatigueV2({ supabase: offClient, raceId: "r", stageNumber: 2, entrants: off });
  assert.ok(off[0].fatigue > AI_FROZEN_FATIGUE && off[1].fatigue > AI_FROZEN_FATIGUE, "the scenario reaches the same-date branch");
  const offSnapshot = structuredClone(off);
  assert.equal(await refreezeAiEntrantsAfterStageStart({ supabase: offClient, entrants: off }), 0);
  assert.deepEqual(off, offSnapshot, "off: nothing changes");
  // On: the AI rider is back on the fixed state; the human rider keeps exactly the same accumulated fatigue.
  const onClient = stageStartClient({ flag: "on", loads: earlierStageLoads });
  const on = stageEntrants();
  await applySameDateEnteringFatigueV2({ supabase: onClient, raceId: "r", stageNumber: 2, entrants: on });
  assert.equal(await refreezeAiEntrantsAfterStageStart({ supabase: onClient, entrants: on }), 1);
  assert.deepEqual([on[0].form, on[0].fatigue], [AI_FROZEN_FORM, AI_FROZEN_FATIGUE]);
  assert.deepEqual(on[1], offSnapshot[1]);
  // No AI rider in the field: the switch is not read.
  const humansOnly = stageStartClient({ flag: "on", loads: [] });
  assert.equal(await refreezeAiEntrantsAfterStageStart({ supabase: humansOnly, entrants: [stageEntrants()[1]] }), 0);
  assert.deepEqual(humansOnly.reads, []);
});

test("the engine applies the frozen state after the stage-start fatigue and before the stage is simulated", () => {
  const src = readFileSync(new URL("./raceRunner.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function simulateStageByIndex("));
  const lastSameDate = body.indexOf("applySameDateEnteringFatigueV2({ supabase, raceId: race.id, stageNumber, entrants, instantOnly: true })");
  const refreeze = body.indexOf("refreezeAiEntrantsAfterStageStart({ supabase, entrants })");
  const simulate = body.indexOf("buildStageRowsAccumulated({");
  assert.ok(lastSameDate > 0 && refreeze > lastSameDate && simulate > refreeze, "same-date fatigue -> frozen state -> simulation");
});

// ── Løbsmotoren: startfeltet og skaderne ─────────────────────────────────────
// Golden fra en frossen kopi af merge-base (git archive, ingen 8614-kode), kun hashes (#7587).
const raceGolden = JSON.parse(readFileSync(new URL("./__fixtures__/aiTeamFrozenState8614Race.golden.json", import.meta.url), "utf8"));
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function raceOutcome(flags) {
  const entrants = await runLoadEntrantsScenario({ loadEntrantsForRace, flags });
  const stage = await runCrashStageScenario({ simulateStageByIndex, flags });
  const outcome = normalizeUuids({
    load_entrants: { entrants: entrants.entrants, reads: readsWithoutFrozenFlag(entrants.reads), writes: entrants.writes, rpcCalls: entrants.rpcCalls },
    crash_stage: { stageRows: stage.stageRows, reads: readsWithoutFrozenFlag(stage.reads), writes: stage.writes, rpcCalls: stage.rpcCalls },
  });
  const flagReads = {
    load_entrants: entrants.reads.filter((r) => r === AI_FROZEN_FLAG_READ).length,
    crash_stage: stage.reads.filter((r) => r === AI_FROZEN_FLAG_READ).length,
  };
  return { outcome, flagReads };
}

test("golden: with the switch off (or missing) the race engine is bit-identical to the merge base (#7587)", async () => {
  for (const flags of [{ [AI_TEAM_FROZEN_STATE_KEY]: "off" }, {}]) {
    const { outcome, flagReads } = await raceOutcome(flags);
    assert.equal(sha(outcome.load_entrants), raceGolden.load_entrants_sha256, "start field: entrants, reads and writes");
    assert.equal(sha(outcome.crash_stage), raceGolden.crash_stage_sha256, "crash stage: results, incidents, injury and every other write");
    assert.equal(sha(outcome), raceGolden.sha256);
    // The scenario reaches both new branches: an AI team in the field and an injury on an AI rider.
    assert.deepEqual(outcome.load_entrants.entrants.map((e) => e.rider_id), raceGolden.qualitative.load_entrants_riders);
    const injured = outcome.crash_stage.writes.filter((w) => w.table === "rider_condition" && w.op === "upsert").flatMap((w) => w.rows.map((r) => r.rider_id));
    assert.deepEqual(injured, raceGolden.qualitative.crash_stage_injury_upserts);
    // The only new database call under off is the switch itself: once for the field, once after the
    // stage-start fatigue (#8808), once for the injury rows.
    assert.deepEqual(flagReads, { load_entrants: 1, crash_stage: 3 });
  }
});

test("with the switch on the engine sees the fixed AI state and the AI rider's crash gives no injury", async () => {
  const { outcome } = await raceOutcome({ [AI_TEAM_FROZEN_STATE_KEY]: "on" });
  const byId = new Map(outcome.load_entrants.entrants.map((e) => [e.rider_id, e]));
  assert.deepEqual([byId.get("x1").form, byId.get("x1").fatigue], [AI_FROZEN_FORM, AI_FROZEN_FATIGUE]);
  assert.deepEqual([byId.get("x2").form, byId.get("x2").fatigue], [AI_FROZEN_FORM, AI_FROZEN_FATIGUE]);
  const off = (await raceOutcome({ [AI_TEAM_FROZEN_STATE_KEY]: "off" })).outcome;
  const offById = new Map(off.load_entrants.entrants.map((e) => [e.rider_id, e]));
  for (const id of ["h1", "h2"]) assert.deepEqual(byId.get(id), offById.get(id), `human rider ${id} is untouched`);
  const crashWrites = outcome.crash_stage.writes.filter((w) => w.table === "race_incidents" && w.op === "insert").flatMap((w) => w.rows);
  assert.ok(crashWrites.some((r) => r.rider_id === "b2" && r.kind === "crash"), "the incident itself is still recorded");
  assert.ok(!outcome.crash_stage.writes.some((w) => w.table === "rider_condition" && w.op === "upsert"), "no injury for the AI rider");
});

// ── Sæsonens sidste træningsdato ─────────────────────────────────────────────
const { PGlite } = await import(process.env.CZ_READINESS_PGLITE_MODULE || "@electric-sql/pglite");
let pg;
function pgClient() {
  return { from(table) {
    const filters = [], params = [], orders = [];
    let columns = "*", rowLimit = null;
    const run = async (from = 0, to = null) => {
      const calendar = table === "race_stage_schedule";
      const projection = calendar ? "scheduled_at" : columns;
      const relation = calendar ? "race_stage_schedule JOIN races ON races.id = race_stage_schedule.race_id" : table;
      const count = to === null ? rowLimit : to - from + 1;
      const result = await pg.query(`SELECT ${projection} FROM ${relation}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""}${orders.length ? ` ORDER BY ${orders.join(",")}` : ""}${count === null ? "" : ` LIMIT ${count}`} OFFSET ${from}`, params);
      return { data: result.rows, error: null };
    };
    const bind = (value) => { params.push(value); return `$${params.length}`; };
    const chain = {
      select(value) { columns = value; return chain; },
      eq(key, value) { filters.push(`${key} = ${bind(value)}`); return chain; },
      in(key, values) { filters.push(`${key} = ANY(${bind(values)}::text[])`); return chain; },
      is(key) { filters.push(`${key} IS NULL`); return chain; },
      not(key) { filters.push(`${key} IS NOT NULL`); return chain; },
      order(key, { ascending = true } = {}) { orders.push(`${key} ${ascending ? "ASC" : "DESC"}`); return chain; },
      limit(count) { rowLimit = count; return chain; },
      then(resolve, reject) { return run().then(resolve, reject); },
      range(from, to) { return run(from, to); },
      maybeSingle() { return run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
    };
    return chain;
  } };
}
before(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE app_config(key text PRIMARY KEY, value jsonb, updated_at timestamptz NOT NULL DEFAULT '2026-10-01T00:00:00Z');
    CREATE TABLE races(id text PRIMARY KEY, season_id text);
    CREATE TABLE race_stage_schedule(race_id text, scheduled_at timestamptz);
    CREATE TABLE teams(id text PRIMARY KEY, league_division_id text DEFAULT 'd1', u23_league_division_id text, junior_league_division_id text, is_ai boolean DEFAULT false, parked_at timestamptz, assistant_autopick_enabled boolean, is_bank boolean DEFAULT false, is_frozen boolean DEFAULT false, is_test_account boolean DEFAULT false, created_at timestamptz, comeback_at timestamptz);
    CREATE TABLE riders(id text PRIMARY KEY, team_id text, is_retired boolean DEFAULT false, created_at timestamptz, acquired_at timestamptz);
    CREATE TABLE training_date_work(team_id text, season_id text, tick_date text, status text, PRIMARY KEY(team_id,season_id,tick_date));
    CREATE TABLE training_day_runs(id text PRIMARY KEY, team_id text, tick_date text, game_day integer, report jsonb);
  `);
});
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec(`TRUNCATE app_config,races,race_stage_schedule,teams,riders,training_date_work,training_day_runs;
    INSERT INTO races VALUES('s4-last','s4');
    INSERT INTO race_stage_schedule VALUES('s4-last','2026-10-25T14:00Z');
    INSERT INTO teams(id,is_ai) VALUES('human',false),('ai',true);
    INSERT INTO riders(id,team_id) VALUES('rh','human'),('ra','ai');
    INSERT INTO training_date_work VALUES('human','s4','2026-10-25','complete');`);
});
const season = { id: "s4", number: 4, end_date: null };
const lateEvening = new Date("2026-10-26T19:00:00Z");

test("final training date: off still requires the AI team's receipt (today's rule)", async () => {
  const result = await readiness.assessFinalTrainingDateSettlement({ supabase: pgClient(), season, now: lateEvening });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.blockers, [{ team_id: "ai", reason: "missing_registration" }]);
});

test("final training date: with the switch on an unregistered AI team does not block; registered AI work still does", async () => {
  await pg.exec(`INSERT INTO app_config VALUES('${AI_TEAM_FROZEN_STATE_KEY}', '"on"')`);
  const free = await readiness.assessFinalTrainingDateSettlement({ supabase: pgClient(), season, now: lateEvening });
  assert.equal(free.blocked, false);
  await pg.exec(`INSERT INTO training_date_work VALUES('ai','s4','2026-10-25','pending')`);
  const pending = await readiness.assessFinalTrainingDateSettlement({ supabase: pgClient(), season, now: lateEvening });
  assert.equal(pending.blocked, true);
  assert.deepEqual(pending.blockers, [{ team_id: "ai", reason: "pending" }]);
});

test("final training date: a missing human team still blocks with the switch on", async () => {
  await pg.exec(`INSERT INTO app_config VALUES('${AI_TEAM_FROZEN_STATE_KEY}', '"on"'); DELETE FROM training_date_work;`);
  const result = await readiness.assessFinalTrainingDateSettlement({ supabase: pgClient(), season, now: lateEvening });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.blockers, [{ team_id: "human", reason: "missing_registration" }]);
});

test("ON fixture constant is the switch key", () => assert.deepEqual(Object.keys(ON), [AI_TEAM_FROZEN_STATE_KEY]));
