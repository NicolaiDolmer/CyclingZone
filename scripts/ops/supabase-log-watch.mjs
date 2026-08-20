#!/usr/bin/env node
/**
 * Cycling Zone — Supabase logflade-vagt (#4014)
 * ===============================================
 * 20/8-2026 kørte 7.727 `MalformedJWT`-fejl (realtime_logs) + ~1.800
 * PostgREST-timeouts i døgnet usete — Sentry ser kun exceptions i vores
 * eget kodesprog, og `get_advisors` ser skema/RLS/indexes, ALDRIG log-
 * strømmen. Dette script lukker det hul: aggregerer fejl-lignende linjer
 * pr. (source, fejlklasse) over de seneste 24t via Supabase Management-
 * API'ets logquery-endpoint, og sammenligner mod det foregående døgn for
 * at finde NYE fejlklasser (ikke kun høj-volumen-gengangere).
 *
 * Kilde for query-mønster: docs/audits/2026-08-04-supabase-hardening.md +
 * issue #4010 (samme fire fejlklasser der udløste denne vagt).
 *
 * READ-ONLY — kalder kun GET .../analytics/endpoints/logs.all. Ingen
 * mutationer, ingen secret-værdier printes nogensinde.
 *
 * Env:
 *   SUPABASE_ACCESS_TOKEN        (påkrævet) — personal access token, Supabase
 *                                 Dashboard → Account → Access Tokens. IKKE
 *                                 samme som SUPABASE_DB_URL/service-key.
 *   SUPABASE_PROJECT_REF          (valgfri) — default 'ghwvkxzhsbbltzfnuhhz'.
 *   SUPABASE_LOG_ERROR_THRESHOLD  (valgfri) — antal/døgn der udløser
 *                                 "høj-volumen"-fund. Default 200.
 *   SUPABASE_LOG_NEW_CLASS_THRESHOLD (valgfri) — antal/døgn der udløser
 *                                 "ny fejlklasse"-fund. Default 20 (undgår
 *                                 at et enkelt engangs-request larmer).
 *
 * Usage:
 *   node scripts/ops/supabase-log-watch.mjs            # menneskelig output
 *   node scripts/ops/supabase-log-watch.mjs --json      # maskinlæsbart
 *
 * Exit: 0 = kørte OK (uanset fund/ej-fund) · 1 = config/API-fejl.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

export const SOURCES = ["edge_logs", "postgres_logs", "postgrest_logs", "realtime_logs", "auth_logs"];

export const LOG_SQL = `
select
  source,
  multiIf(
    source = 'edge_logs', concat(log_attributes['response.status_code'], ' ', log_attributes['request.path']),
    source = 'auth_logs', coalesce(nullIf(log_attributes['error_code'], ''), substring(event_message, 1, 60)),
    substring(event_message, 1, 60)
  ) as bucket,
  count() as cnt
from logs
where source in (${SOURCES.map((s) => `'${s}'`).join(",")})
  and (
    (source = 'edge_logs' and toInt32OrZero(log_attributes['response.status_code']) >= 500)
    or (source = 'auth_logs' and (toInt32OrZero(log_attributes['status']) >= 400 or log_attributes['level'] = 'error'))
    or (source not in ('edge_logs','auth_logs') and match(event_message, '(?i)(error|fatal|panic|denied|malformed|timeout|failed|exception)'))
  )
group by source, bucket
order by cnt desc
limit 500
`.trim();

function toKey(row) {
  return `${row.source}::${row.bucket}`;
}

/**
 * Ren klassifikationslogik — ingen netvaerk. Sammenligner "current" (seneste
 * 24t) mod "previous" (24-48t siden) for at finde hoej-volumen-fund og fund
 * der er helt NYE (fandtes ikke i gaars vindue).
 * @param {{source:string, bucket:string, cnt:number}[]} current
 * @param {{source:string, bucket:string, cnt:number}[]} previous
 * @param {{errorThreshold?:number, newClassThreshold?:number}} [opts]
 */
export function computeFindings(current, previous, opts = {}) {
  const errorThreshold = opts.errorThreshold ?? 200;
  const newClassThreshold = opts.newClassThreshold ?? 20;
  const previousKeys = new Set(previous.map(toKey));

  const spikes = current
    .filter((r) => r.cnt >= errorThreshold)
    .sort((a, b) => b.cnt - a.cnt);

  const newClasses = current
    .filter((r) => !previousKeys.has(toKey(r)) && r.cnt >= newClassThreshold)
    .sort((a, b) => b.cnt - a.cnt);

  return { spikes, newClasses, hasFindings: spikes.length > 0 || newClasses.length > 0 };
}

