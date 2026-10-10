#!/usr/bin/env node
// Chunk-fejl pr. release over 72 t + dom over stopreglen (#5162, spor K4).
//
// Hvorfor: deploy-verify's eksisterende trin "Chunk-fejl-rate efter deploy"
// tæller chunk-fejl i et rullende 24-timers vindue over HELE spillerbasen. Det
// kan ikke sige om carry-forward virker, fordi en fejl fra en gammel release og
// en fejl fra den nye ser ens ud i ét tal. Denne rapport deler tallet op pr.
// Sentry-release og dømmer ejerens stopregel (24/9): færre end 3 chunk-fejl pr.
// døgn over 72 t, målt fra det andet prod-deploy med carry-forward.
//
// KUN ADVISORY: scriptet afslutter ALTID med exit 0 (også ved API-fejl eller
// manglende secrets). Det må aldrig stoppe en deploy-verify-kørsel; den hårde
// grænse ligger i det eksisterende trin. Read-only: kun GET mod Sentry's
// events-API.
//
// BRUG:
//   node scripts/chunk-errors-per-release.mjs
//   node scripts/chunk-errors-per-release.mjs --json
//
// ENV:
//   SENTRY_AUTH_TOKEN  (påkrævet, ellers spring over) token med event:read
//   SENTRY_ORG         (default: cycling-zone)
//   SENTRY_API_HOST    (default: https://sentry.io, se scripts/sentry-issues.mjs om EU-regionen)
//   GITHUB_STEP_SUMMARY (sættes af Actions) rapporten tilføjes også dér
//
// Tokenet logges aldrig og indgår aldrig i en fejlbesked.

import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CHUNK_ERROR_QUERY = "frontend_error_kind:chunk_load_error";
export const WINDOW_DAYS = 3;
// Ejerens stopregel (24/9, #5162): under 3 events pr. døgn over 72 t.
export const STOP_RULE_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RELEASE_ROWS = 20;

export function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

export function resolveConfig(env = process.env) {
  const token = env.SENTRY_AUTH_TOKEN || "";
  if (!token) return { skip: "SENTRY_AUTH_TOKEN mangler i miljøet" };
  return {
    token,
    org: env.SENTRY_ORG || "cycling-zone",
    host: (env.SENTRY_API_HOST || "https://sentry.io").replace(/\/+$/, ""),
  };
}

/** URL til events-API'et. `window` er enten { statsPeriod } eller { start, end }. */
export function buildEventsUrl({ host, org }, { fields, window, sort, perPage }) {
  const url = new URL(`${host}/api/0/organizations/${encodeURIComponent(org)}/events/`);
  for (const field of fields) url.searchParams.append("field", field);
  url.searchParams.set("query", CHUNK_ERROR_QUERY);
  url.searchParams.set("dataset", "errors");
  if (window.statsPeriod) url.searchParams.set("statsPeriod", window.statsPeriod);
  if (window.start) url.searchParams.set("start", window.start);
  if (window.end) url.searchParams.set("end", window.end);
  if (sort) url.searchParams.set("sort", sort);
  if (perPage) url.searchParams.set("per_page", String(perPage));
  return url.toString();
}

/** De seneste `days` døgn som [start, end)-vinduer, nyeste først. */
export function buildDailyWindows(now, days = WINDOW_DAYS) {
  const end = now.getTime();
  return Array.from({ length: days }, (_, i) => ({
    label: i === 0 ? "seneste 24 t" : `${i * 24}-${(i + 1) * 24} t siden`,
    start: new Date(end - (i + 1) * DAY_MS).toISOString(),
    end: new Date(end - i * DAY_MS).toISOString(),
  }));
}

/** Rækkerne fra et events-svar med `release` + `count()` (+ evt. `count_unique(user)`). */
export function parseReleaseRows(body) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((row) => ({
      release: typeof row.release === "string" && row.release ? row.release : "(ingen release)",
      events: Number(row["count()"]) || 0,
      users: Number(row["count_unique(user)"]) || 0,
    }))
    .filter((row) => row.events > 0)
    .sort((a, b) => b.events - a.events || (a.release < b.release ? -1 : 1));
}

export function parseCount(body) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows.reduce((sum, row) => sum + (Number(row["count()"]) || 0), 0);
}

/**
 * Dom over stopreglen: holder når HVERT af de seneste døgn har færre end
 * `perDay` events. `days` er [{ label, events }].
 */
