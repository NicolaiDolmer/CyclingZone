// #7982 trin 1: the "earlier date not settled" check in commit_training_date_tick is one lookup
// for all riders instead of one full read per rider. This file runs the FROZEN function (the
// 2026-11-09-7737 body, checked against prod by its prosrc md5) and the migrated function on the
// same data in the same database, and asserts the same answer, the same rows and the same error
// (SQLSTATE and text) for every call. PGlite = PostgreSQL 17, one connection.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const file = async (name) => (await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const FROZEN_SOURCE = "2026-11-09-7737-train-now-instant.sql";
const MIGRATION = "2026-11-12-7982-commit-training-date-tick-samlet-tjek.sql";
// md5(prosrc) of commit_training_date_tick in prod on 12/11, before this migration.
const PROD_SOURCE_MD5 = "27587b9a8606ae6778209387a8cebf40";
const SIGNATURE = "(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz)";

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), OTHER_TEAM = id(2), SEASON = id(900), OLD_SEASON = id(901);
const RIDERS = [11, 12, 13, 14, 15, 16, 17, 18].map(id);
const OUTSIDER = id(99);
const DATE = "2026-11-09", DAYS = [41, 42, 43, 44, 45];
const EARLIER = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const AT = (minute) => `2026-11-09T06:${String(minute).padStart(2, "0")}:00Z`;
const arr = (ids) => `'{${ids.join(",")}}'::uuid[]`;
const j = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;

// The frozen definition, published next to the migrated one under its own name.
async function frozenFunctionSql() {
  const source = await file(FROZEN_SOURCE);
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.commit_training_date_tick(");
  const end = source.indexOf("$$;", start) + 3;
  assert.ok(start > 0 && end > start, "frozen definition found");
  return source.slice(start, end).replace("public.commit_training_date_tick(", "public.commit_training_date_tick_frozen(");
}

async function newDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))");
  await db.exec(await file(FROZEN_SOURCE));
  await db.exec(await frozenFunctionSql());
  await db.exec(await file(MIGRATION));
  await db.exec(await file(MIGRATION)); // idempotent
  await db.exec(`INSERT INTO riders(id,team_id) VALUES ${RIDERS.map((r) => `('${r}','${TEAM}')`).join(",")},('${OUTSIDER}','${OTHER_TEAM}');
    INSERT INTO rider_derived_abilities VALUES ${[...RIDERS, OUTSIDER].map((r) => `('${r}',50,'{}')`).join(",")};
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES ${[...RIDERS, OUTSIDER].map((r) => `('${r}',50,32,'2026-11-08T20:00:00Z')`).join(",")};`);
  return db;
}

let dbs = [];
const fresh = async () => { const db = await newDb(); dbs.push(db); return db; };
before(() => { dbs = []; });
after(async () => { for (const db of dbs) await db.close(); });

const scalar = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];