/** @returns {Promise<{source:string, bucket:string, cnt:number}[]>} */
async function queryLogs(token, ref, startIso, endIso) {
  const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all`);
  url.searchParams.set("sql", LOG_SQL);
  url.searchParams.set("iso_timestamp_start", startIso);
  url.searchParams.set("iso_timestamp_end", endIso);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Management-API ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  // Endpoint-shape: { result: [...] } — men vaer defensiv hvis Supabase aendrer wrapping.
  const rows = Array.isArray(body) ? body : body.result || body.data || [];
  return rows.map((r) => ({ source: String(r.source), bucket: String(r.bucket ?? ""), cnt: Number(r.cnt || 0) }));
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || "ghwvkxzhsbbltzfnuhhz";
  const errorThreshold = Number(process.env.SUPABASE_LOG_ERROR_THRESHOLD || 200);
  const newClassThreshold = Number(process.env.SUPABASE_LOG_NEW_CLASS_THRESHOLD || 20);
  const asJson = process.argv.includes("--json");

  if (!token) {
    console.error("[supabase-log-watch] FAIL: SUPABASE_ACCESS_TOKEN mangler i env.");
    console.error("  Opret et personal access token: Supabase Dashboard -> Account -> Access Tokens.");
    console.error("  Saet det som GitHub-secret: gh secret set SUPABASE_ACCESS_TOKEN (aldrig i kode/logs).");
    process.exit(1);
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000);

  let current, previous;
  try {
    [current, previous] = await Promise.all([
      queryLogs(token, ref, dayAgo.toISOString(), now.toISOString()),
      queryLogs(token, ref, twoDaysAgo.toISOString(), dayAgo.toISOString()),
    ]);
  } catch (err) {
    console.error(`[supabase-log-watch] FAIL: ${err.message}`);
    process.exit(1);
  }

  const { spikes, newClasses, hasFindings } = computeFindings(current, previous, { errorThreshold, newClassThreshold });

  if (asJson) {
    console.log(JSON.stringify({ hasFindings, spikes, newClasses, window: { start: dayAgo.toISOString(), end: now.toISOString() } }, null, 2));
  } else {
    console.log(`[supabase-log-watch] Vindue: ${dayAgo.toISOString()} -> ${now.toISOString()}`);
    console.log(`[supabase-log-watch] Terskler: spike>=${errorThreshold}/dogn, ny-klasse>=${newClassThreshold}/dogn`);
    if (!hasFindings) {
      console.log("[supabase-log-watch] OK - ingen terskel-brud, ingen nye fejlklasser.");
    } else {
      if (spikes.length) {
        console.log(`\n== Hoej-volumen (>= ${errorThreshold}/dogn) ==`);
        for (const s of spikes) console.log(`  ${s.cnt.toString().padStart(6)}  ${s.source}  ${s.bucket}`);
      }
      if (newClasses.length) {
        console.log(`\n== Nye fejlklasser (saas ikke i gaar, >= ${newClassThreshold}) ==`);
        for (const n of newClasses) console.log(`  ${n.cnt.toString().padStart(6)}  ${n.source}  ${n.bucket}`);
      }
    }
  }

  // GitHub Actions output-kontrakt (mirror scripts/db-health.sql-workflowets moenster).
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_findings=${hasFindings}\n`);
    if (hasFindings) {
      const body = [];
      if (spikes.length) {
        body.push(`Hoej-volumen (>= ${errorThreshold}/dogn):`);
        for (const s of spikes.slice(0, 15)) body.push(`- ${s.cnt} | ${s.source} | ${s.bucket}`);
      }
      if (newClasses.length) {
        body.push(`Nye fejlklasser (saas ikke i gaar, >= ${newClassThreshold}):`);
        for (const n of newClasses.slice(0, 15)) body.push(`- ${n.cnt} | ${n.source} | ${n.bucket}`);
      }
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `findings<<LOGWATCH_EOF\n${body.join("\n")}\nLOGWATCH_EOF\n`);
    }
  }

  process.exit(0);
}

if (isMain()) {
  main();
}
