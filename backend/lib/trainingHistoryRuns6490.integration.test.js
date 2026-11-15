// #6490 trin b1, b2 og c: training_history_runs / training_runs_from_ticks_6490 give the same rows
// as a SELECT on training_day_runs, with report.riders built from the receipts.
//
// The data is written by the REAL commit_training_date_tick (the migrated #7982 trin 1b body), so
// the copy in training_day_runs.report.riders is exactly what prod stores. Every check compares the
// function output with that stored copy, and once more after the copy is removed (the state trin d
// will leave), so the derivation can never lean on the copy. PGlite = PostgreSQL 17.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { loadTeamTrainingRuns } from "./racePeakPlans.js";

const file = async (name) => (await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const MIGRATION = "2026-11-15-6490-training-history-runs.sql";

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), OTHER_TEAM = id(2), SEASON = id(900);
const OWNER = id(501), STRANGER = id(502);
const RIDERS = [11, 12, 13, 14].map(id);
const OTHER_RIDERS = [21, 22].map(id);
const DATE = "2026-11-09", DAYS = [41, 42, 43, 44, 45];
const OTHER_DATE = "2026-11-10", OTHER_DAYS = [46, 47, 48, 49, 50];
const AT = (minute) => `2026-11-09T06:${String(minute).padStart(2, "0")}:00Z`;
const arr = (ids) => `'{${ids.join(",")}}'::uuid[]`;
const j = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;
const COLS = "id, team_id, season_id, squad, game_day, created_at, tick_date, executed_by, bonus_applied, report";

// The commit function and its tables, exactly as commitTrainingDateTick7982b.integration.test.js builds them.
async function applyCommitMigrations(db) {
  const sql = await file("2026-11-12-7982-commit-training-date-tick-samlet-tjek.sql");
  const commit = sql.indexOf("\nCOMMIT;\n") + "\nCOMMIT;\n".length;
  const heal = sql.indexOf("END $$;", commit) + "END $$;".length;
  const tail = sql.slice(heal).replace(/^\s*--.*$/gm, "").trim();
  const [, wait, index] = tail.match(/^(SET lock_timeout = '\d+s';)\s*(CREATE INDEX CONCURRENTLY IF NOT EXISTS [^;]+;)$/) ?? [];
  assert.ok(wait && index, "7982 migration tail found");
  await db.exec(sql.slice(0, commit));
  await db.exec(sql.slice(commit, heal));
  await db.exec(wait);
  await db.exec(index);
  await db.exec(await file("2026-11-13-7982-commit-training-date-tick-opslag-pr-rytter.sql"));
}

