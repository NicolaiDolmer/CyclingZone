// scripts/ops/prodHealthSql.test.mjs
// SQL-helbredstjek (#6994): værn, tærskler, snapshot-sammenligning, kommentar.
// Ingen database: psql og runSql er fakes.
// Run: node --test scripts/ops/prodHealthSql.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyPsqlFailure,
  COMMENT_MARKER,
  connectsToProject,
  evaluateConnections,
  evaluateForecast,
  evaluateGuard,
  evaluateSessions,
  evaluateStatements,
  main,
  makePsqlRunner,
  pushSizeHistory,
  pickHourlyTriple,
  pushSnapshot,
  renderComment,
  runChecks,
  SQL,
  toStatementSnapshot,
} from "./prodHealthSql.mjs";

const GOOD_GUARD = { role: "cz_monitor", read_only: "on", read_all_stats: true, server_version_num: 170006 };
const at = (h, m = 45) => new Date(Date.UTC(2026, 9, 21, h, m)).toISOString();

function stmtRaw(observedAt, rows, info = { stats_reset: "2026-10-18T06:21:18Z", dealloc: 0 }) {
  return {
    observed_at: observedAt,
    info,
    rows: rows.map(([queryid, calls, total, since = "2026-10-18T06:21:21Z"]) => ({
      dbid: "5", userid: "10", role: "authenticator", queryid, toplevel: true,
      calls, total_exec_time: total, statement_stats_since: since,
    })),
  };
}

/** Fake runSql: svarer efter hvilken SQL der spørges om. */
function fakeRunSql(answers) {
  const calls = [];
  const fn = async (sql) => {
    const key = Object.keys(SQL).find((k) => SQL[k] === sql);
    calls.push(key);
    const a = answers[key];
    if (a instanceof Error) throw a;
    if (typeof a === "function") return a();
    return a;
  };
  fn.calls = calls;
  return fn;
}

const failing = (reason) => Object.assign(new Error("x"), { reason });

// --- værn -------------------------------------------------------------------

test("værn: kun cz_monitor i read-only slipper igennem", () => {
  assert.deepEqual(evaluateGuard(GOOD_GUARD), { ok: true, readAllStats: true, serverVersionNum: 170006 });
  assert.equal(evaluateGuard({ ...GOOD_GUARD, role: "postgres" }).reason, "wrong_role");
  assert.equal(evaluateGuard({ ...GOOD_GUARD, read_only: "off" }).reason, "not_read_only");
  assert.equal(evaluateGuard(null).reason, "guard_no_answer");
});

test("forkert rolle: ingen tjek køres, alle unable, exit 2", async () => {
  const runSql = fakeRunSql({ guard: { ...GOOD_GUARD, role: "postgres", read_only: "off" } });
  const { result, exitCode } = await runChecks({ runSql, state: null, mode: "report", nowIso: at(4) });
  assert.equal(exitCode, 2);
  assert.deepEqual(runSql.calls, ["guard"]);
  assert.ok(result.checks.every((c) => c.outcome === "unable_to_assess" && c.missing === "guard:wrong_role"));
});

test("forbindelsesfejl i værnet: unable med grov årsag, exit 3 (rød workflow)", async () => {
  const runSql = fakeRunSql({ guard: failing("login_rejected") });
  const { result, exitCode } = await runChecks({ runSql, state: null, mode: "report", nowIso: at(4) });
  assert.equal(exitCode, 3);
  assert.equal(result.guard.reason, "login_rejected");
  assert.ok(result.checks.every((c) => c.outcome === "unable_to_assess"));
});

// --- forbindelsestryk ---------------------------------------------------------

test("forbindelsestryk: 80 % er finding, under er clear", () => {
  assert.equal(evaluateConnections({ client_connections: 96, active_connections: 3, max_connections: 120 }).outcome, "finding");
  const clear = evaluateConnections({ client_connections: 56, active_connections: 1, max_connections: 120 });
  assert.equal(clear.outcome, "clear");
  assert.equal(clear.value.percent, 46.7);
  assert.equal(evaluateConnections({}).outcome, "unable_to_assess");
});

// --- sessioner ----------------------------------------------------------------

