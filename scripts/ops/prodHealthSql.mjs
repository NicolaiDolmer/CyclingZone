#!/usr/bin/env node
/**
 * Cycling Zone - daglige SQL-helbredstjek mod prod (#6994)
 * ========================================================
 * Den daglige Claude-rutine (trig_013j9v3m5NFNeL1kdegbmQxJ) har ingen SQL,
 * fordi rutinens Supabase-connector ikke kan låses read-only. Derfor kører de
 * Postgres-baserede tjek fra Supabase' guide
 * (https://supabase.com/docs/guides/observability/detecting.md) her, i en
 * deterministisk GitHub Action med rollen cz_monitor, som databasen selv låser
 * til kun at læse statistik (database/2026-10-20-6994-cz-monitor-role.sql).
 *
 * Tjek (navne og tærskler som i guiden):
 *   connection_pressure    klientforbindelser >= 80 % af max_connections
 *   long_sessions          aktive queries > 30 s, idle in transaction > 30 s,
 *                          sessioner med blocking_pids (låse/ventende)
 *   query_execution_time   pg_stat_statements: nuværende times middeltid
 *                          >= 100 ms og >= 2x forrige time, >= 20 kald i begge.
 *                          Kræver tre snapshots med ca. en times mellemrum
 *                          (workflowet kører 02:45, 03:45 og 04:45 UTC).
 *   capacity_forecast      dagens databasestørrelse gemmes; prognose kræver
 *                          >= 7 dage + bekræftet grænse (ellers unable)
 * Målinger uden alarm: databasestørrelse, top-20 tabeller, forbindelser pr.
 * rolle/state, cache-hit (kontekst).
 *
 * Hvert tjek giver outcome finding | clear | unable_to_assess (+ manglende input).
 *
 * Sikkerhed:
 *   - Kun SELECT. Før noget tjek køres et værn: current_user skal være
 *     cz_monitor og transaction_read_only = on, ellers køres INTET (exit 2).
 *   - Ingen query-tekst, ingen rækkedata, ingen persondata i output: kun
 *     queryid, rollenavne, pid, alder i sekunder, wait events, tal og
 *     tabelnavne.
 *   - Connection-string printes aldrig; psql-stderr printes aldrig (kan
 *     indeholde host). Fejl klassificeres groft.
 *
 * Env:
 *   CZ_MONITOR_DATABASE_URL     påkrævet (GitHub-secret; session-pooler, port 5432)
 *   PROD_HEALTH_SQL_STATE       tilstandsfil, default .prod-health-sql-state/state.json
 *   PROD_HEALTH_SQL_DB_LIMIT_BYTES  valgfri bekræftet grænse til prognosen
 *
 * Brug:
 *   node scripts/ops/prodHealthSql.mjs --mode snapshot
 *   node scripts/ops/prodHealthSql.mjs --mode report --out prod-health-sql.json --comment prod-health-sql.md
 *
 * Exit: 0 = kørte (også med fund) · 1 = config-fejl · 2 = værn afvist (forkert rolle/ikke read-only).
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PROJECT_REF = "ghwvkxzhsbbltzfnuhhz";
export const EXPECTED_ROLE = "cz_monitor";
export const COMMENT_MARKER = "<!-- prod-health-sql -->";
export const SCHEMA_VERSION = 1;

export const THRESHOLDS = {
  connectionPressurePct: 80,
  longSessionSeconds: 30,
  sessionRowLimit: 20,
  slowMeanMs: 100,
  slowRatio: 2,
  minCallsPerInterval: 20,
  // Guiden: snapshots "spaced one hour apart". GitHub-cron kan forsinkes, så
  // vi accepterer 45-90 min mellem to snapshots.
  snapshotSpacingMinMinutes: 45,
  snapshotSpacingMaxMinutes: 90,
  forecastMinDays: 7,
  forecastMaxDaysAhead: 14,
};

const MAX_PSS_SNAPSHOTS = 3;
const MAX_SIZE_HISTORY = 30;
const SNAPSHOT_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function isMain() {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SQL (alle returnerer én JSON-værdi i én kolonne)
// ---------------------------------------------------------------------------

export const SQL = {
  guard: `select json_build_object(
  'role', current_user,
  'read_only', current_setting('transaction_read_only'),
  'read_all_stats', pg_has_role(current_user, 'pg_read_all_stats', 'USAGE'),
  'server_version_num', current_setting('server_version_num')::int)`,

  connections: `select row_to_json(t) from (
select
  count(*) filter (where backend_type = 'client backend') as client_connections,
  count(*) filter (where backend_type = 'client backend' and state = 'active') as active_connections,
  current_setting('max_connections')::int as max_connections
from pg_stat_activity) t`,

  sessions: `select coalesce(json_agg(t), '[]'::json) from (
select pid, usename as role, state,
  round(extract(epoch from now() - query_start))::bigint as query_age_s,
  round(extract(epoch from now() - xact_start))::bigint as transaction_age_s,
  wait_event_type, wait_event,
  pg_blocking_pids(pid) as blocking_pids
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and (
    (state = 'active' and now() - query_start > interval '30 seconds')
    or (state like 'idle in transaction%' and now() - xact_start > interval '30 seconds')
    or cardinality(pg_blocking_pids(pid)) > 0
  )
order by query_start
limit 20) t`,

  // Ingen query-tekst: kun nøgle, kald og samlet tid.
  statements: `select json_build_object(
  'observed_at', now(),
  'info', (select row_to_json(i) from (select stats_reset, dealloc from extensions.pg_stat_statements_info) i),
  'rows', coalesce((select json_agg(t) from (
    select s.dbid, s.userid, pg_get_userbyid(s.userid) as role, s.queryid::text as queryid,
      s.toplevel, s.calls, s.total_exec_time,
      to_jsonb(s) ->> 'stats_since' as statement_stats_since
    from extensions.pg_stat_statements as s
    where s.dbid = (select oid from pg_database where datname = current_database())
    order by s.total_exec_time desc
    limit 100) t), '[]'::json))`,

  capacity: `select json_build_object(
  'observed_at', now(),
  'database_bytes', pg_database_size(current_database()),
  'top_tables', coalesce((select json_agg(t) from (
    select schemaname, relname as table_name, pg_total_relation_size(relid) as total_bytes
    from pg_catalog.pg_statio_user_tables
    order by total_bytes desc
    limit 20) t), '[]'::json),
  'connections_by_role', coalesce((select json_agg(t) from (
    select usename as role, state, count(*) as connections
    from pg_stat_activity
    where datname = current_database() and backend_type = 'client backend'
    group by usename, state
    order by connections desc
    limit 100) t), '[]'::json))`,

  cache: `select row_to_json(t) from (
select
  sum(heap_blks_hit) as heap_hits,
  sum(heap_blks_read) as heap_reads,
  round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) as heap_hit_percent
from pg_statio_user_tables) t`,
};

// ---------------------------------------------------------------------------
// psql-kørsel
// ---------------------------------------------------------------------------

/** REN: psql-fejl -> grov klasse uden at afsløre host/URL. */
export function classifyPsqlFailure(err) {
  const text = `${err?.stderr ?? ""}`;
  if (err?.code === "ENOENT") return "psql_not_found";
  if (err?.killed || err?.signal) return "psql_timeout";
  if (/statement timeout/i.test(text)) return "statement_timeout";
  if (/timeout expired|timed out/i.test(text)) return "connect_timeout";
  if (/too many connections|remaining connection slots/i.test(text)) return "too_many_connections";
  if (/password authentication failed|authentication failed/i.test(text)) return "login_rejected";
  if (/permission denied/i.test(text)) return "permission_denied";
  if (/does not exist/i.test(text)) return "object_missing";
  if (/could not connect|connection refused|could not translate host/i.test(text)) return "connection_refused";
  return "query_failed";
}

