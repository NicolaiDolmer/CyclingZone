// #8614: AI-hold fast tilstand (valg B) bag ai_team_frozen_state_8614.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AI_TEAM_FROZEN_STATE_KEY, AI_TEAM_FROZEN_RESET_CLAIM_KEY, AI_FROZEN_FATIGUE, AI_FROZEN_FORM,
  AI_FROZEN_RESET_STALE_CLAIM_MS, isAiTeamFrozenStateEnabled, skipsFrozenAiTeamTick,
  applyFrozenAiEntrantState, dropFrozenAiInjuryRows, frozenAiResetRow, applyAiFrozenStateResetOnce,
  runAiFrozenStateResetPhase,
} from "./aiTeamFrozenState8614.js";
import { runNormalizedTrainingDateSweep, __resetNormalizedTrainingDateCacheForTests } from "./trainingDateClose.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { findStageFlag } from "./stageFlagCatalog.js";
import { runSweepScenario, flagClient } from "./__fixtures__/aiTeamFrozenState8614Scenarios.js";
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
    teams, riders, upserts: [], calls: [],
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
          if (failUpsert) return { data: null, error: { message: "upsert failed" } };
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

test("one-time reset: off writes nothing", async () => {
  const db = memoryDb({ flag: "off", teams: TEAMS, riders: RIDERS });
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: db }), { ran: false, reason: "flag_off" });
  assert.deepEqual(db.state.calls, ["select:app_config"]);
  assert.equal(await runAiFrozenStateResetPhase({ supabase: db }), null, "off: no phase row");
});

test("one-time reset: resets only active AI riders, then never again", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS });
  const now = new Date("2026-11-26T18:00:00Z");
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: db, now }), { ran: true, riders: 2 });
  assert.deepEqual(db.state.upserts.map((r) => r.rider_id).sort(), ["r-ai1", "r-ai2"]);
  assert.ok(db.state.upserts.every((r) => r.fatigue === AI_FROZEN_FATIGUE && r.injured_until === null));
  assert.equal(db.state.app_config.get(AI_TEAM_FROZEN_RESET_CLAIM_KEY).status, "done");
  const writes = db.state.upserts.length;
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: db, now }), { ran: false, reason: "already_done" });
  assert.equal(db.state.upserts.length, writes, "second run writes nothing");
  const phase = await runAiFrozenStateResetPhase({ supabase: db, now });
  assert.deepEqual(phase, { phase: "ai_team_frozen_reset_8614", ran: false, reason: "already_done" });
});

test("one-time reset: a fresh claim held elsewhere is respected; a stale one is retaken", async () => {
  const now = new Date("2026-11-26T18:00:00Z");
  const fresh = memoryDb({ teams: TEAMS, riders: RIDERS, claim: { status: "claimed", claimed_at: new Date(now - 60_000).toISOString() } });
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: fresh, now }), { ran: false, reason: "claim_held" });
  assert.equal(fresh.state.upserts.length, 0);
  const staleAt = new Date(now - AI_FROZEN_RESET_STALE_CLAIM_MS - 1000).toISOString();
  const stale = memoryDb({ teams: TEAMS, riders: RIDERS, claim: { status: "claimed", claimed_at: staleAt } });
  assert.deepEqual(await applyAiFrozenStateResetOnce({ supabase: stale, now }), { ran: true, riders: 2 });
});

test("one-time reset: a failed write releases the claim so the next transition retries", async () => {
  const db = memoryDb({ teams: TEAMS, riders: RIDERS, failUpsert: true });
  await assert.rejects(applyAiFrozenStateResetOnce({ supabase: db }), /upsert failed/);
  assert.equal(db.state.app_config.has(AI_TEAM_FROZEN_RESET_CLAIM_KEY), false);
  const phase = await runAiFrozenStateResetPhase({ supabase: memoryDb({ teams: TEAMS, riders: RIDERS, failUpsert: true }) });
  assert.equal(phase.phase, "ai_team_frozen_reset_8614");
  assert.match(phase.error, /upsert failed/);
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
    CREATE TABLE app_config(key text PRIMARY KEY, value jsonb);
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