test("sessioner: blokeret, lang query og idle in transaction tælles hver for sig", () => {
  const r = evaluateSessions([
    { pid: 11, role: "authenticator", state: "active", query_age_s: 5, transaction_age_s: 5, wait_event_type: "Lock", wait_event: "relation", blocking_pids: [12] },
    { pid: 12, role: "postgres", state: "idle in transaction", query_age_s: 90, transaction_age_s: 95, wait_event_type: "Client", wait_event: "ClientRead", blocking_pids: [] },
    { pid: 13, role: "authenticator", state: "active", query_age_s: 45, transaction_age_s: 45, wait_event_type: null, wait_event: null, blocking_pids: [] },
  ]);
  assert.equal(r.outcome, "finding");
  assert.equal(r.value.blocked, 1);
  assert.equal(r.value.idle_in_transaction, 1);
  assert.equal(r.value.long_query, 1);
  assert.deepEqual(r.value.blocker_pids, [12]);
  assert.equal(r.value.truncated, false);
});

test("sessioner: tom liste er clear, 20 rækker markeres afkortet", () => {
  assert.equal(evaluateSessions([]).outcome, "clear");
  const many = Array.from({ length: 20 }, (_, i) => ({ pid: i, state: "active", query_age_s: 31, blocking_pids: [] }));
  assert.equal(evaluateSessions(many).value.truncated, true);
});

test("sessioner: output har ingen query-tekst, selv hvis den sneg sig ind", () => {
  const r = evaluateSessions([{ pid: 1, state: "active", query_age_s: 40, query: "select * from secret", blocking_pids: [] }]);
  assert.equal(JSON.stringify(r).includes("secret"), false);
});

// --- pg_stat_statements -------------------------------------------------------

function threeSnapshots(rowsPerSnap, opts = {}) {
  const hours = opts.hours ?? [2, 3, 4];
  return hours.map((h, i) => toStatementSnapshot(stmtRaw(at(h, opts.minutes?.[i] ?? 45), rowsPerSnap[i], opts.info?.[i])));
}

test("statements: middeltid >= 100 ms og >= 2x forrige time med >= 20 kald er finding", () => {
  // forrige time: 100 kald, 4000 ms -> 40 ms. nuværende: 50 kald, 7500 ms -> 150 ms.
  const snaps = threeSnapshots([
    [["111", 1000, 10000], ["222", 1000, 1000]],
    [["111", 1100, 14000], ["222", 1100, 1100]],
    [["111", 1150, 21500], ["222", 1200, 1200]],
  ]);
  const r = evaluateStatements(snaps);
  assert.equal(r.outcome, "finding");
  assert.equal(r.value.compared_statements, 2);
  assert.deepEqual(r.value.findings, [{
    queryid: "111", role: "authenticator", calls_preceding: 100, calls_current: 50,
    mean_ms_preceding: 40, mean_ms_current: 150,
  }]);
});

test("statements: under 20 kald i et interval sammenlignes ikke", () => {
  const snaps = threeSnapshots([[["111", 1000, 0]], [["111", 1030, 300]], [["111", 1040, 5000]]]);
  const r = evaluateStatements(snaps);
  assert.equal(r.outcome, "clear");
  assert.equal(r.value.compared_statements, 0);
});

test("statements: langsom men ikke 2x forrige er clear", () => {
  const snaps = threeSnapshots([[["111", 0, 0]], [["111", 100, 15000]], [["111", 200, 30000]]]);
  assert.equal(evaluateStatements(snaps).outcome, "clear");
});

test("statements: under tre snapshots er unable", () => {
  const r = evaluateStatements(threeSnapshots([[["1", 1, 1]], [["1", 1, 1]], [["1", 1, 1]]]).slice(1));
  assert.equal(r.outcome, "unable_to_assess");
  assert.equal(r.missing, "three_hourly_snapshots");
});

test("statements: forkert mellemrum mellem snapshots er unable", () => {
  const snaps = threeSnapshots([[["1", 1, 1]], [["1", 1, 1]], [["1", 1, 1]]], { hours: [2, 2, 4], minutes: [0, 20, 45] });
  assert.equal(evaluateStatements(snaps).missing, "snapshot_spacing");
});

test("statements: reset eller dealloc-ændring kasserer sammenligningen", () => {
  const base = [[["1", 1, 1]], [["1", 1, 1]], [["1", 1, 1]]];
  const reset = threeSnapshots(base, { info: [undefined, undefined, { stats_reset: "2026-10-21T03:00:00Z", dealloc: 0 }] });
  assert.equal(evaluateStatements(reset).missing, "stats_reset_or_dealloc_changed");
  const dealloc = threeSnapshots(base, { info: [undefined, { stats_reset: "2026-10-18T06:21:18Z", dealloc: 3 }, undefined] });
  assert.equal(evaluateStatements(dealloc).missing, "stats_reset_or_dealloc_changed");
});