/** Returnerer en funktion sql -> JSON-værdi; kaster { reason } ved fejl. */
export function makePsqlRunner(dbUrl, execFn = execFileAsync) {
  return async function runSql(sql) {
    let stdout;
    try {
      ({ stdout } = await execFn(
        "psql",
        [dbUrl, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
        {
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, PGCONNECT_TIMEOUT: "10", PGAPPNAME: "cz-prod-health-sql" },
        }
      ));
    } catch (err) {
      const e = new Error("psql failed");
      e.reason = classifyPsqlFailure(err);
      throw e;
    }
    try {
      return JSON.parse(String(stdout).trim());
    } catch {
      const e = new Error("bad json");
      e.reason = "unexpected_output";
      throw e;
    }
  };
}

// ---------------------------------------------------------------------------
// Vurderinger (RENE)
// ---------------------------------------------------------------------------

function unable(id, missing, extra = {}) {
  return { id, outcome: "unable_to_assess", missing, ...extra };
}

/** Værn: kør intet, hvis forbindelsen ikke er cz_monitor i read-only. */
export function evaluateGuard(guard) {
  if (!guard || typeof guard !== "object") return { ok: false, reason: "guard_no_answer" };
  if (guard.role !== EXPECTED_ROLE) return { ok: false, reason: "wrong_role" };
  if (guard.read_only !== "on") return { ok: false, reason: "not_read_only" };
  return { ok: true, readAllStats: guard.read_all_stats === true };
}

