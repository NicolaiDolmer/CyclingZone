// #7982: old/new oracle for the press's own date context reader. Both readers run against
// the same real SQL (PGlite): the old one through a small PostgREST stand-in, the new one
// through the real migration. For the pressing team they must give the same riders, the
// same team row, the same race days and the same readiness (open slots, frozen slots,
// eligible riders), before and after the deadline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { loadTrainingDateContext, resolveTrainingDateReadiness } from "./trainingDateReadiness.js";
import { loadDayCloseSpans } from "./trainingDayCloseTrigger.js";
import {
  loadTrainNowDateContext, isMissingTrainNowDateContextRpc, TRAIN_NOW_DATE_CONTEXT_RPC,
} from "./trainNowDateContext.js";

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SEASON = id(900), PREV = id(899);
const D1 = id(901), D2 = id(902), DU = id(903);
const T = id(1), O = id(2), P = id(3), Q = id(4);
const R0 = id(800), R1 = id(801), R1B = id(802), R2 = id(803), R2B = id(804), RU = id(805), RN = id(806), R3 = id(807), RX = id(808);
const r = (n) => id(100 + n);
const o1 = id(201), o2 = id(202), p1 = id(301), x1 = id(401);
const DATE_A = "2026-11-12", DATE_B = "2026-11-13", DATE_LAST = "2026-11-20", DATE_BRIDGE = "2026-11-03";
const season = { id: SEASON, number: 5 };

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE seasons(id uuid PRIMARY KEY, number int, start_date date, end_date date);
CREATE TABLE teams(id uuid PRIMARY KEY, league_division_id uuid, u23_league_division_id uuid, junior_league_division_id uuid,
  is_ai boolean, parked_at timestamptz, assistant_autopick_enabled boolean, is_bank boolean, is_frozen boolean,
  is_test_account boolean, created_at timestamptz, comeback_at timestamptz);
CREATE TABLE riders(id uuid PRIMARY KEY, team_id uuid, squad text, is_academy boolean, is_retired boolean,
  pending_team_id uuid, created_at timestamptz, acquired_at timestamptz);
CREATE TABLE races(id uuid PRIMARY KEY, season_id uuid, league_division_id uuid, race_type text, squad text,
  stages_completed int, finalize_state text);
CREATE TABLE race_stage_schedule(race_id uuid, stage_number int, game_day int, scheduled_at timestamptz);
CREATE TABLE race_simulation_runs(race_id uuid, stage_number int, entrant_snapshot jsonb);
CREATE TABLE race_entries(race_id uuid, rider_id uuid, team_id uuid);
CREATE TABLE race_results(id serial, race_id uuid, stage_number int, rider_id uuid, result_type text);
CREATE TABLE race_incidents(id serial, race_id uuid, stage_number int, rider_id uuid, outcome text);
CREATE TABLE training_race_loads(rider_id uuid, race_id uuid, stage_number int, season_id uuid, game_day int, tick_date date, load numeric);
CREATE TABLE training_train_now_locks(rider_id uuid, tick_date date, season_id uuid, team_id uuid, pressed_at timestamptz,
  instant_entry_snapshot jsonb);`;

const SEED = `
INSERT INTO seasons VALUES ('${PREV}',4,'2026-09-01','2026-11-01'), ('${SEASON}',5,'2026-11-05','2026-12-31');
INSERT INTO teams VALUES
  ('${T}','${D1}','${DU}',NULL,false,NULL,true,false,false,false,'2026-01-01T00:00:00Z',NULL),
  ('${O}','${D1}',NULL,NULL,true,NULL,false,false,false,false,'2026-01-01T00:00:00Z',NULL),
  ('${P}','${D2}',NULL,NULL,false,NULL,true,false,false,false,'2026-01-01T00:00:00Z',NULL),
  ('${Q}',NULL,NULL,NULL,false,'2026-10-01T00:00:00Z',false,false,false,false,'2026-01-01T00:00:00Z',NULL);
INSERT INTO riders VALUES
  ('${r(1)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(2)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(3)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(4)}','${T}','senior',true,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(5)}','${T}','u23',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(6)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z','2026-11-12T08:00:00Z'),
  ('${r(7)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z','2026-11-13T05:00:00Z'),
  ('${r(8)}','${T}','senior',false,false,'${P}','2026-01-01T00:00:00Z',NULL),
  ('${r(10)}','${T}','senior',false,true,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(11)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${r(12)}','${T}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${o1}','${O}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${o2}','${O}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${p1}','${P}','senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL),
  ('${x1}',NULL,'senior',false,false,NULL,'2026-01-01T00:00:00Z',NULL);
