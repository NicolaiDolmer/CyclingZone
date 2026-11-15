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
import { TRAINING_HISTORY_FROM_TICKS_6490_FLAG_KEY, TRAINING_PEAK_FROM_TICKS_6490_FLAG_KEY } from "./trainingHistoryFromTicks6490.js";

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
// Same rider set, different content: every rider line in the copy gets a wrong status, focus and
// progress. Only a read from the receipts can give back the original values.
const tamperCopy = (db) => db.exec(`UPDATE training_day_runs SET report = jsonb_set(report, '{riders}', (
    SELECT jsonb_agg(e || '{"status":"tampered","focus":"tampered","progress_after":{"climbing":-1}}'::jsonb ORDER BY o)
    FROM jsonb_array_elements(report->'riders') WITH ORDINALITY x(e, o)))
  WHERE game_day IS NOT NULL AND jsonb_typeof(report->'riders') = 'array'`);

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

test("the riders come from the receipts: with the copy's content tampered (same rider set), the original reports come back", async () => {
  const db = await fresh();
  const before = await stored(db, [TEAM, OTHER_TEAM]);
  await tamperCopy(db);
  const tampered = await stored(db, [TEAM, OTHER_TEAM]);
  assert.ok(tampered.some((r) => r.report.riders?.some((x) => x.status === "tampered")), "copy tampered");
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), before);
});

// Locked rider set (Fable-dom 15/11, fund 2): without a stored copy there is nothing to lock
// against, so the stored report comes back unchanged. Reading without the copy is trin d's open
// design point, not this step's.
test("with the copy removed, the stored report comes back unchanged (no riders are invented); legacy and pending rows stay as stored", async () => {
  const db = await fresh();
  await removeCopy(db);
  const afterRemoval = await stored(db, [TEAM, OTHER_TEAM]);
  assert.ok(afterRemoval.filter((r) => r.game_day != null).every((r) => !("riders" in r.report)), "copy gone");
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), afterRemoval);
  const slim = await derived(db, [TEAM, OTHER_TEAM], { slim: true });
  assert.ok(slim.every((r) => r.report.riders.length === 0 || r.game_day == null), "slim invents no riders either");
});

// Team change mid-date (Fable-dom 15/11, fund 2): a rider on two teams' frozen lists on the same
// date, with his receipt written under the other team. The derived list for the first team then
// has one rider MORE than the stored copy; the stored report must come back unchanged (full and
// slim), and the peak signal must not change either.
test("team change mid-date: one rider more in the derived list gives the stored report, full and slim", async () => {
  const db = await fresh();
  const mover = OTHER_RIDERS[0];
  await db.exec(`UPDATE training_date_work SET expected_rider_ids = expected_rider_ids || '${mover}'::uuid
      WHERE team_id='${TEAM}' AND season_id='${SEASON}' AND tick_date='${DATE}';
    INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report,created_at)
      VALUES('${mover}','${SEASON}',42,'${DATE}','${OTHER_TEAM}',${j(line(mover, 42, 7))},'${AT(20)}')`);
  // The derivation rule really does pick up one more rider for the first team's race day 42.
  const ruleCount = (await db.query(`SELECT count(*)::int AS n FROM training_rider_ticks t JOIN training_date_work w
      ON w.team_id='${TEAM}' AND w.season_id='${SEASON}' AND w.tick_date='${DATE}'
    WHERE t.season_id='${SEASON}' AND t.game_day=42 AND t.rider_id = ANY(w.expected_rider_ids)`)).rows[0].n;
  assert.equal(ruleCount, RIDERS.length + 1, "derived list has one more rider than the copy");
  const before = await stored(db, [TEAM, OTHER_TEAM]);
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), before, "full: stored report unchanged");
  const day42 = (await derived(db, [TEAM], { slim: true })).find((r) => r.game_day === 42);
  assert.deepEqual(day42.report.riders.map((r) => r.rider_id), [...RIDERS].sort(), "slim: the stored rider set");
  // The other days of the same team still read from the receipts (the guard is per row).
  await tamperCopy(db);
  const fromTicks = (await derived(db, [TEAM])).filter((r) => r.game_day >= 41 && r.game_day <= 45);
  assert.ok(fromTicks.find((r) => r.game_day === 42).report.riders.every((x) => x.status === "tampered"), "day 42: stored (tampered) copy kept");
  assert.ok(fromTicks.filter((r) => r.game_day !== 42).every((r) => r.report.riders.every((x) => x.status !== "tampered")), "other days: receipts");
});