export function evaluateConnections(row) {
  const id = "connection_pressure";
  const max = Number(row?.max_connections);
  const clients = Number(row?.client_connections);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(clients)) return unable(id, "max_connections_or_count");
  const pct = Math.round((1000 * clients) / max) / 10;
  return {
    id,
    outcome: pct >= THRESHOLDS.connectionPressurePct ? "finding" : "clear",
    value: { client_connections: clients, active_connections: Number(row.active_connections) || 0, max_connections: max, percent: pct },
    threshold: { percent_of_max_connections: THRESHOLDS.connectionPressurePct },
    unit: "connections",
  };
}

export function classifySession(row) {
  const kinds = [];
  if (Array.isArray(row.blocking_pids) && row.blocking_pids.length > 0) kinds.push("blocked");
  if (row.state === "active" && Number(row.query_age_s) > THRESHOLDS.longSessionSeconds) kinds.push("long_query");
  if (typeof row.state === "string" && row.state.startsWith("idle in transaction")
      && Number(row.transaction_age_s) > THRESHOLDS.longSessionSeconds) kinds.push("idle_in_transaction");
  return kinds;
}

export function evaluateSessions(rows) {
  const id = "long_sessions";
  if (!Array.isArray(rows)) return unable(id, "pg_stat_activity_rows");
  const sessions = rows.map((r) => ({
    pid: r.pid,
    role: r.role ?? null,
    state: r.state ?? null,
    query_age_s: r.query_age_s ?? null,
    transaction_age_s: r.transaction_age_s ?? null,
    wait_event_type: r.wait_event_type ?? null,
    wait_event: r.wait_event ?? null,
    blocking_pids: Array.isArray(r.blocking_pids) ? r.blocking_pids : [],
    kinds: classifySession(r),
  }));
  const count = (k) => sessions.filter((s) => s.kinds.includes(k)).length;
  const blockerPids = [...new Set(sessions.flatMap((s) => s.blocking_pids))].sort((a, b) => a - b);
  return {
    id,
    outcome: sessions.length > 0 ? "finding" : "clear",
    value: {
      rows: sessions.length,
      truncated: sessions.length >= THRESHOLDS.sessionRowLimit,
      blocked: count("blocked"),
      long_query: count("long_query"),
      idle_in_transaction: count("idle_in_transaction"),
      blocker_pids: blockerPids,
      sessions,
    },
    threshold: { seconds: THRESHOLDS.longSessionSeconds, row_limit: THRESHOLDS.sessionRowLimit },
    unit: "sessions",
  };
}