INSERT INTO races VALUES
  ('${R0}','${SEASON}','${D1}','stage','senior',2,NULL),
  ('${R1}','${SEASON}','${D1}','stage','senior',1,NULL),
  ('${R1B}','${SEASON}','${D1}','single','senior',0,NULL),
  ('${R3}','${SEASON}','${D1}','single','senior',0,NULL),
  ('${RX}','${SEASON}','${D1}','single','senior',0,NULL),
  ('${R2}','${SEASON}','${D2}','single','senior',1,'pending'),
  ('${R2B}','${SEASON}','${D2}','single','senior',1,NULL),
  ('${RU}','${SEASON}','${DU}','single','u23',0,NULL),
  ('${RN}','${SEASON}',NULL,'single','senior',0,NULL);
INSERT INTO race_stage_schedule VALUES
  ('${R0}',1,20,'2026-11-10T15:00:00Z'), ('${R0}',2,25,'2026-11-11T15:00:00Z'),
  ('${R1}',1,26,'2026-11-11T16:00:00Z'), ('${R1}',2,30,'2026-11-12T15:00:00Z'), ('${R1}',3,35,'2026-11-13T15:00:00Z'),
  ('${R1B}',1,31,'2026-11-12T12:00:00Z'),
  ('${R2B}',1,10,'2026-11-08T10:00:00Z'), ('${R2}',1,30,'2026-11-12T10:00:00Z'),
  ('${RU}',1,30,'2026-11-12T09:00:00Z'),
  ('${RN}',1,32,'2026-11-12T13:00:00Z'),
  ('${RX}',1,153,'2026-11-19T15:00:00Z'), ('${R3}',1,154,'2026-11-20T15:00:00Z');
INSERT INTO race_simulation_runs VALUES
  ('${R2}',1,'["${p1}","${r(6)}"]'),
  ('${RU}',1,'["${r(5)}", 7]');
INSERT INTO race_entries VALUES
  ('${RN}','${r(1)}','${T}'), ('${R1}','${r(2)}','${T}'), ('${R1}','${r(3)}','${T}'), ('${R1}','${r(12)}','${T}'),
  ('${R1B}','${r(4)}','${T}'), ('${RU}','${r(5)}','${T}'), ('${R2}','${r(6)}','${P}'), ('${R1}','${r(11)}','${T}'),
  ('${R1}','${o1}','${O}'), ('${R1}','${o2}','${O}'), ('${R2}','${p1}','${P}'), ('${R1}','${x1}','${T}'),
  ('${R1}','${r(7)}','${T}'), ('${R3}','${r(2)}','${T}');
INSERT INTO race_results(race_id,stage_number,rider_id,result_type) VALUES
  ('${R1}',2,'${r(3)}','stage'), ('${R2}',1,'${r(6)}','stage'), ('${R2}',1,'${p1}','stage'), ('${R1}',2,'${o1}','gc'),
  ('${R0}',2,'${r(1)}','stage');
INSERT INTO race_incidents(race_id,stage_number,rider_id,outcome) VALUES
  ('${R1}',2,'${r(12)}','abandon'), ('${R1}',2,'${o2}','abandon'), ('${R1}',2,'${r(2)}','crash');
INSERT INTO training_race_loads VALUES
  ('${r(3)}','${R1}',2,'${SEASON}',30,'${DATE_A}',9.5), ('${r(12)}','${R1}',2,'${SEASON}',30,'${DATE_A}',4.25),
  ('${o1}','${R1}',2,'${SEASON}',30,'${DATE_A}',9), ('${p1}','${R2}',1,'${SEASON}',30,'${DATE_A}',9);