async function newDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec(`ALTER TABLE race_results ADD COLUMN rider_id uuid;
    ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN created_at timestamptz NOT NULL DEFAULT '2026-11-09T05:00:00Z';
    ALTER TABLE app_config ADD COLUMN description text`);
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))");
  await db.exec(await file("2026-11-09-7737-train-now-instant.sql"));
  await applyCommitMigrations(db);
  // Supabase's auth helpers and the teams table the ownership check reads.
  await db.exec(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS teams(id uuid PRIMARY KEY, user_id uuid);
    INSERT INTO teams VALUES ('${TEAM}','${OWNER}'),('${OTHER_TEAM}','${STRANGER}');`);
  await db.exec(await file(MIGRATION));
  await db.exec(await file(MIGRATION)); // idempotent
  await db.exec(`INSERT INTO riders(id,team_id) VALUES ${RIDERS.map((r) => `('${r}','${TEAM}')`).join(",")},${OTHER_RIDERS.map((r) => `('${r}','${OTHER_TEAM}')`).join(",")};
    INSERT INTO rider_derived_abilities VALUES ${[...RIDERS, ...OTHER_RIDERS].map((r) => `('${r}',50,'{}')`).join(",")};
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES ${[...RIDERS, ...OTHER_RIDERS].map((r) => `('${r}',50,32,'2026-11-08T20:00:00Z')`).join(",")};`);
  return db;
}

// Rider report lines the way the engine sends them, with status/focus for the peak signal. A rest
// day carries an explicit focus null, so the slim form must keep an explicit null as a null.
const line = (rider, day, n) => ({
  rider_id: rider, game_day: day, intensity: "normal", missing_evidence: [],
  status: n % 3 === 0 ? "rest" : "trained", focus: n % 3 === 0 ? null : ["vo2max", "sprint", "threshold"][n % 3],
  progress_before: { climbing: n }, progress_after: { climbing: n + 1 },
});

async function commit(db, { team, date, days, day, riders, openings, final }) {
  const report = { condition_per_date: true, riders: riders.map((r, i) => ({ ...line(r, day, day + i), condition_before_date: openings[r], condition_observed: openings[r] })) };
  const conditions = final ? riders.map((r) => ({ rider_id: r, form: 51, fatigue: 25, injured_until: null, injury_cause: null, updated_at: AT(5) })) : [];
  return (await db.query(`SELECT commit_training_date_tick('${team}','${SEASON}','senior',${day},'${date}','{${days}}','manager',${j(report)},'[]',${j(conditions)},'[]','[]','[]','[]',false,'${AT(10)}') AS r`)).rows[0].r;
}

const register = async (db, team, date, days, riders) =>
  (await db.query(`SELECT register_training_date_work('${team}','${SEASON}','${date}','{${days}}',${arr(riders)},NULL,'${AT(0)}') AS w`)).rows[0].w.opening_conditions;

// Two teams, two dates: one complete date, one date settled in two batches on its first day (the
// report is rebuilt on the second batch), plus a legacy calendar-day row and a pending reservation.
async function seed(db) {
  const openings = await register(db, TEAM, DATE, DAYS, RIDERS);
  for (const day of DAYS) await commit(db, { team: TEAM, date: DATE, days: DAYS, day, riders: RIDERS, openings, final: day === 45 });
  const otherOpenings = await register(db, OTHER_TEAM, OTHER_DATE, OTHER_DAYS, OTHER_RIDERS);
  await commit(db, { team: OTHER_TEAM, date: OTHER_DATE, days: OTHER_DAYS, day: 46, riders: [OTHER_RIDERS[1]], openings: otherOpenings });
  await commit(db, { team: OTHER_TEAM, date: OTHER_DATE, days: OTHER_DAYS, day: 46, riders: [OTHER_RIDERS[0]], openings: otherOpenings });
  await db.exec(`INSERT INTO training_day_runs(team_id,season_id,squad,game_day,tick_date,executed_by,bonus_applied,report)
    VALUES('${TEAM}','${SEASON}','senior',NULL,'2026-11-07','assistant',false,${j({ riders: [line(RIDERS[0], null, 1)], legacy: true })}),
          ('${TEAM}','${SEASON}','senior',51,'2026-11-11','manager',false,${j({ pending: true })})`);
}

let dbs = [];
const fresh = async () => { const db = await newDb(); dbs.push(db); await seed(db); return db; };
before(() => { dbs = []; });
after(async () => { for (const db of dbs) await db.close(); });

const stored = async (db, teams) => (await db.query(`SELECT ${COLS} FROM training_day_runs WHERE team_id = ANY(${arr(teams)}) ORDER BY team_id, tick_date, game_day NULLS FIRST, id`)).rows;
const derived = async (db, teams, { since = "2026-01-01", until = null, slim = false } = {}) =>
  (await db.query(`SELECT * FROM training_runs_from_ticks_6490(${arr(teams)}, '${since}', ${until ? `'${until}'` : "NULL"}, ${slim}) ORDER BY team_id, tick_date, game_day NULLS FIRST, id`)).rows;
const removeCopy = (db) => db.exec("UPDATE training_day_runs SET report = report - 'riders' WHERE game_day IS NOT NULL");

test("the seed is real: the copy holds every receipt of the date, and the second batch rebuilt it", async () => {
  const db = await fresh();
  const rows = await stored(db, [TEAM, OTHER_TEAM]);
  assert.equal(rows.length, 5 + 1 + 2, "five race days + one other-team run + legacy + pending");
  for (const row of rows.filter((r) => r.team_id === TEAM && r.game_day >= 41 && r.game_day <= 45)) {
    assert.deepEqual(row.report.riders.map((r) => r.rider_id), [...RIDERS].sort());
  }
  const other = rows.find((r) => r.team_id === OTHER_TEAM);
  assert.deepEqual(other.report.riders.map((r) => r.rider_id), [...OTHER_RIDERS].sort());
  assert.equal(other.report.complete, true, "the second batch rebuilt the first batch's partial report");
});

test("same rows, same columns, same report as the stored copy (both teams, every row kind)", async () => {
  const db = await fresh();
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), await stored(db, [TEAM, OTHER_TEAM]));
});

test("with the copy removed, the receipts give back exactly the stored reports; legacy and pending rows stay as stored", async () => {
  const db = await fresh();
  const before = await stored(db, [TEAM, OTHER_TEAM]);
  await removeCopy(db);
  const afterRemoval = await stored(db, [TEAM, OTHER_TEAM]);
  assert.ok(afterRemoval.filter((r) => r.game_day != null).every((r) => !("riders" in r.report)), "copy gone");
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), before);
});

test("the date window and the team filter match a SELECT with the same bounds", async () => {
  const db = await fresh();
  const all = await stored(db, [TEAM, OTHER_TEAM]);
  const inWindow = all.filter((r) => r.tick_date >= new Date("2026-11-09T00:00:00Z") && r.tick_date < new Date("2026-11-11T00:00:00Z"));
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM], { since: "2026-11-09", until: "2026-11-11" }), inWindow);
  assert.deepEqual(await derived(db, [OTHER_TEAM]), all.filter((r) => r.team_id === OTHER_TEAM));
});

test("slim keeps only rider_id, status and focus, with missing keys missing and explicit nulls kept", async () => {
  const db = await fresh();
  const full = await stored(db, [TEAM, OTHER_TEAM]);
  await removeCopy(db);
  const slim = await derived(db, [TEAM, OTHER_TEAM], { slim: true });
  assert.equal(slim.length, full.length);
  slim.forEach((row, i) => {
    const pick = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => ["rider_id", "status", "focus"].includes(k)));
    assert.deepEqual(row.report, { riders: (full[i].report.riders ?? []).map(pick) });
  });
  assert.ok(slim.some((row) => row.report.riders.some((r) => r.status === "rest" && r.focus === null)), "an explicit null focus survives");
});

// A thin PostgREST stand-in over PGlite: the two query shapes loadTeamTrainingRuns sends.
function fakeSupabase(db, { flag = null } = {}) {
  const calls = [];
  const thenable = (run) => ({ then: (ok, bad) => run().then(ok, bad) });
  return {
    calls,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: flag == null ? null : { value: flag }, error: null }) }) }) };
      }
      assert.equal(table, "training_day_runs");
      const q = { cols: null, teams: null, gte: null, lt: null };
      const chain = {
        select(cols) { q.cols = cols; return chain; },
        in(col, v) { assert.equal(col, "team_id"); q.teams = v; return chain; },
        gte(col, v) { assert.equal(col, "tick_date"); q.gte = v; return chain; },
        lt(col, v) { assert.equal(col, "tick_date"); q.lt = v; return thenable(async () => {
          calls.push("table");
          const { rows } = await db.query(`SELECT ${q.cols} FROM training_day_runs WHERE team_id = ANY(${arr(q.teams)}) AND tick_date >= '${q.gte}' AND tick_date < '${q.lt}'`);
          return { data: rows.map((r) => ({ ...r, tick_date: r.tick_date.toISOString().slice(0, 10) })), error: null };
        }); },
      };
      return chain;
    },
    rpc(name, args) {
      assert.equal(name, "training_runs_from_ticks_6490");
      const chain = {
        select(cols) { chain.cols = cols; return chain; },
        order() { return chain; },
        range(from, to) { return thenable(async () => {
          calls.push("rpc");
          const { rows } = await db.query(`SELECT ${chain.cols} FROM training_runs_from_ticks_6490(${arr(args.p_team_ids)}, '${args.p_since}', '${args.p_until}', ${args.p_slim}) ORDER BY team_id, tick_date, game_day, id OFFSET ${from} LIMIT ${to - from + 1}`);
          return { data: rows.map((r) => ({ ...r, tick_date: r.tick_date.toISOString().slice(0, 10) })), error: null };
        }); },
      };
      return chain;
    },
  };
}

const normalize = (runs) => runs
  .map((r) => ({ team_id: r.team_id, ord: r.ord, riders: [...r.riderMap.entries()].sort(([a], [b]) => a.localeCompare(b)) }))
  .sort((a, b) => (a.team_id + a.ord + JSON.stringify(a.riders)).localeCompare(b.team_id + b.ord + JSON.stringify(b.riders)));

test("trin c: the peak signal gets the same riderMap with and without the switch, also once the copy is gone", async () => {
  const db = await fresh();
  const args = { teamIds: [TEAM, OTHER_TEAM], startDate: "2026-11-01", endDate: "2026-11-12" };
  const off = await loadTeamTrainingRuns({ supabase: fakeSupabase(db), ...args });
  const onClient = fakeSupabase(db, { flag: "on" });
  const on = await loadTeamTrainingRuns({ supabase: onClient, ...args });
  assert.deepEqual(onClient.calls, ["rpc"], "switch on reads the receipts");
  assert.ok(off.length >= 6 && off.some((r) => r.riderMap.size > 0));
  assert.deepEqual(normalize(on), normalize(off));
  await removeCopy(db);
  assert.deepEqual(normalize(await loadTeamTrainingRuns({ supabase: fakeSupabase(db, { flag: "on" }), ...args })), normalize(off));
});

test("trin c: only the exact string \"on\" switches; beta, true, off and a missing row read the copy", async () => {
  const db = await fresh();
  for (const flag of [null, "off", "beta", true, "ON"]) {
    const client = fakeSupabase(db, { flag });
    await loadTeamTrainingRuns({ supabase: client, teamIds: [TEAM], startDate: "2026-11-01", endDate: "2026-11-12" });
    assert.deepEqual(client.calls, ["table"], `flag ${JSON.stringify(flag)}`);
  }
});

const asRole = async (db, role, sub, fn) => {
  await db.exec("BEGIN");
  try {
    await db.exec(`SELECT set_config('request.jwt.claims', ${j({ role, ...(sub ? { sub } : {}) }).replace("::jsonb", "::text")}, true)`);
    await db.exec(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally { await db.exec("ROLLBACK"); }
};
const history = (db, team) => db.query(`SELECT ${COLS} FROM training_history_runs('${team}', '2026-01-01') ORDER BY tick_date, game_day NULLS FIRST, id`).then((r) => r.rows);

test("b1 ownership: the owner sees his team, another manager sees nothing, anon cannot call, service_role sees the team", async () => {
  const db = await fresh();
  const own = await stored(db, [TEAM]);
  const byDate = (rows) => [...rows].sort((a, b) => (a.tick_date - b.tick_date) || ((a.game_day ?? -1) - (b.game_day ?? -1)));
  assert.deepEqual(await asRole(db, "authenticated", OWNER, () => history(db, TEAM)), byDate(own));
  assert.deepEqual(await asRole(db, "authenticated", STRANGER, () => history(db, TEAM)), []);
  assert.deepEqual(await asRole(db, "authenticated", null, () => history(db, TEAM)), []);
  await assert.rejects(asRole(db, "anon", null, () => history(db, TEAM)), /permission denied/);
  assert.deepEqual(await asRole(db, "service_role", null, () => history(db, TEAM)), byDate(own));
  // The multi-team function is never callable by a client.
  await assert.rejects(asRole(db, "authenticated", OWNER, () => derived(db, [TEAM])), /permission denied/);
});

// The ops script the owner runs in prod before the switch: here on the seeded data it must report
// zero differences, also after the copy is gone (then the copy-presence count shows it).
test("scripts/ops/6490-history-parity.sql is SELECT-only and reports zero differences on real commits", async () => {
  const script = (await readFile(new URL("../../scripts/ops/6490-history-parity.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const live = script.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(live, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
  assert.match(live, /BEGIN READ ONLY;/);
  // Sections 1-3 as psql would send them (meta-commands out, :since bound); section 4 is EXPLAIN only.
  const body = script.slice(script.indexOf("BEGIN READ ONLY;") + "BEGIN READ ONLY;".length, script.indexOf("-- 4)"))
    .split("\n").filter((l) => !/^\s*\\/.test(l)).join("\n").replaceAll(":since", "'2026-01-01'::date");
  const db = await fresh();
  const run = async () => {
    const results = await db.exec(`BEGIN READ ONLY; ${body} ROLLBACK;`);
    const sets = results.filter((r) => r.fields.length > 0);
    return { totals: sets[0].rows[0], slim: sets[1].rows[0], rows: sets[2].rows };
  };
  const first = await run();
  assert.equal(first.totals.rows_stored, 8);
  assert.deepEqual([first.totals.rows_new, first.totals.rows_missing_on_one_side, first.totals.riders_differ, first.totals.other_fields_differ], [8, 0, 0, 0]);
  assert.equal(first.totals.race_day_rows_with_copy, 6);
  assert.deepEqual(first.slim, { slim_rows: 8, slim_differ: 0 });
  assert.deepEqual(first.rows, []);
  // A broken copy is caught: the script is not blind.
  await db.exec(`UPDATE training_day_runs SET report = jsonb_set(report, '{riders,0,status}', '"tampered"') WHERE game_day = 42`);
  const broken = await run();
  assert.equal(broken.totals.riders_differ, 1);
  assert.equal(broken.slim.slim_differ, 1);
  assert.equal(broken.rows.length, 1);
});

test("rights and shape: definer only for the one-team history, fixed search_path, flag seeded off", async () => {
  const db = await fresh();
  const procs = (await db.query(`SELECT proname, prosecdef, proconfig, provolatile FROM pg_proc WHERE proname IN ('training_history_runs','training_runs_from_ticks_6490') ORDER BY proname`)).rows;
  assert.deepEqual(procs.map((p) => [p.proname, p.prosecdef, p.proconfig, p.provolatile]), [
    ["training_history_runs", true, ["search_path=public, pg_temp"], "s"],
    ["training_runs_from_ticks_6490", false, ["search_path=public, pg_temp"], "s"],
  ]);
  assert.deepEqual((await db.query("SELECT value FROM app_config WHERE key='training_history_from_ticks_6490'")).rows, [{ value: "off" }]);
  // Nothing is deleted, updated or dropped: outside comments the file only creates and seeds.
  const live = (await file(MIGRATION)).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(live, /\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
});