/** REN: rå pg_stat_statements-svar -> kompakt snapshot til tilstanden. */
export function toStatementSnapshot(raw) {
  const rows = {};
  for (const r of raw?.rows ?? []) {
    if (r.queryid === null || r.queryid === undefined) continue;
    rows[`${r.dbid}:${r.userid}:${r.queryid}:${r.toplevel}`] = {
      role: r.role ?? null,
      queryid: String(r.queryid),
      calls: Number(r.calls),
      total_exec_time: Number(r.total_exec_time),
      stats_since: r.statement_stats_since ?? null,
    };
  }
  return {
    observed_at: raw?.observed_at ?? null,
    stats_reset: raw?.info?.stats_reset ?? null,
    dealloc: raw?.info?.dealloc ?? null,
    row_count: (raw?.rows ?? []).length,
    rows,
  };
}

/** Behold de seneste snapshots (nyeste sidst), drop dem ældre end 4 t. */
export function pushSnapshot(list, snap, nowIso) {
  const now = new Date(nowIso).getTime();
  const kept = (Array.isArray(list) ? list : []).filter(
    (s) => s?.observed_at && now - new Date(s.observed_at).getTime() <= SNAPSHOT_MAX_AGE_MS
  );
  kept.push(snap);
  return kept.slice(-MAX_PSS_SNAPSHOTS);
}

export function evaluateStatements(snapshots) {
  const id = "query_execution_time";
  const threshold = {
    current_mean_ms: THRESHOLDS.slowMeanMs,
    ratio_to_preceding: THRESHOLDS.slowRatio,
    min_calls_per_interval: THRESHOLDS.minCallsPerInterval,
  };
  if (!Array.isArray(snapshots) || snapshots.length < 3) {
    return unable(id, "three_hourly_snapshots", { threshold, value: { snapshots: snapshots?.length ?? 0 } });
  }
  const [s0, s1, s2] = snapshots.slice(-3);
  const t = [s0, s1, s2].map((s) => new Date(s.observed_at).getTime());
  const gaps = [(t[1] - t[0]) / 60_000, (t[2] - t[1]) / 60_000];
  if (gaps.some((g) => !Number.isFinite(g) || g < THRESHOLDS.snapshotSpacingMinMinutes || g > THRESHOLDS.snapshotSpacingMaxMinutes)) {
    return unable(id, "snapshot_spacing", { threshold, value: { gaps_minutes: gaps.map((g) => Math.round(g)) } });
  }
  if (s0.stats_reset !== s1.stats_reset || s1.stats_reset !== s2.stats_reset
      || s0.dealloc !== s1.dealloc || s1.dealloc !== s2.dealloc) {
    return unable(id, "stats_reset_or_dealloc_changed", { threshold });
  }

  let compared = 0;
  let unconfirmed = 0;
  const findings = [];
  for (const [key, c] of Object.entries(s2.rows)) {
    const a = s0.rows[key];
    const b = s1.rows[key];
    if (!a || !b) continue;
    if (!a.stats_since || !b.stats_since || !c.stats_since) { unconfirmed += 1; continue; }
    if (a.stats_since !== b.stats_since || b.stats_since !== c.stats_since) continue;
    if (b.calls < a.calls || c.calls < b.calls || b.total_exec_time < a.total_exec_time || c.total_exec_time < b.total_exec_time) continue;
    const callsPrev = b.calls - a.calls;
    const callsCur = c.calls - b.calls;
    if (callsPrev < THRESHOLDS.minCallsPerInterval || callsCur < THRESHOLDS.minCallsPerInterval) continue;
    compared += 1;
    const meanPrev = (b.total_exec_time - a.total_exec_time) / callsPrev;
    const meanCur = (c.total_exec_time - b.total_exec_time) / callsCur;
    if (meanCur >= THRESHOLDS.slowMeanMs && meanCur >= THRESHOLDS.slowRatio * meanPrev) {
      findings.push({
        queryid: c.queryid,
        role: c.role,
        calls_preceding: callsPrev,
        calls_current: callsCur,
        mean_ms_preceding: Math.round(meanPrev * 10) / 10,
        mean_ms_current: Math.round(meanCur * 10) / 10,
      });
    }
  }
  if (compared === 0 && unconfirmed > 0) {
    return unable(id, "statement_stats_since", { threshold });
  }
  findings.sort((x, y) => y.mean_ms_current - x.mean_ms_current);
  return {
    id,
    outcome: findings.length > 0 ? "finding" : "clear",
    value: {
      window_start: s0.observed_at,
      window_end: s2.observed_at,
      compared_statements: compared,
      sample: "top 100 by total_exec_time",
      findings: findings.slice(0, 10),
    },
    threshold,
    unit: "ms",
  };
}