INSERT INTO training_train_now_locks VALUES
  ('${r(11)}','${DATE_A}','${SEASON}','${T}','2026-11-12T07:00:00Z','{"slots":[{"raceId":"${R1}","stageNumber":2,"gameDay":30}]}'),
  ('${r(1)}','${DATE_A}','${SEASON}','${T}','2026-11-12T07:00:00Z',NULL),
  ('${o1}','${DATE_A}','${SEASON}','${O}','2026-11-12T07:00:00Z','{"slots":[]}');`;

// A small PostgREST stand-in: just the query shapes the old loader sends.
function postgrest(db) {
  return {
    from(table) {
      const q = { cols: [], where: [], params: [], orderBy: [], limit: null, offset: null, join: false };
      const add = (sql, value) => { q.params.push(value); q.where.push(sql.replace("?", `$${q.params.length}`)); return builder; };
      const col = (name) => (name.includes(".") ? name : `t.${name}`);
      const run = async () => {
        const select = q.cols.map((c) => (c === "races!inner(season_id)" ? "jsonb_build_object('season_id', races.season_id) AS races" : `t.${c}`));
        let sql = `SELECT ${select.join(",")} FROM public.${table} t${q.join ? " JOIN public.races races ON races.id = t.race_id" : ""}`;
        if (q.where.length) sql += ` WHERE ${q.where.join(" AND ")}`;
        if (q.orderBy.length) sql += ` ORDER BY ${q.orderBy.join(",")}`;
        if (q.limit != null) sql += ` LIMIT ${q.limit}`;
        if (q.offset != null) sql += ` OFFSET ${q.offset}`;
        try {
          const rows = (await db.query(`SELECT to_jsonb(x) AS j FROM (${sql}) x`, q.params)).rows.map((row) => row.j);
          return { data: rows, error: null };
        } catch (error) {
          return { data: null, error: { code: error.code, message: error.message } };
        }
      };
      const builder = {
        select(cols) { q.cols = cols.split(",").map((c) => c.trim()); q.join = q.cols.includes("races!inner(season_id)"); return builder; },
        eq: (c, v) => add(`${col(c)} = ?`, v),
        gte: (c, v) => add(`${col(c)} >= ?`, v),
        lt: (c, v) => add(`${col(c)} < ?`, v),
        in: (c, vs) => add(`${col(c)}::text = ANY(?)`, vs),
        not(c, op, v) { assert.equal(op, "is"); assert.equal(v, null); q.where.push(`${col(c)} IS NOT NULL`); return builder; },
        order(c, { ascending = true } = {}) { q.orderBy.push(`${col(c)} ${ascending ? "ASC" : "DESC"}`); return builder; },
        limit(n) { q.limit = n; return builder; },
        range(from, to) { q.offset = from; q.limit = to - from + 1; return builder; },
        async maybeSingle() { const { data, error } = await run(); return { data: data?.[0] ?? null, error }; },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return builder;
    },
    async rpc(name, args) {
      assert.equal(name, TRAIN_NOW_DATE_CONTEXT_RPC);
      try {
        const result = await db.query("SELECT public.train_now_date_context($1,$2,$3,$4,$5) AS r",
          [args.p_team_id, args.p_season_id, args.p_tick_date, args.p_day_start, args.p_day_end]);
        return { data: result.rows[0].r, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };
}

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(SCHEMA);
  await db.exec(SEED);
  await db.exec(await readFile(new URL("../../database/2026-11-12-7982-train-now-date-context.sql", import.meta.url), "utf8"));
  return db;
}

const sortSlots = (slots) => [...slots].sort((a, b) => `${a.raceId}:${a.stageNumber}`.localeCompare(`${b.raceId}:${b.stageNumber}`));
const canonicalSlots = (byRider) => Object.fromEntries(Object.entries(byRider).sort(([a], [b]) => a.localeCompare(b))
  .map(([rider, slots]) => [rider, sortSlots(slots)]));

// What the press reads from a context (trainNow.js + trainNowWholeDay.js).
function pressView(ctx, { tickDate, now }) {
  const riders = ctx.riders.filter((rider) => rider.team_id === T);
  const riderIds = riders.map((rider) => rider.id);
  const readiness = resolveTrainingDateReadiness({ ...ctx, tickDate, now, riderIds });
  return {
    riders,
    team: ctx.teams.find((team) => team.id === T) ?? null,
    days: ctx.gameDaysByDivision.get(D1) ?? null,
    readiness: {
      deadlineAt: readiness.deadlineAt.toISOString(),
      deadlineReached: readiness.deadlineReached,
      eligibleRiderIds: readiness.eligibleRiderIds,
      unresolvedSlotsByRider: canonicalSlots(readiness.unresolvedSlotsByRider),
      resolvedFrozenSlotsByRider: canonicalSlots(readiness.resolvedFrozenSlotsByRider),
    },
  };
}

async function compare(db, tickDate, { label = tickDate, wholeCalendar = true } = {}) {
  const supabase = postgrest(db);
  const readers = [];
  const args = { supabase, season, tickDate, loadDaySpans: loadDayCloseSpans, registeredTeamIds: [T] };
  const oldCtx = await loadTrainingDateContext(args);
  const newCtx = await loadTrainNowDateContext({ ...args, onReader: (reader) => readers.push(reader), fallback: () => assert.fail("fallback used") });
  assert.deepEqual(readers, ["rpc"], label);
  for (const now of [new Date(`${tickDate}T08:00:00Z`), new Date(`${tickDate}T23:30:00Z`), new Date(Date.parse(`${tickDate}T12:00:00Z`) + 2 * 86400000)]) {
    assert.deepEqual(pressView(newCtx, { tickDate, now }), pressView(oldCtx, { tickDate, now }), `${label} at ${now.toISOString()}`);
  }
  // The calendar keeps the whole season: every division's race days are the same, not only the team's.
  if (wholeCalendar) assert.deepEqual([...newCtx.gameDaysByDivision].sort(), [...oldCtx.gameDaysByDivision].sort(), `${label} calendar`);
  return { oldCtx, newCtx };
}

test("#7982 oracle: race date with transfer, release, late registration, frozen slots, youth, academy, malformed and missing snapshots", async (t) => {
  const db = await database(t);
  const { oldCtx, newCtx } = await compare(db, DATE_A);
  const view = pressView(newCtx, { tickDate: DATE_A, now: new Date(`${DATE_A}T08:00:00Z`) });
  // The fixture really exercises the cases (not an empty comparison).
  assert.ok(view.days?.length > 1, "race days with a gap before today");
  assert.ok(view.readiness.unresolvedSlotsByRider[r(2)], "entered rider waits for his race");
  assert.ok(view.readiness.unresolvedSlotsByRider[r(6)], "transferred rider bound by another pool's start snapshot");
  assert.ok(view.readiness.unresolvedSlotsByRider[r(5)], "youth rider bound despite a malformed snapshot");
  assert.ok(view.readiness.unresolvedSlotsByRider[r(1)], "rider bound by a race without a division");
  for (const rider of [r(3), r(12)]) {
    assert.ok(!(view.readiness.unresolvedSlotsByRider[rider] ?? []).some((slot) => slot.raceId === R1), "result/abandon with load resolves");
    assert.ok((view.readiness.unresolvedSlotsByRider[rider] ?? []).some((slot) => slot.raceId === R1B), "autopick candidate in the race he is not entered in");
  }
  assert.ok(view.readiness.unresolvedSlotsByRider[r(7)], "a late-registered rider's entry is still seen");
  assert.ok(view.readiness.resolvedFrozenSlotsByRider[r(11)], "frozen slots are carried");
  assert.ok(!view.riders.some((rider) => rider.id === r(10) || rider.id === x1), "retired and released riders are not the team's");
  // Rows of other teams are left out; the press never reads them.
  assert.ok(newCtx.riders.length < oldCtx.riders.length);
});

test("#7982 oracle: other dates (next race date, the division's last race date, a bridge date)", async (t) => {
  const db = await database(t);
  await compare(db, DATE_B);
  // The division's last race date: its race days run on to the end of the season's axis.
  const last = await compare(db, DATE_LAST);
  const days = last.newCtx.gameDaysByDivision.get(D1);
  assert.ok(days.length > 1 && days[0] === 154, "last race date extends past today's race day");
  // On a bridge date the old loader gives every team's division the bridge days; the press
  // reads only its own division, which must match.
  const { oldCtx, newCtx } = await compare(db, DATE_BRIDGE, { wholeCalendar: false });
  assert.deepEqual(newCtx.gameDaysByDivision.get(D1), oldCtx.gameDaysByDivision.get(D1));
  assert.ok(newCtx.gameDaysByDivision.get(D1)?.length > 0, "bridge days exist");
});

test("#7982 oracle: unknown previous race day stays unknown, never day 0", async (t) => {
  const db = await database(t);
  await db.exec(`UPDATE race_stage_schedule SET game_day = NULL WHERE race_id = '${R0}' AND stage_number = 1`);
  const { newCtx } = await compare(db, DATE_A);
  assert.deepEqual(newCtx.gameDaysByDivision.get(D1), [30, 31]);
});

test("#7982 oracle: no own entries and autopick off; first race date of a division", async (t) => {
  const db = await database(t);
  await db.exec(`DELETE FROM race_entries WHERE team_id = '${T}'; UPDATE teams SET assistant_autopick_enabled = false WHERE id = '${T}';
    DELETE FROM race_stage_schedule WHERE race_id IN ('${R0}') OR (race_id = '${R1}' AND stage_number = 1);`);
  const { newCtx } = await compare(db, DATE_A);
  assert.ok(newCtx.gameDaysByDivision.get(D1)?.length > 2, "first race date takes the race days in front of today");
});

test("#7982: the function is read-only, service-only, SECURITY INVOKER with a locked search_path", async (t) => {
  const db = await database(t);
  const fn = "public.train_now_date_context(uuid,uuid,date,timestamptz,timestamptz)";
  const meta = (await db.query(`SELECT p.prosecdef, p.provolatile, p.proconfig FROM pg_proc p WHERE p.oid = '${fn}'::regprocedure`)).rows[0];
  assert.equal(meta.prosecdef, false);
  assert.equal(meta.provolatile, "s");
  assert.ok(meta.proconfig.some((setting) => setting.startsWith("search_path=")));
  for (const [role, allowed] of [["anon", false], ["authenticated", false], ["service_role", true]]) {
    const { rows } = await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS ok`);
    assert.equal(rows[0].ok, allowed, role);
  }
  // Running it twice changes nothing and gives the same answer.
  const supabase = postgrest(db);
  const args = { p_team_id: T, p_season_id: SEASON, p_tick_date: DATE_A, p_day_start: "2026-11-11T23:00:00Z", p_day_end: "2026-11-12T23:00:00Z" };
  assert.deepEqual((await supabase.rpc(TRAIN_NOW_DATE_CONTEXT_RPC, args)).data, (await supabase.rpc(TRAIN_NOW_DATE_CONTEXT_RPC, args)).data);
});