// training_rider_ticks.rider_id is ON DELETE CASCADE and deleteRiderWithCleanup allows a hard
// delete. The new path must never show fewer riders than the stored report: with one receipt left
// and with every receipt gone, the rows are exactly the stored ones (Codex P2 on PR #8174).
test("rider deletion: a hard-deleted rider never disappears from the history (one receipt left, and none left)", async () => {
  const db = await fresh();
  const deleteRider = async (rider) => {
    await db.exec(`DELETE FROM rider_condition WHERE rider_id='${rider}'; DELETE FROM rider_derived_abilities WHERE rider_id='${rider}'`);
    await db.exec(`DELETE FROM riders WHERE id='${rider}'`);
  };
  const before = await stored(db, [TEAM, OTHER_TEAM]);
  await deleteRider(OTHER_RIDERS[0]);
  const left = (await db.query(`SELECT count(*)::int AS n FROM training_rider_ticks WHERE rider_id='${OTHER_RIDERS[1]}'`)).rows[0].n;
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM training_rider_ticks WHERE rider_id='${OTHER_RIDERS[0]}'`)).rows[0].n, 0, "cascade removed the receipts");
  assert.ok(left >= 1, "the other rider's receipt survives");
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), before, "one receipt left: stored report kept");
  const slim = await derived(db, [OTHER_TEAM], { slim: true });
  assert.deepEqual(slim[0].report.riders.map((r) => r.rider_id), [...OTHER_RIDERS].sort(), "slim keeps the deleted rider too");
  await deleteRider(OTHER_RIDERS[1]);
  assert.deepEqual(await derived(db, [TEAM, OTHER_TEAM]), before, "every receipt gone: stored report kept");
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
  await tamperCopy(db); // status/focus in the copy are wrong now: the slim form must read the receipts
  const slim = await derived(db, [TEAM, OTHER_TEAM], { slim: true });
  assert.equal(slim.length, full.length);
  slim.forEach((row, i) => {
    const pick = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => ["rider_id", "status", "focus"].includes(k)));
    assert.deepEqual(row.report, { riders: (full[i].report.riders ?? []).map(pick) });
  });
  assert.ok(slim.some((row) => row.report.riders.some((r) => r.status === "rest" && r.focus === null)), "an explicit null focus survives");
});

// A thin PostgREST stand-in over PGlite: the two query shapes loadTeamTrainingRuns sends.
// `flags` maps app_config keys to values (a missing key = no row).
function fakeSupabase(db, flags = {}) {
  const calls = [];
  const thenable = (run) => ({ then: (ok, bad) => run().then(ok, bad) });
  return {
    calls,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: (col, key) => {
          assert.equal(col, "key");
          calls.push(`flag:${key}`);
          return { maybeSingle: async () => ({ data: flags[key] == null ? null : { value: flags[key] }, error: null }) };
        } }) };
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

const PEAK = TRAINING_PEAK_FROM_TICKS_6490_FLAG_KEY, HISTORY = TRAINING_HISTORY_FROM_TICKS_6490_FLAG_KEY;

test("trin c: the peak signal gets the same riderMap with its own switch on and off, also with the copy's content tampered", async () => {
  const db = await fresh();
  const args = { teamIds: [TEAM, OTHER_TEAM], startDate: "2026-11-01", endDate: "2026-11-12" };
  const off = await loadTeamTrainingRuns({ supabase: fakeSupabase(db), ...args });
  const onClient = fakeSupabase(db, { [PEAK]: "on" });
  const on = await loadTeamTrainingRuns({ supabase: onClient, ...args });
  assert.deepEqual(onClient.calls, [`flag:${PEAK}`, "rpc"], "the peak switch on reads the receipts");
  assert.ok(off.length >= 6 && off.some((r) => r.riderMap.size > 0));
  assert.deepEqual(normalize(on), normalize(off));
  await tamperCopy(db);
  assert.deepEqual(normalize(await loadTeamTrainingRuns({ supabase: fakeSupabase(db, { [PEAK]: "on" }), ...args })), normalize(off));
});

// Fable-dom 15/11, fund 1: the training page's switch never changes the motor input. With the peak
// switch off, loadTeamTrainingRuns sends exactly main's one table query (no rpc, no order, no
// range) and gives main's riderMap, whatever the history switch says.
test("trin c: with the peak switch off the riderMap is main's, whatever the history switch says", async () => {
  const db = await fresh();
  const args = { teamIds: [TEAM, OTHER_TEAM], startDate: "2026-11-01", endDate: "2026-11-12" };
  const main = normalize(await loadTeamTrainingRuns({ supabase: fakeSupabase(db), ...args }));
  for (const peak of [null, "off", "beta", true, "ON"]) {
    for (const history of [null, "off", "on"]) {
      const client = fakeSupabase(db, { [PEAK]: peak, [HISTORY]: history });
      const runs = await loadTeamTrainingRuns({ supabase: client, ...args });
      assert.deepEqual(client.calls, [`flag:${PEAK}`, "table"], `peak ${JSON.stringify(peak)}, history ${JSON.stringify(history)}`);
      assert.deepEqual(normalize(runs), main);
    }
  }
});

test("trin c: team change mid-date gives the same riderMap with the peak switch on and off", async () => {
  const db = await fresh();
  const mover = OTHER_RIDERS[0];
  await db.exec(`UPDATE training_date_work SET expected_rider_ids = expected_rider_ids || '${mover}'::uuid
      WHERE team_id='${TEAM}' AND season_id='${SEASON}' AND tick_date='${DATE}';
    INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report,created_at)
      VALUES('${mover}','${SEASON}',42,'${DATE}','${OTHER_TEAM}',${j(line(mover, 42, 7))},'${AT(20)}')`);
  const args = { teamIds: [TEAM, OTHER_TEAM], startDate: "2026-11-01", endDate: "2026-11-12" };
  const off = await loadTeamTrainingRuns({ supabase: fakeSupabase(db), ...args });
  const on = await loadTeamTrainingRuns({ supabase: fakeSupabase(db, { [PEAK]: "on" }), ...args });
  assert.deepEqual(normalize(on), normalize(off));
  assert.ok(off.filter((r) => r.team_id === TEAM).every((r) => !r.riderMap.has(mover)), "the mover never enters the first team's map");
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
  assert.deepEqual([first.totals.rider_set_more, first.totals.rider_set_fewer, first.totals.rider_set_differ, first.totals.rider_set_no_copy], [0, 0, 0, 0]);
  assert.deepEqual(first.slim, { slim_rows: 8, slim_differ: 0 });
  assert.deepEqual(first.rows, []);
  // A broken copy is caught: the script is not blind.
  await db.exec(`UPDATE training_day_runs SET report = jsonb_set(report, '{riders,0,status}', '"tampered"') WHERE game_day = 42`);
  const broken = await run();
  assert.equal(broken.totals.riders_differ, 1);
  assert.equal(broken.slim.slim_differ, 1);
  assert.equal(broken.rows.length, 1);
  // A team change mid-date (one rider more by the rule) is counted, while the function keeps the
  // stored report (riders_differ stays at the one tampered row).
  const mover = OTHER_RIDERS[0];
  await db.exec(`UPDATE training_date_work SET expected_rider_ids = expected_rider_ids || '${mover}'::uuid
      WHERE team_id='${TEAM}' AND season_id='${SEASON}' AND tick_date='${DATE}';
    INSERT INTO training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report,created_at)
      VALUES('${mover}','${SEASON}',43,'${DATE}','${OTHER_TEAM}',${j(line(mover, 43, 7))},'${AT(20)}')`);
  const more = await run();
  assert.deepEqual([more.totals.rider_set_more, more.totals.rider_set_fewer, more.totals.rider_set_differ], [1, 0, 1]);
  assert.equal(more.totals.riders_differ, 1, "the team-change row reads the stored report");
  // A hard-deleted rider (fewer by the rule) is counted too: he is on all five race days.
  await db.exec(`DELETE FROM rider_condition WHERE rider_id='${RIDERS[3]}'; DELETE FROM rider_derived_abilities WHERE rider_id='${RIDERS[3]}'; DELETE FROM riders WHERE id='${RIDERS[3]}'`);
  const fewer = await run();
  assert.deepEqual([fewer.totals.rider_set_more, fewer.totals.rider_set_fewer, fewer.totals.rider_set_differ], [1, 5, 5]);
  // Every race day of the team now reads the stored report, the tampered day 42 included.
  assert.equal(fewer.totals.riders_differ, 0, "the deletion rows read the stored report");
});

test("rights and shape: definer only for the one-team history (fixed search_path), inlinable invoker reader, both flags seeded off", async () => {
  const db = await fresh();
  const procs = (await db.query(`SELECT proname, prosecdef, proconfig, provolatile, l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE proname IN ('training_history_runs','training_runs_from_ticks_6490') ORDER BY proname`)).rows;
  assert.deepEqual(procs.map((p) => [p.proname, p.prosecdef, p.proconfig, p.provolatile, p.lanname]), [
    ["training_history_runs", true, ["search_path=public, pg_temp"], "s", "plpgsql"],
    // Fund 3: no SET, so the planner inlines it (a SET function is never inlined).
    ["training_runs_from_ticks_6490", false, null, "s", "sql"],
  ]);
  // The reader's body names every table and function by schema (it has no search_path of its own).
  const body = (await db.query("SELECT prosrc FROM pg_proc WHERE proname='training_runs_from_ticks_6490'")).rows[0].prosrc.replace(/--.*$/gm, "");
  for (const table of ["training_day_runs", "training_date_work", "training_rider_ticks"]) {
    assert.doesNotMatch(body, new RegExp(`(?<!public\\.)\\b${table}\\b`), `${table} is schema-qualified`);
  }
  for (const fn of body.matchAll(/\b([a-z_]+)\(/g)) {
    if (["CASE", "COALESCE", "EXISTS"].includes(fn[1].toUpperCase())) continue;
    assert.match(body.slice(Math.max(0, fn.index - 11), fn.index), /pg_catalog\.$/, `${fn[1]}() is pg_catalog-qualified`);
  }
  // Inlined: the plan of a call has no Function Scan, the tables are scanned directly.
  const plan = (await db.query(`EXPLAIN SELECT * FROM training_runs_from_ticks_6490(${arr([TEAM])}, '2026-01-01', NULL, false)`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
  assert.doesNotMatch(plan, /Function Scan on training_runs_from_ticks_6490/);
  assert.match(plan, /training_day_runs/);
  assert.deepEqual((await db.query("SELECT key, value FROM app_config WHERE key IN ('training_history_from_ticks_6490','training_peak_from_ticks_6490') ORDER BY key")).rows,
    [{ key: "training_history_from_ticks_6490", value: "off" }, { key: "training_peak_from_ticks_6490", value: "off" }]);
  // Nothing is deleted, updated or dropped: outside comments the file only creates and seeds.
  const live = (await file(MIGRATION)).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(live, /\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
});