test("statements: Postgres-opgradering mellem snapshots kasserer sammenligningen", () => {
  const base = [[["1", 0, 0]], [["1", 100, 100]], [["1", 200, 50000]]];
  const snaps = base.map((rows, i) => toStatementSnapshot(stmtRaw(at(2 + i), rows), i === 2 ? 170007 : 170006));
  assert.equal(evaluateStatements(snaps).missing, "server_version_changed");
});

test("statements: ændret stats_since eller faldende tæller springes over", () => {
  const snaps = threeSnapshots([
    [["1", 0, 0], ["2", 1000, 1000]],
    [["1", 100, 1000, "2026-10-21T03:10:00Z"], ["2", 900, 1000]],
    [["1", 200, 50000, "2026-10-21T03:10:00Z"], ["2", 2000, 500000]],
  ]);
  const r = evaluateStatements(snaps);
  assert.equal(r.outcome, "clear");
  assert.equal(r.value.compared_statements, 0);
});

test("statements: uden stats_since kan reset ikke udelukkes -> unable", () => {
  const snaps = threeSnapshots([[["1", 0, 0, null]], [["1", 100, 100, null]], [["1", 200, 50000, null]]]);
  assert.equal(evaluateStatements(snaps).missing, "statement_stats_since");
});

test("statements: manuel kørsel imellem fortrænger ikke den gyldige timesrække", () => {
  const rows = [[["111", 1000, 10000]], [["111", 1050, 12000]], [["111", 1100, 14000]], [["111", 1150, 21500]]];
  const times = [at(2, 45), at(3, 15), at(3, 45), at(4, 45)];
  let list = [];
  rows.forEach((r, i) => { list = pushSnapshot(list, toStatementSnapshot(stmtRaw(times[i], r)), times[i]); });
  assert.deepEqual(pickHourlyTriple(list).map((s) => s.observed_at), [times[0], times[2], times[3]]);
  const res = evaluateStatements(list);
  assert.equal(res.outcome, "finding");
  assert.equal(res.value.window_start, times[0]);
});

test("projekt-binding: kun cz_monitor i prod-projektet accepteres", () => {
  assert.equal(connectsToProject("postgresql://cz_monitor.ghwvkxzhsbbltzfnuhhz:pw@aws-0-eu.pooler.supabase.com:5432/postgres"), true);
  assert.equal(connectsToProject("postgresql://cz_monitor:pw@db.ghwvkxzhsbbltzfnuhhz.supabase.co:5432/postgres"), true);
  assert.equal(connectsToProject("postgresql://cz_monitor.andetprojekt:pw@aws-0-eu.pooler.supabase.com:5432/postgres"), false);
  assert.equal(connectsToProject("postgresql://postgres.ghwvkxzhsbbltzfnuhhz:pw@aws-0-eu.pooler.supabase.com:5432/postgres"), false);
  assert.equal(connectsToProject("postgresql://cz_monitor:pw@localhost:5432/postgres"), false);
  assert.equal(connectsToProject("ikke en url"), false);
});

test("main: forkert projekt -> exit 2 uden at køre psql", async () => {
  let called = false;
  const logs = [];
  const code = await main({
    argv: ["--mode", "report"],
    env: { CZ_MONITOR_DATABASE_URL: "postgresql://cz_monitor.andet:hemmelig@pooler:5432/postgres" },
    execFn: async () => { called = true; },
    log: (l) => logs.push(l),
  });
  assert.equal(code, 2);
  assert.equal(called, false);
  assert.equal(logs.join(" ").includes("hemmelig"), false);
});

test("snapshot: rækker uden queryid droppes, ingen query-tekst gemmes", () => {
  const raw = stmtRaw(at(2), [["1", 5, 5]]);
  raw.rows.push({ dbid: "5", userid: "10", queryid: null, toplevel: true, calls: 1, total_exec_time: 1, query: "select secret" });
  const snap = toStatementSnapshot(raw);
  assert.deepEqual(Object.keys(snap.rows), ["5:10:1:true"]);
  assert.equal(JSON.stringify(snap).includes("secret"), false);
});

test("pushSnapshot beholder snapshots inden for 4 timer", () => {
  let list = [];
  for (const h of [0, 1, 2, 3, 4]) list = pushSnapshot(list, { observed_at: at(h), rows: {} }, at(h));
  assert.deepEqual(list.map((s) => s.observed_at), [at(0), at(1), at(2), at(3), at(4)]);
  const stale = pushSnapshot([{ observed_at: at(0, 0) }], { observed_at: at(4, 45) }, at(4, 45));
  assert.equal(stale.length, 1);
});