test("#7982: exactly a missing function falls back to the old reader; any other error fails closed", async () => {
  const base = { season, tickDate: DATE_A, loadDaySpans: async () => new Map(), registeredTeamIds: [T] };
  const failing = (error) => ({ rpc: async () => ({ data: null, error }) });
  for (const error of [
    { code: "PGRST202", message: `Could not find the function public.${TRAIN_NOW_DATE_CONTEXT_RPC}(p_team_id) in the schema cache` },
    { code: "42883", message: `function public.${TRAIN_NOW_DATE_CONTEXT_RPC}(uuid) does not exist` },
  ]) {
    assert.equal(isMissingTrainNowDateContextRpc(error), true);
    const readers = [];
    const seen = [];
    const ctx = await loadTrainNowDateContext({ ...base, supabase: failing(error), onReader: (reader) => readers.push(reader),
      fallback: async (args) => { seen.push(args.registeredTeamIds); return { legacy: true }; } });
    assert.deepEqual(ctx, { legacy: true });
    assert.deepEqual(readers, ["legacy"]);
    assert.deepEqual(seen, [[T]]);
  }
  for (const error of [
    { code: "PGRST202", message: "Could not find the function public.some_other_function in the schema cache" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "42501", message: "permission denied for function train_now_date_context" },
  ]) {
    assert.equal(isMissingTrainNowDateContextRpc(error), false);
    await assert.rejects(loadTrainNowDateContext({ ...base, supabase: failing(error), fallback: () => assert.fail("no fallback") }), /train-now date context/);
  }
  await assert.rejects(loadTrainNowDateContext({ ...base, supabase: { rpc: async () => ({ data: { riders: [] }, error: null }) } }), /missing/);
  await assert.rejects(loadTrainNowDateContext({ ...base, registeredTeamIds: [], supabase: failing(null) }), /team required/);
});

test("#7982: a malformed frozen slot list of the team's own rider still fails closed", async (t) => {
  const db = await database(t);
  await db.exec(`UPDATE training_train_now_locks SET instant_entry_snapshot = '{"slots":"x"}' WHERE rider_id = '${r(11)}'`);
  await assert.rejects(loadTrainNowDateContext({ supabase: postgrest(db), season, tickDate: DATE_A, loadDaySpans: loadDayCloseSpans, registeredTeamIds: [T] }),
    /invalid frozen slots/);
});