export function pushSizeHistory(list, dateUtc, bytes) {
  const kept = (Array.isArray(list) ? list : []).filter((p) => p?.date !== dateUtc);
  kept.push({ date: dateUtc, database_bytes: bytes });
  kept.sort((a, b) => a.date.localeCompare(b.date));
  return kept.slice(-MAX_SIZE_HISTORY);
}

export function evaluateForecast(history, limitBytes) {
  const id = "capacity_forecast";
  const limit = Number(limitBytes);
  if (!Number.isFinite(limit) || limit <= 0) {
    return unable(id, "confirmed_limit (database size is not disk usage)", { value: { days_of_history: history?.length ?? 0 } });
  }
  const pts = Array.isArray(history) ? history : [];
  const latest = pts.at(-1);
  if (latest && latest.database_bytes >= limit) {
    return { id, outcome: "finding", value: { latest_bytes: latest.database_bytes, limit_bytes: limit, days_remaining: 0 }, threshold: { days_ahead: THRESHOLDS.forecastMaxDaysAhead }, unit: "bytes" };
  }
  if (pts.length < THRESHOLDS.forecastMinDays) {
    return unable(id, "seven_daily_measurements", { value: { days_of_history: pts.length } });
  }
  // Diskontinuitet (hul > 1 dag) gør prognosen ugyldig.
  for (let i = 1; i < pts.length; i += 1) {
    const gapDays = (Date.parse(pts[i].date) - Date.parse(pts[i - 1].date)) / 86_400_000;
    if (gapDays !== 1) return unable(id, "continuous_daily_measurements", { value: { days_of_history: pts.length } });
  }
  const first = pts[0];
  const elapsed = (Date.parse(latest.date) - Date.parse(first.date)) / 86_400_000;
  const growth = (latest.database_bytes - first.database_bytes) / elapsed;
  if (!(growth > 0)) {
    return { id, outcome: "clear", value: { growth_bytes_per_day: Math.round(growth), limit_bytes: limit }, threshold: { days_ahead: THRESHOLDS.forecastMaxDaysAhead }, unit: "bytes" };
  }
  const daysRemaining = (limit - latest.database_bytes) / growth;
  return {
    id,
    outcome: daysRemaining <= THRESHOLDS.forecastMaxDaysAhead ? "finding" : "clear",
    value: { growth_bytes_per_day: Math.round(growth), days_remaining: Math.round(daysRemaining * 10) / 10, limit_bytes: limit, label: "linear estimate" },
    threshold: { days_ahead: THRESHOLDS.forecastMaxDaysAhead },
    unit: "bytes",
  };
}

// ---------------------------------------------------------------------------
// Tilstand
// ---------------------------------------------------------------------------

export function normalizeState(raw) {
  return {
    pssSnapshots: Array.isArray(raw?.pssSnapshots) ? raw.pssSnapshots : [],
    sizeHistory: Array.isArray(raw?.sizeHistory) ? raw.sizeHistory : [],
  };
}