async function dump(db) {
  const out = {};
  for (const [table, order] of [["training_rider_ticks", "rider_id,game_day"], ["training_condition_settlements", "rider_id,tick_date"], ["rider_condition", "rider_id"], ["rider_derived_abilities", "rider_id"], ["training_date_work", "team_id,season_id,tick_date"], ["training_day_runs", "team_id,game_day"], ["training_race_loads", "rider_id"], ["training_condition_timeout_outbox", "team_id,tick_date"]]) {
    out[table] = (await db.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows.map(({ id: _id, ...row }) => row);
  }
  return out;
}

const register = async (db, riders) => (await db.query(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}',${arr(riders)},NULL,'${AT(0)}') AS w`)).rows[0].w;

// One call of the given function; the answer and the rows, or the error's code and text.
async function call(db, fn, { day, riders, openings, conditions = [], at = AT(1) }) {
  const report = { condition_per_date: true, riders: riders.map((rider) => ({ rider_id: rider, game_day: day, intensity: "normal", condition_before_date: openings[rider] ?? null, condition_observed: openings[rider] ?? null, missing_evidence: [] })) };
  try {
    const result = (await db.query(`SELECT ${fn}('${TEAM}','${SEASON}','senior',${day},'${DATE}','{${DAYS}}','manager',${j(report)},'[]',${j(conditions)},'[]','[]','[]','[]',false,'${at}') AS r`)).rows[0].r;
    return { result, rows: await dump(db) };
  } catch (e) {
    return { error: { code: e.code, message: e.message } };
  }
}

// Run the frozen and the migrated function on the same state, each in its own savepoint.
async function both(db, args) {
  const out = {};
  for (const fn of ["commit_training_date_tick_frozen", "commit_training_date_tick"]) {
    await db.exec("SAVEPOINT eq");
    out[fn] = await call(db, fn, args);
    await db.exec("ROLLBACK TO SAVEPOINT eq");
  }
  assert.deepEqual(out.commit_training_date_tick, out.commit_training_date_tick_frozen);
  return out.commit_training_date_tick;
}

const earlierDate = (db, { team = TEAM, season = SEASON, date, expected, quarantined = [] }) =>
  db.exec(`INSERT INTO training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,deadline_at,status,quarantined_rider_ids)
    VALUES('${team}','${season}','${date}','{1,2,3,4,5}',${arr(expected)},'${date}T01:00:00Z','partial',${arr(quarantined)})`);
const settle = (db, rider, date, { team = TEAM, season = SEASON } = {}) =>
  db.exec(`INSERT INTO training_condition_settlements(rider_id,season_id,tick_date,team_id) VALUES('${rider}','${season}','${date}','${team}') ON CONFLICT DO NOTHING`);
const tick = (db, rider, day) =>
  db.exec(`INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report) VALUES('${rider}','${SEASON}',${day},'${DATE}','${TEAM}','{}')`);

// A fixed case inside its own transaction, so every case starts from the same base rows.
async function inCase(db, fn) {
  await db.exec("BEGIN");
  try { return await fn(); } finally { await db.exec("ROLLBACK"); }
}

test("the frozen copy is the prod definition, and the migration changes only the earlier-date check", async () => {
  const db = await fresh();
  assert.equal(await scalar(db, `SELECT md5(prosrc) FROM pg_proc WHERE proname='commit_training_date_tick_frozen'`), PROD_SOURCE_MD5);
  const frozen = await scalar(db, `SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick_frozen'`);
  const migrated = await scalar(db, `SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick'`);
  assert.notEqual(migrated, frozen);
  // Every lock statement is the same, in the same order.
  const locks = (src) => src.split("\n").filter((line) => /pg_advisory|FOR UPDATE/.test(line)).map((line) => line.trim());
  assert.deepEqual(locks(migrated), locks(frozen));
  // Outside the rewritten check the body is the same text.
  const strip = (src) => src.replace(/;v_earlier uuid\[\]:='\{\}'/, "")
    .replace(/ {2}-- #7982:[\s\S]*?s\.tick_date=older\.tick_date\);\n/, "")
    .replace(/IF v_rider=ANY\(v_earlier\) THEN/, "IF @@CHECK@@ THEN")
    .replace(/IF EXISTS\(SELECT 1 FROM public\.training_date_work older[\s\S]*?s\.tick_date=older\.tick_date\)\) THEN/, "IF @@CHECK@@ THEN");
  assert.equal(strip(migrated), strip(frozen));
});

test("rights: service_role only, SECURITY INVOKER, fixed search_path, no RLS change, GIN index present", async () => {
  const db = await fresh();
  const proc = (await db.query(`SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.commit_training_date_tick${SIGNATURE}'::regprocedure`)).rows[0];
  assert.equal(proc.prosecdef, false);
  assert.deepEqual(proc.proconfig, ["search_path=public, pg_temp"]);
  for (const [role, allowed] of [["service_role", true], ["anon", false], ["authenticated", false]]) {
    assert.equal(await scalar(db, `SELECT has_function_privilege('${role}','public.commit_training_date_tick${SIGNATURE}','EXECUTE')`), allowed, role);
  }
  await db.exec("SET ROLE anon");
  await assert.rejects(db.query(`SELECT commit_training_date_tick('${TEAM}','${SEASON}','senior',41,'${DATE}','{${DAYS}}','manager','{}','[]','[]','[]','[]','[]','[]',false,'${AT(1)}')`), /permission denied/);
  await db.exec("RESET ROLE");
  assert.doesNotMatch(await file(MIGRATION), /POLICY|ROW LEVEL SECURITY|SECURITY DEFINER/i);
  assert.match(await scalar(db, "SELECT indexdef FROM pg_indexes WHERE indexname='training_date_work_expected_rider_ids_gin'"), /USING gin \(expected_rider_ids\)/);
});

// A prod-sized table (about 12 000 dates: many teams, a season of dates, 40 riders each). The
// planner picks the new index for a 40-rider call without any planner settings.
test("on a prod-sized table the lookup uses the new index", async () => {
  const db = await fresh();
  await db.exec(`INSERT INTO training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,deadline_at,status)
    SELECT md5('team'||t)::uuid,'${SEASON}',DATE '2026-11-08'-d,'{1,2,3,4,5}',
      ARRAY(SELECT md5('rider'||t||':'||r)::uuid FROM generate_series(1,40) r),now(),'complete'
    FROM generate_series(1,300) t, generate_series(0,39) d; ANALYZE training_date_work;`);
  const plan = (await db.query(`EXPLAIN SELECT member.rider_id FROM training_date_work older CROSS JOIN LATERAL unnest(older.expected_rider_ids) member(rider_id)
    WHERE older.season_id='${SEASON}' AND older.tick_date<'${DATE}'
      AND older.expected_rider_ids && ARRAY(SELECT md5('rider7:'||r)::uuid FROM generate_series(1,40) r)`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
  assert.match(plan, /Bitmap Index Scan on training_date_work_expected_rider_ids_gin/);
});

test("an empty call gives the same already_ran answer", async () => {
  const db = await fresh();
  const out = await inCase(db, async () => {
    const { opening_conditions: openings } = await register(db, RIDERS.slice(0, 3));
    return both(db, { day: 41, riders: [], openings });
  });
  assert.equal(out.result.already_ran, true);
});

test("a rider with an unsettled earlier date gets the same error; settled or quarantined there he does not", async () => {
  const db = await fresh();
  const [a, b] = RIDERS;
  for (const variant of ["unsettled", "settled", "quarantined", "other season", "later date"]) {
    const out = await inCase(db, async () => {
      if (variant === "other season") await earlierDate(db, { season: OLD_SEASON, date: EARLIER[3], expected: [a, b] });
      else if (variant === "later date") await earlierDate(db, { date: "2026-11-10", expected: [a, b] });
      else await earlierDate(db, { date: EARLIER[3], expected: [a, b], quarantined: variant === "quarantined" ? [a] : [] });
      await settle(db, b, EARLIER[3]);
      if (variant === "settled") await settle(db, a, EARLIER[3]);
      const { opening_conditions: openings } = await register(db, [a, b]);
      return both(db, { day: 41, riders: [a, b], openings });
    });
    if (variant === "unsettled") assert.deepEqual(out.error, { code: "P0001", message: "Earlier rider date condition settlement is incomplete" });
    else assert.deepEqual(out.result.applied_rider_ids, [a, b], variant);
  }
});

test("a rider who changed team: his old team's unsettled date blocks him, a settled one does not", async () => {
  const db = await fresh();
  const [a, b] = RIDERS;
  for (const settled of [false, true]) {
    const out = await inCase(db, async () => {
      await earlierDate(db, { team: OTHER_TEAM, date: EARLIER[2], expected: [a, OUTSIDER] });
      await earlierDate(db, { date: EARLIER[3], expected: [a, b] });
      await settle(db, a, EARLIER[3]); await settle(db, b, EARLIER[3]);
      if (settled) await settle(db, a, EARLIER[2], { team: OTHER_TEAM });
      const { opening_conditions: openings } = await register(db, [a, b]);
      return both(db, { day: 41, riders: [b, a], openings });
    });
    if (settled) assert.deepEqual([...out.result.applied_rider_ids].sort(), [a, b]);
    else assert.equal(out.error.message, "Earlier rider date condition settlement is incomplete");
  }
});

test("the same error wins as before when two riders fail different checks, whichever rider comes first", async () => {
  const db = await fresh();
  const seen = new Set();
  // One rider has an unsettled earlier date, the other misses an earlier tick on this date.
  // Swapping who is who flips which rider the per-rider loop meets first.
  for (const [unsettled, untick] of [[RIDERS[0], RIDERS[1]], [RIDERS[1], RIDERS[0]]]) {
    for (const order of [[RIDERS[0], RIDERS[1]], [RIDERS[1], RIDERS[0]]]) {
      const out = await inCase(db, async () => {
        await earlierDate(db, { date: EARLIER[3], expected: [unsettled, untick] });
        await settle(db, untick, EARLIER[3]);
        const { opening_conditions: openings } = await register(db, [unsettled, untick]);
        await tick(db, unsettled, 41);
        return both(db, { day: 42, riders: order, openings });
      });
      seen.add(out.error.message);
    }
  }
  assert.deepEqual([...seen].sort(), ["Earlier rider date condition settlement is incomplete", "Earlier rider date ticks must commit first"]);
});

test("a rider quarantined on today's date is left out the same way", async () => {
  const db = await fresh();
  const [a, b, c] = RIDERS;
  const out = await inCase(db, async () => {
    await earlierDate(db, { date: EARLIER[3], expected: [a, b, c] });
    for (const r of [a, b, c]) await settle(db, r, EARLIER[3]);
    const { opening_conditions: openings } = await register(db, [a, b, c]);
    await db.exec(`UPDATE rider_condition SET fatigue=7 WHERE rider_id='${c}'`); // unsafe current state
    return both(db, { day: 41, riders: [a, b, c], openings });
  });
  assert.deepEqual(out.result.applied_rider_ids, [a, b]);
  assert.deepEqual(out.rows.training_date_work.find((w) => w.game_days.includes(41)).quarantined_rider_ids, [c]);
});

// Seeded random cases: rosters across two teams and two seasons, quarantines on earlier and on
// today's date, settled and unsettled earlier dates, earlier ticks, repeats, riders outside the
// roster, the final tick, and report order. Every call must match the frozen function exactly.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (rand, list, p) => list.filter(() => rand() < p);
const shuffle = (rand, list) => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const k = Math.floor(rand() * (i + 1)); [out[i], out[k]] = [out[k], out[i]]; } return out; };

test("seeded random cases: same answer, rows and error as the frozen function", async () => {
  const db = await fresh();
  const tally = {};
  for (let seed = 1; seed <= 120; seed++) {
    const rand = rng(seed);
    const out = await inCase(db, async () => {
      for (const date of EARLIER) for (const team of [TEAM, OTHER_TEAM]) {
        if (rand() < 0.4) continue;
        const expected = pick(rand, RIDERS, 0.6);
        const quarantined = pick(rand, expected, 0.15);
        await earlierDate(db, { team, date, expected, quarantined });
        for (const r of expected) if (rand() < 0.8) await settle(db, r, date, { team });
      }
      if (rand() < 0.3) await earlierDate(db, { season: OLD_SEASON, date: EARLIER[1], expected: pick(rand, RIDERS, 0.7) });
      const roster = shuffle(rand, RIDERS).slice(0, 2 + Math.floor(rand() * 7));
      const { opening_conditions: openings } = await register(db, roster);
      for (const r of pick(rand, roster, 0.2)) await db.exec(`UPDATE rider_condition SET fatigue=7 WHERE rider_id='${r}'`);
      const day = [41, 42, 45][Math.floor(rand() * 3)];
      for (const r of roster) for (const d of DAYS) {
        if (d < day && rand() < 0.85) await tick(db, r, d);
        if (d === day && rand() < 0.1) await tick(db, r, d);
      }
      let riders = pick(rand, shuffle(rand, roster), 0.8);
      if (rand() < 0.05) riders = [...riders, OUTSIDER];
      const conditions = day === 45 ? riders.map((r) => ({ rider_id: r, form: 51, fatigue: 25, injured_until: null, injury_cause: null, updated_at: AT(5) })) : [];
      return both(db, { day, riders, openings, conditions, at: AT(10) });
    });
    const key = out.error ? out.error.message : out.result.already_ran ? "already_ran" : "applied";
    tally[key] = (tally[key] ?? 0) + 1;
  }
  for (const key of ["applied", "already_ran", "Earlier rider date condition settlement is incomplete", "Earlier rider date ticks must commit first"]) {
    assert.ok(tally[key] > 0, `the random cases reach "${key}" (${JSON.stringify(tally)})`);
  }
});