export function judgeStopRule(days, perDay = STOP_RULE_PER_DAY) {
  const breached = days.filter((d) => d.events >= perDay);
  const total = days.reduce((sum, d) => sum + d.events, 0);
  const max = days.reduce((m, d) => Math.max(m, d.events), 0);
  return { holds: breached.length === 0, breached, total, max, perDay, days: days.length };
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").slice(0, 48);
}

export function renderMarkdown({ releases, days, verdict }) {
  const lines = [];
  lines.push(`### Chunk-fejl pr. release, seneste ${verdict.days * 24} t (#5162)`);
  lines.push("");
  if (releases.length) {
    lines.push("| Release | Events | Spillere |");
    lines.push("|---|---:|---:|");
    for (const row of releases.slice(0, MAX_RELEASE_ROWS)) {
      lines.push(`| \`${cell(row.release)}\` | ${row.events} | ${row.users} |`);
    }
    if (releases.length > MAX_RELEASE_ROWS) lines.push(`| ... ${releases.length - MAX_RELEASE_ROWS} flere | | |`);
  } else {
    lines.push("Ingen chunk-fejl i vinduet.");
  }
  lines.push("");
  lines.push("| Døgn | Events |");
  lines.push("|---|---:|");
  for (const d of days) lines.push(`| ${d.label} | ${d.events} |`);
  lines.push("");
  if (verdict.holds) {
    lines.push(`✅ **Stopreglen holder:** under ${verdict.perDay} chunk-fejl i hvert af de seneste ${verdict.days} døgn (højst ${verdict.max}, i alt ${verdict.total}).`);
  } else {
    const which = verdict.breached.map((d) => `${d.label}: ${d.events}`).join(", ");
    lines.push(`⚠️ **Stopreglen brudt:** ${verdict.breached.length} af ${verdict.days} døgn har ${verdict.perDay} eller flere chunk-fejl (${which}). ADVISORY: stopper ikke kørslen; rapporten går til ejeren (#5162).`);
  }
  lines.push("");
  lines.push("_Gælder fra det andet prod-deploy med carry-forward; før det måler tallet den gamle adfærd._");
  return lines.join("\n");
}

async function getJson(fetchImpl, url, token) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  } catch (err) {
    throw new Error(`netværksfejl mod Sentry: ${err?.message || err}`);
  }
  if (!res.ok) throw new Error(`Sentry events-API svarede ${res.status}`);
  return res.json();
}

/**
 * Hele rapporten. Returnerer { status: "skipped" | "error" | "ok", markdown?, verdict? }.
 * Kaster aldrig.
 */
export async function runReport({ env = process.env, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const config = resolveConfig(env);
  if (config.skip) {
    return { status: "skipped", markdown: `⏭️ **Chunk-fejl pr. release: SPRUNGET OVER** — ${config.skip}.` };
  }
  try {
    const releaseBody = await getJson(
      fetchImpl,
      buildEventsUrl(config, {
        fields: ["release", "count()", "count_unique(user)"],
        window: { statsPeriod: `${WINDOW_DAYS * 24}h` },
        sort: "-count()",
        perPage: 50,
      }),
      config.token,
    );
    const releases = parseReleaseRows(releaseBody);
    const days = [];
    for (const window of buildDailyWindows(now)) {
      const body = await getJson(fetchImpl, buildEventsUrl(config, { fields: ["count()"], window }), config.token);
      days.push({ label: window.label, events: parseCount(body) });
    }
    const verdict = judgeStopRule(days);
    return { status: "ok", releases, days, verdict, markdown: renderMarkdown({ releases, days, verdict }) };
  } catch (err) {
    return { status: "error", markdown: `⚠️ **Chunk-fejl pr. release: kunne ikke hentes** — ${err.message}. Advisory, intet stoppet.` };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await runReport();
  if (args.json) {
    console.log(JSON.stringify({ status: result.status, releases: result.releases, days: result.days, verdict: result.verdict }, null, 2));
  } else {
    console.log(result.markdown);
  }
  if (result.status === "error") console.log(`::warning::${result.markdown.replace(/\*\*/g, "")}`);
  if (result.verdict && !result.verdict.holds) console.log("::warning::Stopreglen for chunk-fejl (#5162) er brudt — se rapporten. Advisory.");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      fs.appendFileSync(summary, `${result.markdown}\n`);
    } catch (err) {
      console.log(`Kunne ikke skrive til GITHUB_STEP_SUMMARY: ${err.message}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Advisory: exit 0 uanset hvad (#5162). En fejl her må aldrig stoppe deploy-verify.
  main().catch((err) => {
    console.log(`Chunk-fejl pr. release kunne ikke køre: ${err?.message || err} (advisory, exit 0)`);
  }).finally(() => {
    process.exitCode = 0;
  });
}