// --- kapacitet ----------------------------------------------------------------

test("prognose: uden bekræftet grænse er unable (databasestørrelse er ikke disk)", () => {
  const r = evaluateForecast([{ date: "2026-10-21", database_bytes: 6e9 }], undefined);
  assert.equal(r.outcome, "unable_to_assess");
  assert.match(r.missing, /confirmed_limit/);
});

test("prognose: 7 sammenhængende dage med vækst mod grænse inden 14 dage er finding", () => {
  let h = [];
  for (let d = 1; d <= 7; d += 1) h = pushSizeHistory(h, `2026-10-0${d}`, 9e9 + d * 1e8);
  const r = evaluateForecast(h, 10e9);
  assert.equal(r.outcome, "finding");
  assert.equal(r.value.days_remaining, 3);
  assert.equal(evaluateForecast(h.slice(1), 10e9).missing, "seven_daily_measurements");
});

test("prognose: hul i historikken eller fladt forløb giver ingen dato", () => {
  const gap = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]
    .map((date) => ({ date, database_bytes: 5e9 }));
  assert.equal(evaluateForecast(gap, 10e9).missing, "continuous_daily_measurements");
  const flat = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-0${i + 1}`, database_bytes: 5e9 }));
  assert.equal(evaluateForecast(flat, 10e9).outcome, "clear");
});

test("prognose: efter et hul bruges de seneste 7 sammenhængende dage", () => {
  const before = [{ date: "2026-10-01", database_bytes: 1e9 }, { date: "2026-10-02", database_bytes: 1e9 }];
  const after = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(10 + i).padStart(2, "0")}`, database_bytes: 9e9 + (i + 1) * 1e8 }));
  const r = evaluateForecast([...before, ...after], 10e9);
  assert.equal(r.outcome, "finding");
  assert.equal(r.value.days_remaining, 3);
});

test("pushSizeHistory: én måling pr. dag, sorteret", () => {
  let h = pushSizeHistory([], "2026-10-02", 2);
  h = pushSizeHistory(h, "2026-10-01", 1);
  h = pushSizeHistory(h, "2026-10-02", 3);
  assert.deepEqual(h, [{ date: "2026-10-01", database_bytes: 1 }, { date: "2026-10-02", database_bytes: 3 }]);
});

// --- fuld kørsel ---------------------------------------------------------------

const capacity = { database_bytes: 6151228563, top_tables: [{ schemaname: "public", table_name: "race_results", total_bytes: 1 }], connections_by_role: [] };

test("snapshot-mode: kun værn + pg_stat_statements, tilstanden vokser", async () => {
  const runSql = fakeRunSql({ guard: GOOD_GUARD, statements: stmtRaw(at(2), [["1", 1, 1]]) });
  const { result, state } = await runChecks({ runSql, state: null, mode: "snapshot", nowIso: at(2) });
  assert.deepEqual(runSql.calls, ["guard", "statements"]);
  assert.equal(state.pssSnapshots.length, 1);
  assert.equal(result.checks[0].missing, "three_hourly_snapshots");
});

test("report-mode: ét fejlende tjek stopper ikke de andre", async () => {
  const runSql = fakeRunSql({
    guard: GOOD_GUARD,
    statements: failing("object_missing"),
    connections: { client_connections: 56, active_connections: 1, max_connections: 120 },
    sessions: [],
    capacity,
    cache: { heap_hits: 99, heap_reads: 1, heap_hit_percent: 99 },
  });
  const { result, state, exitCode } = await runChecks({ runSql, state: null, mode: "report", nowIso: at(4) });
  assert.equal(exitCode, 0);
  const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.equal(byId.connection_pressure.outcome, "clear");
  assert.equal(byId.long_sessions.outcome, "clear");
  assert.equal(byId.query_execution_time.missing, "pg_stat_statements:object_missing");
  assert.equal(byId.capacity_forecast.outcome, "unable_to_assess");
  assert.equal(state.sizeHistory.length, 1);
  assert.equal(result.measurements.capacity.database_bytes, 6151228563);
});

test("report-mode uden pg_read_all_stats: sessionstjek er unable, ikke clear", async () => {
  const runSql = fakeRunSql({
    guard: { ...GOOD_GUARD, read_all_stats: false },
    statements: stmtRaw(at(4), []),
    connections: { client_connections: 1, active_connections: 1, max_connections: 120 },
    sessions: [],
    capacity,
    cache: {},
  });
  const { result } = await runChecks({ runSql, state: null, mode: "report", nowIso: at(4) });
  const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.equal(byId.connection_pressure.missing, "pg_read_all_stats");
  assert.equal(byId.long_sessions.missing, "pg_read_all_stats");
});