function readState(file) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return normalizeState(null);
  }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
}

// ---------------------------------------------------------------------------
// Kørsel
// ---------------------------------------------------------------------------

async function attempt(runSql, sql) {
  try {
    return { ok: true, data: await runSql(sql) };
  } catch (err) {
    return { ok: false, reason: err?.reason ?? "query_failed" };
  }
}

/**
 * Kører værn + tjek. REN bortset fra runSql (injiceres i tests).
 * mode 'snapshot': kun pg_stat_statements-snapshot til tilstanden.
 * mode 'report': alle tjek + rapport.
 */
export async function runChecks({ runSql, state: stateIn, mode, nowIso, limitBytes }) {
  const state = normalizeState(stateIn);
  const result = {
    schema: SCHEMA_VERSION,
    marker: "prod-health-sql",
    project: PROJECT_REF,
    observed_at: nowIso,
    mode,
    guard: null,
    checks: [],
    measurements: {},
  };

  const guardRes = await attempt(runSql, SQL.guard);
  const guard = guardRes.ok ? evaluateGuard(guardRes.data) : { ok: false, reason: guardRes.reason };
  result.guard = guard.ok ? { ok: true, role: EXPECTED_ROLE, read_only: true, read_all_stats: guard.readAllStats } : { ok: false, reason: guard.reason };
  const allIds = ["connection_pressure", "long_sessions", "query_execution_time", "capacity_forecast"];
  if (!guard.ok) {
    result.checks = allIds.map((id) => unable(id, `guard:${guard.reason}`));
    return { result, state, exitCode: guard.reason === "wrong_role" || guard.reason === "not_read_only" ? 2 : 0 };
  }

  const stmtRes = await attempt(runSql, SQL.statements);
  let stmtCheck;
  if (stmtRes.ok) {
    state.pssSnapshots = pushSnapshot(state.pssSnapshots, toStatementSnapshot(stmtRes.data), nowIso);
    stmtCheck = evaluateStatements(state.pssSnapshots);
  } else {
    stmtCheck = unable("query_execution_time", `pg_stat_statements:${stmtRes.reason}`);
  }
  if (mode === "snapshot") {
    result.checks = [stmtCheck];
    return { result, state, exitCode: 0 };
  }

  const statsMissing = guard.readAllStats ? null : "pg_read_all_stats";

  const conn = await attempt(runSql, SQL.connections);
  result.checks.push(statsMissing ? unable("connection_pressure", statsMissing)
    : conn.ok ? evaluateConnections(conn.data) : unable("connection_pressure", `pg_stat_activity:${conn.reason}`));

  const sess = await attempt(runSql, SQL.sessions);
  result.checks.push(statsMissing ? unable("long_sessions", statsMissing)
    : sess.ok ? evaluateSessions(sess.data) : unable("long_sessions", `pg_stat_activity:${sess.reason}`));

  result.checks.push(stmtCheck);

  const cap = await attempt(runSql, SQL.capacity);
  if (cap.ok) {
    const bytes = Number(cap.data.database_bytes);
    state.sizeHistory = pushSizeHistory(state.sizeHistory, nowIso.slice(0, 10), bytes);
    result.measurements.capacity = {
      database_bytes: bytes,
      top_tables: cap.data.top_tables,
      connections_by_role: cap.data.connections_by_role,
    };
    result.checks.push(evaluateForecast(state.sizeHistory, limitBytes));
  } else {
    result.checks.push(unable("capacity_forecast", `size_measurement:${cap.reason}`));
  }

  const cache = await attempt(runSql, SQL.cache);
  result.measurements.cache = cache.ok ? { ...cache.data, note: "cumulative context, not an alert" } : { unable: cache.reason };

  return { result, state, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Kommentar (REN)
// ---------------------------------------------------------------------------

const OUTCOME_LABEL = { finding: "FUND", clear: "ok", unable_to_assess: "kan ikke vurderes" };

function summarize(check) {
  const v = check.value ?? {};
  switch (check.id) {
    case "connection_pressure":
      return v.max_connections ? `${v.client_connections}/${v.max_connections} klientforbindelser (${v.percent} %), tærskel ${check.threshold.percent_of_max_connections} %` : "";
    case "long_sessions":
      return v.rows !== undefined ? `${v.rows} sessioner (blokeret ${v.blocked}, lange queries ${v.long_query}, idle in transaction ${v.idle_in_transaction})${v.truncated ? ", afkortet ved 20" : ""}` : "";
    case "query_execution_time":
      return v.findings ? `${v.findings.length} langsommere queries af ${v.compared_statements} sammenlignede` : "";
    case "capacity_forecast":
      return v.days_remaining !== undefined ? `${v.days_remaining} dage til grænsen (lineært skøn)` : "";
    default:
      return "";
  }
}

export function renderComment(result, runUrl, slimmed = false) {
  const lines = [COMMENT_MARKER, `**SQL-helbredstjek** · observed_at ${result.observed_at} · rolle ${EXPECTED_ROLE} (read-only)`, ""];
  if (!result.guard?.ok) {
    lines.push(`Værnet afviste kørslen (${result.guard?.reason}). Ingen tjek er kørt.`, "");
  }
  lines.push("| Tjek | Resultat | Måling |", "|---|---|---|");
  for (const c of result.checks) {
    const detail = c.outcome === "unable_to_assess" ? `mangler: ${c.missing}` : summarize(c);
    lines.push(`| \`${c.id}\` | ${OUTCOME_LABEL[c.outcome] ?? c.outcome} | ${detail} |`);
  }
  lines.push("", "Tærskler og metode: Supabase detection checks. Ingen query-tekst eller persondata.");
  if (runUrl) lines.push(`Kørsel: ${runUrl}`);
  lines.push("", "```json", JSON.stringify(result, null, 2), "```");
  let body = lines.join("\n");
  // GitHub-loft 65.536 tegn: dropper detaljer før vi nogensinde afkorter JSON.
  if (body.length > 60_000 && !slimmed) {
    const slim = { ...result, measurements: { ...result.measurements, capacity: { database_bytes: result.measurements?.capacity?.database_bytes } } };
    return renderComment(slim, runUrl, true);
  }
  return body;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { mode: "report", out: null, comment: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--comment") args.comment = argv[++i];
  }
  return args;
}

export async function main({ argv = process.argv.slice(2), env = process.env, execFn = execFileAsync, now = () => new Date(), log = console.log } = {}) {
  const args = parseArgs(argv);
  if (!["snapshot", "report"].includes(args.mode)) {
    log("prod-health-sql: --mode skal være snapshot eller report");
    return 1;
  }
  const dbUrl = env.CZ_MONITOR_DATABASE_URL;
  if (!dbUrl) {
    log("prod-health-sql: CZ_MONITOR_DATABASE_URL mangler (GitHub-secret, se #6994)");
    return 1;
  }
  const stateFile = env.PROD_HEALTH_SQL_STATE || ".prod-health-sql-state/state.json";
  const { result, state, exitCode } = await runChecks({
    runSql: makePsqlRunner(dbUrl, execFn),
    state: readState(stateFile),
    mode: args.mode,
    nowIso: now().toISOString(),
    limitBytes: env.PROD_HEALTH_SQL_DB_LIMIT_BYTES,
  });
  if (result.guard?.ok) writeState(stateFile, state);
  if (args.out) fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  if (args.comment) {
    const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
    fs.writeFileSync(args.comment, `${renderComment(result, runUrl)}\n`);
  }
  for (const c of result.checks) log(`${c.id}: ${c.outcome}${c.missing ? ` (${c.missing})` : ""}`);
  if (!result.guard?.ok) log(`guard: ${result.guard?.reason}`);
  return exitCode;
}

if (isMain()) {
  main().then((code) => process.exit(code));
}