// --- kommentar ----------------------------------------------------------------

test("kommentar: starter med markøren og indeholder parsebar JSON", async () => {
  const runSql = fakeRunSql({
    guard: GOOD_GUARD,
    statements: stmtRaw(at(4), []),
    connections: { client_connections: 97, active_connections: 9, max_connections: 120 },
    sessions: [],
    capacity,
    cache: {},
  });
  const { result } = await runChecks({ runSql, state: null, mode: "report", nowIso: at(4) });
  const body = renderComment(result, "https://github.com/x/y/actions/runs/1");
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /`connection_pressure` \| FUND \| 97\/120/);
  const json = JSON.parse(body.slice(body.indexOf("```json") + 7, body.lastIndexOf("```")));
  assert.equal(json.project, "ghwvkxzhsbbltzfnuhhz");
  assert.equal(json.guard.ok, true);
});

test("kommentar: holdes under GitHubs loft", () => {
  const big = {
    observed_at: at(4), guard: { ok: true }, checks: [],
    measurements: { capacity: { database_bytes: 1, top_tables: Array.from({ length: 5000 }, (_, i) => ({ table_name: `t${i}`.padEnd(20, "x") })) } },
  };
  assert.ok(renderComment(big).length < 65_536);
});

// --- psql + CLI ---------------------------------------------------------------

test("psql-fejl klassificeres uden host eller URL", () => {
  assert.equal(classifyPsqlFailure({ stderr: "FATAL: password authentication failed for user cz_monitor" }), "login_rejected");
  assert.equal(classifyPsqlFailure({ stderr: 'could not translate host name "aws-0-x.pooler.supabase.com"' }), "connection_refused");
  assert.equal(classifyPsqlFailure({ code: "ENOENT" }), "psql_not_found");
  assert.equal(classifyPsqlFailure({ stderr: "ERROR: permission denied for table x" }), "permission_denied");
});

test("psql-runner: URL gives kun som argument, stderr lækker ikke", async () => {
  const seen = [];
  const execFn = async (cmd, args) => {
    seen.push([cmd, args]);
    const err = new Error("psql: error: connection to server at postgresql://u:pw@h failed");
    err.stderr = "connection to server at postgresql://u:pw@h failed: password authentication failed";
    throw err;
  };
  const run = makePsqlRunner("postgresql://u:pw@h:5432/postgres", execFn);
  await assert.rejects(run("select 1"), (e) => e.reason === "login_rejected" && !e.message.includes("pw"));
  assert.equal(seen[0][0], "psql");
});

test("main: mangler secret -> exit 1 uden at køre psql", async () => {
  let called = false;
  const code = await main({ argv: ["--mode", "report"], env: {}, execFn: async () => { called = true; }, log: () => {} });
  assert.equal(code, 1);
  assert.equal(called, false);
});

test("main: skriver JSON, kommentar og tilstand; log indeholder ingen URL", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phs-"));
  const answers = new Map([
    [SQL.guard, GOOD_GUARD],
    [SQL.statements, stmtRaw(at(4), [["1", 5, 5]])],
    [SQL.connections, { client_connections: 10, active_connections: 1, max_connections: 120 }],
    [SQL.sessions, []],
    [SQL.capacity, capacity],
    [SQL.cache, { heap_hits: 1, heap_reads: 0, heap_hit_percent: 100 }],
  ]);
  const execFn = async (_cmd, args) => ({ stdout: JSON.stringify(answers.get(args.at(-1))) });
  const logs = [];
  const url = "postgresql://cz_monitor.ghwvkxzhsbbltzfnuhhz:hemmelig@pooler:5432/postgres";
  const code = await main({
    argv: ["--mode", "report", "--out", path.join(dir, "r.json"), "--comment", path.join(dir, "c.md")],
    env: { CZ_MONITOR_DATABASE_URL: url, PROD_HEALTH_SQL_STATE: path.join(dir, "s", "state.json") },
    execFn,
    now: () => new Date(at(4)),
    log: (l) => logs.push(l),
  });
  assert.equal(code, 0);
  const files = ["r.json", "c.md", "s/state.json"].map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  for (const text of [...files, logs.join("\n")]) assert.equal(text.includes("hemmelig"), false);
  assert.equal(JSON.parse(files[2]).pssSnapshots.length, 1);
});
