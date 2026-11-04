#!/usr/bin/env node
/**
 * Cycling Zone - databasevagt (#5878, variant A: probe + alarm, ingen auto-genstart)
 * ===================================================================================
 * 6/10-2026 frøs databasen i 21 min uden at nogen opdagede det før ejeren selv.
 * Eksisterende vagter kører ugentligt (db-health) og dagligt (supabase-log-watch).
 * Dette script kører hvert 5. minut fra GitHub Actions (uden for Railway og
 * Supabase, så det også opdager "Railway nede") og gør tre ting:
 *
 *   1. Probe: backend-readiness, PostgREST direkte og pg_postmaster_start_time().
 *   2. Alarmregel: 2 fejlede målinger i træk (op til 3 pr. kørsel, #6854) -> én Discord-ops-besked; når alt er
 *      grønt igen -> én "oppe igen"-besked med varighed. Ingen gentagne alarmer
 *      mens nedetiden varer.
 *   3. Genstart-markør: ændres pg_postmaster_start_time, sendes én besked med
 *      gammel og ny starttid, også selvom alt er grønt nu.
 *
 *   4. (#7662) Stigende 5xx på Supabase-API'et: andelen af 5xx i de seneste
 *      minutter sammenlignes med et glidende normalniveau. Kræver
 *      SUPABASE_ACCESS_TOKEN; uden token springes reglen over.
 *   5. (#7662) Gentagne langsomme forespørgsler: pg_stat_statements-tællere
 *      sammenlignes med forrige kørsel, så kun forespørgsler der FAKTISK blev
 *      kaldt langsomt siden sidst melder sig. Én besked pr. forespørgsel pr.
 *      nedkølingsperiode.
 *
 * Første kørsel (ingen tilstand) lægger kun baseline: ingen falsk alarm.
 *
 * Tilstand (antal fejl i træk, alarm aktiv, sidste postmaster-start, 5xx-niveau,
 * pg_stat_statements-snapshot) ligger i en lille JSON-fil som workflowet gemmer i
 * Actions-cache med en artefakt som sikkerhedsnet (#7662: cachen mistede
 * tilstanden i 13 af 30 kørsler). Aldrig i prod-databasen, fordi den skal kunne
 * læses mens databasen er nede.
 *
 * Vagten belaster ikke databasen: ét HEAD-kald (limit 1) og ét skalar-select.
 * Ingen secret-værdier printes. psql-stderr printes aldrig (kan indeholde host).
 *
 * Env (påkrævet; mangler en, fejler scriptet tydeligt UDEN at alarmere):
 *   SUPABASE_URL                 projekt-URL (findes som GitHub-secret)
 *   SUPABASE_PUBLISHABLE_KEY     publishable/anon-nøglen (offentlig, men skal oprettes som secret)
 *   SUPABASE_DB_URL              Postgres-connection-string (findes som GitHub-secret)
 *   DISCORD_OPS_WEBHOOK_URL      ops-kanalens webhook (skal oprettes som secret)
 * Env (valgfri):
 *   DISCORD_OPS_MENTION          @mention-streng, se backend/lib/opsWebhook.js
 *   SENTRY_DSN                   giver Sentry Cron Monitor check-in pr. kørsel
 *   SUPABASE_ACCESS_TOKEN        aktiverer 5xx-reglen (samme secret som supabase-log-watch)
 *   SUPABASE_PROJECT_REF         default ghwvkxzhsbbltzfnuhhz
 *   DB_WATCHDOG_BACKEND_URL      default https://cyclingzone-production.up.railway.app
 *   DB_WATCHDOG_STATE            tilstandsfil, default .db-watchdog-state/state.json
 *   DB_WATCHDOG_SENTRY_SLUG      default db-watchdog
 *
 * Exit: 0 = kørte (uanset om databasen er oppe) · 1 = config-fejl.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getOpsMention, withOpsMention } from "../../backend/lib/opsWebhook.js";

const execFileAsync = promisify(execFile);

export const ALERT_AFTER_FAILURES = 2;
// #6854: målinger pr. kørsel ved fejl (bekræftelse uden at vente på næste kørsel).
export const CONFIRM_ROUNDS = 3;
export const CONFIRM_DELAY_MS = 30_000;
export const HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_BACKEND_URL = "https://cyclingzone-production.up.railway.app";
export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_DB_URL",
  "DISCORD_OPS_WEBHOOK_URL",
];

// #7662: en genstart der er yngre end dette alarmeres selv uden baseline
// (tilstanden kan være tabt); en ældre starttid uden baseline er blot baseline.
export const FRESH_RESTART_MS = 15 * 60_000;
// 5xx-regel: vindue, mindste antal fejl, gulv for fejlandel og faktor over normalen.
export const API_5XX_WINDOW_MS = 15 * 60_000;
export const API_5XX_MIN_COUNT = 10;
export const API_5XX_MIN_RATE = 0.05;
export const API_5XX_BASELINE_FACTOR = 3;
export const API_5XX_BASELINE_WEIGHT = 0.2;
// Langsom-forespørgsel-regel: mindst så mange kald siden sidst, med gennemsnitstid
// over grænsen, og højst én besked pr. forespørgsel pr. nedkølingsperiode.
export const SLOW_MIN_CALLS = 3;
export const SLOW_MEAN_MS = 1000;
export const SLOW_COOLDOWN_MS = 6 * 3_600_000;
export const SLOW_MAX_LISTED = 5;
export const SLOW_FETCH_LIMIT = 500;
export const DEFAULT_PROJECT_REF = "ghwvkxzhsbbltzfnuhhz";

const COLOR_DOWN = 0xe74c3c;
const COLOR_UP = 0x2ecc71;
const COLOR_RESTART = 0xe67e22;
const COLOR_WARN = 0xf1c40f;

function isMain() {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tilstand + alarmregel (REN)
// ---------------------------------------------------------------------------

export function emptyState() {
  return {
    consecutiveFailures: 0,
    firstFailureAt: null,
    alertActive: false,
    lastPostmasterStart: null,
    api5xxActive: false,
    api5xxBaselineRate: null,
    slowSnapshot: null,
    slowAlertedAt: {},
    pendingRestartStart: null,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Tåler manglende/ødelagt fil: starter blot forfra. */
export function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  return {
    consecutiveFailures: Number.isInteger(raw.consecutiveFailures) && raw.consecutiveFailures > 0 ? raw.consecutiveFailures : 0,
    firstFailureAt: typeof raw.firstFailureAt === "string" ? raw.firstFailureAt : null,
    alertActive: raw.alertActive === true,
    lastPostmasterStart: typeof raw.lastPostmasterStart === "string" ? raw.lastPostmasterStart : null,
    api5xxActive: raw.api5xxActive === true,
    api5xxBaselineRate:
      typeof raw.api5xxBaselineRate === "number" && Number.isFinite(raw.api5xxBaselineRate) && raw.api5xxBaselineRate >= 0
        ? raw.api5xxBaselineRate
        : null,
    slowSnapshot: isPlainObject(raw.slowSnapshot) ? raw.slowSnapshot : null,
    slowAlertedAt: isPlainObject(raw.slowAlertedAt) ? raw.slowAlertedAt : {},
    pendingRestartStart: typeof raw.pendingRestartStart === "string" ? raw.pendingRestartStart : null,
  };
}

/**
 * Samler tre check-resultater til én kørsel. En kørsel er fejlet hvis ET af
 * checkene fejlede (databasens direkte forbindelse tæller med, for en DB der
 * ikke tager imod forbindelser er et reelt symptom).
 * checks: { backend, postgrest, postmaster } hver { ok, detail, startTime? }
 */
export function runFailed(checks) {
  return !(checks.backend.ok && checks.postgrest.ok && checks.postmaster.ok);
}

/**
 * Alarmregel. REN: (forrige tilstand, check-resultater, nu) -> ny tilstand + beskeder.
 * Beskeder: { kind: 'down' | 'recovered' | 'restart', ... }.
 */
export function evaluate(prevInput, checks, nowIso) {
  const prev = normalizeState(prevInput);
  const next = { ...prev };
  const messages = [];
  const failed = runFailed(checks);

  if (failed) {
    next.consecutiveFailures = prev.consecutiveFailures + 1;
    next.firstFailureAt = prev.firstFailureAt ?? nowIso;
    if (next.consecutiveFailures >= ALERT_AFTER_FAILURES && !prev.alertActive) {
      next.alertActive = true;
      messages.push({
        kind: "down",
        since: next.firstFailureAt,
        failures: next.consecutiveFailures,
        checks,
      });
    }
  } else {
    if (prev.alertActive) {
      messages.push({
        kind: "recovered",
        since: prev.firstFailureAt,
        until: nowIso,
        checks,
      });
    }
    next.consecutiveFailures = 0;
    next.firstFailureAt = null;
    next.alertActive = false;
  }

  // Genstart-markør: kun når vi faktisk fik en starttid. Første kørsel (ingen
  // tidligere værdi) registrerer blot baseline, medmindre starten er helt frisk
  // (#7662: så en tabt tilstand ikke skjuler en genstart lige før kørslen).
  const start = checks.postmaster.ok ? checks.postmaster.startTime ?? null : null;
  if (start) {
    const changed = prev.lastPostmasterStart && prev.lastPostmasterStart !== start;
    const ageMs = new Date(nowIso).getTime() - new Date(start).getTime();
    // En frisk-genstart-besked der ikke kunne sendes huskes (pendingRestartStart), så
    // den prøves igen selv efter at starten er blevet ældre end vinduet.
    const freshWithoutBaseline =
      !prev.lastPostmasterStart &&
      ((ageMs >= 0 && ageMs <= FRESH_RESTART_MS) || prev.pendingRestartStart === start);
    next.pendingRestartStart = null;
    if (changed || freshWithoutBaseline) {
      messages.push({
        kind: "restart",
        previousStart: prev.lastPostmasterStart,
        newStart: start,
        healthyNow: !failed,
      });
      // Tællerne i pg_stat_statements nulstilles ved genstart: start snapshot forfra.
      next.slowSnapshot = null;
    }
    next.lastPostmasterStart = start;
  }

  return { state: next, messages };
}

/**
 * Hvis en besked ikke kunne sendes, rulles den relevante del af tilstanden
 * tilbage, så næste kørsel prøver igen i stedet for at miste alarmen.
 */
export function rollbackUnsent(nextState, prevInput, message) {
  const prev = normalizeState(prevInput);
  const state = { ...nextState };
  if (message.kind === "down") state.alertActive = false;
  if (message.kind === "recovered") {
    state.alertActive = true;
    state.firstFailureAt = prev.firstFailureAt;
  }
  if (message.kind === "restart") {
    state.lastPostmasterStart = prev.lastPostmasterStart;
    if (!prev.lastPostmasterStart) state.pendingRestartStart = message.newStart;
  }
  if (message.kind === "api5xx") state.api5xxActive = false;
  if (message.kind === "slow") {
    state.slowAlertedAt = { ...state.slowAlertedAt };
    state.slowSnapshot = state.slowSnapshot ? { ...state.slowSnapshot } : state.slowSnapshot;
    for (const item of message.items) {
      // Behold forrige tællerstand, så forskellen stadig kan måles næste kørsel.
      if (state.slowSnapshot) {
        if (prev.slowSnapshot?.[item.id]) state.slowSnapshot[item.id] = prev.slowSnapshot[item.id];
        else delete state.slowSnapshot[item.id];
      }
      if (prev.slowAlertedAt[item.id] === undefined) delete state.slowAlertedAt[item.id];
      else state.slowAlertedAt[item.id] = prev.slowAlertedAt[item.id];
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// 5xx-regel (REN)
// ---------------------------------------------------------------------------

/**
 * sample: { errors, total } for de seneste minutter, eller null hvis målingen
 * ikke kunne hentes (så ændres intet). Første måling lægger kun baseline.
 * Alarmen kræver både et mindsteantal fejl og en fejlandel over både et gulv og
 * et multiplum af det glidende normalniveau. Normalniveauet opdateres kun mens
 * alt er roligt, så et udfald ikke bliver det nye normale.
 */
export function evaluateApi5xx(prevInput, sample, nowIso) {
  const prev = normalizeState(prevInput);
  const next = { ...prev };
  const messages = [];
  if (!sample) return { state: next, messages };

  const rate = sample.total > 0 ? sample.errors / sample.total : 0;
  if (prev.api5xxBaselineRate === null) {
    next.api5xxBaselineRate = rate;
    return { state: next, messages };
  }

  const limit = Math.max(API_5XX_MIN_RATE, prev.api5xxBaselineRate * API_5XX_BASELINE_FACTOR);
  const spike = sample.errors >= API_5XX_MIN_COUNT && rate >= limit;
  if (spike) {
    if (!prev.api5xxActive) {
      messages.push({
        kind: "api5xx",
        errors: sample.errors,
        total: sample.total,
        rate,
        baselineRate: prev.api5xxBaselineRate,
        at: nowIso,
      });
    }
    next.api5xxActive = true;
  } else {
    next.api5xxActive = false;
    next.api5xxBaselineRate =
      prev.api5xxBaselineRate * (1 - API_5XX_BASELINE_WEIGHT) + rate * API_5XX_BASELINE_WEIGHT;
  }
  return { state: next, messages };
}

// ---------------------------------------------------------------------------
// Langsom-forespørgsel-regel (REN)
// ---------------------------------------------------------------------------

/**
 * rows: [{ id, calls, totalMs, query }] fra pg_stat_statements, eller null hvis
 * hentningen fejlede (så ændres intet). Sammenligner med forrige snapshot, så
 * gamle akkumulerede tal aldrig alarmerer; første kørsel og nulstillede tællere
 * (genstart) lægger kun baseline for den forespørgsel.
 */
export function evaluateSlowQueries(prevInput, rows, nowIso) {
  const prev = normalizeState(prevInput);
  const next = { ...prev };
  const messages = [];
  if (!Array.isArray(rows)) return { state: next, messages };

  const nowMs = new Date(nowIso).getTime();
  const snapshot = {};
  for (const row of rows) snapshot[row.id] = { calls: row.calls, totalMs: row.totalMs };
  next.slowSnapshot = snapshot;

  // Ryd udløbne nedkølinger.
  const alerted = {};
  for (const [id, iso] of Object.entries(prev.slowAlertedAt)) {
    const age = nowMs - new Date(iso).getTime();
    if (Number.isFinite(age) && age < SLOW_COOLDOWN_MS) alerted[id] = iso;
  }
  next.slowAlertedAt = alerted;

  if (!prev.slowSnapshot) return { state: next, messages };

  const snapshotComplete = Object.keys(prev.slowSnapshot).length < SLOW_FETCH_LIMIT;
  const items = [];
  for (const row of rows) {
    // En forespørgsel der ikke var i forrige (komplette) snapshot er oprettet siden da,
    // så alle dens tællere er målt i dette interval. Var snapshot'et afkortet, ved vi det ikke.
    const before = prev.slowSnapshot[row.id] ?? (snapshotComplete ? { calls: 0, totalMs: 0 } : null);
    if (!before) continue;
    const dCalls = row.calls - before.calls;
    const dTotal = row.totalMs - before.totalMs;
    if (dCalls < 0 || dTotal < 0) continue; // tællere nulstillet
    if (dCalls < SLOW_MIN_CALLS) continue;
    const meanMs = dTotal / dCalls;
    if (meanMs < SLOW_MEAN_MS) continue;
    if (alerted[row.id] !== undefined) continue;
    items.push({ id: row.id, query: row.query, calls: dCalls, meanMs: Math.round(meanMs) });
  }
  if (items.length) {
    items.sort((a, b) => b.meanMs - a.meanMs);
    const listed = items.slice(0, SLOW_MAX_LISTED);
    for (const item of listed) next.slowAlertedAt[item.id] = nowIso;
    messages.push({ kind: "slow", items: listed, omitted: items.length - listed.length, at: nowIso });
  }
  return { state: next, messages };
}

// ---------------------------------------------------------------------------
// Beskeder (REN)
// ---------------------------------------------------------------------------

export function formatCopenhagen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatDuration(fromIso, toIso) {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "ukendt varighed";
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `ca. ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `ca. ${h} t ${m} min` : `ca. ${h} t`;
}

function formatPercent(rate) {
  return `${(rate * 100).toFixed(1)} %`;
}

function checkLine(label, check) {
  return `${check.ok ? "OK" : "FEJL"}  ${label}: ${check.detail}`;
}

export function diagnose(checks) {
  const { backend, postgrest, postmaster } = checks;
  if (!postgrest.ok && !backend.ok) return "PostgREST og backend svarer ikke. Sandsynligvis databasen (eller Supabase-platformen).";
  if (!postgrest.ok) return "PostgREST svarer ikke, men backenden gør. Tjek Supabase.";
  if (!backend.ok && postgrest.ok) return "Backenden svarer ikke, men PostgREST gør. Sandsynligvis Railway (deploy eller crash), ikke databasen.";
  if (!postmaster.ok) return "Direkte Postgres-forbindelse fejler, men PostgREST svarer. Tjek forbindelsesgrænse og pooler.";
  return "";
}

function checksText(checks) {
  return [
    checkLine("Backend /health/ready", checks.backend),
    checkLine("PostgREST (HEAD app_config)", checks.postgrest),
    checkLine("Postgres direkte (pg_postmaster_start_time)", checks.postmaster),
  ].join("\n");
}

/** REN: besked -> Discord-payload (uden mention). */
export function buildEmbed(message, { runUrl = "" } = {}) {
  const link = runUrl ? `\n[Kørsel](${runUrl})` : "";
  if (message.kind === "down") {
    const diagnosis = diagnose(message.checks);
    return {
      embeds: [
        {
          title: "Databasevagt: svarer ikke",
          description:
            `${message.failures} målinger i træk fejlet, siden ca. ${formatCopenhagen(message.since)} (dansk tid).` +
            `${diagnosis ? `\n${diagnosis}` : ""}\n\`\`\`\n${checksText(message.checks)}\n\`\`\`${link}`,
          color: COLOR_DOWN,
          timestamp: message.checks.checkedAt ?? undefined,
        },
      ],
    };
  }
  if (message.kind === "recovered") {
    return {
      embeds: [
        {
          title: "Databasevagt: oppe igen",
          description:
            `Alle tre checks er grønne igen. Nede i ${formatDuration(message.since, message.until)} ` +
            `(siden ca. ${formatCopenhagen(message.since)}, dansk tid).${link}`,
          color: COLOR_UP,
          timestamp: message.until,
        },
      ],
    };
  }
  if (message.kind === "api5xx") {
    return {
      embeds: [
        {
          title: "Databasevagt: 5xx-fejl stiger på Supabase-API'et",
          description:
            `${message.errors} af ${message.total} kald de seneste ${API_5XX_WINDOW_MS / 60_000} min gav 5xx ` +
            `(${formatPercent(message.rate)}). Normalt: ${formatPercent(message.baselineRate)}.\n` +
            `Tjek Supabase status og logs (API Gateway).${link}`,
          color: COLOR_DOWN,
          timestamp: message.at,
        },
      ],
    };
  }
  if (message.kind === "slow") {
    const lines = message.items
      .map((i) => `${i.meanMs} ms i snit, ${i.calls} kald: ${i.query}`)
      .join("\n");
    return {
      embeds: [
        {
          title: "Databasevagt: langsomme forespørgsler gentager sig",
          description:
            `Kaldt mindst ${SLOW_MIN_CALLS} gange siden forrige kørsel med gennemsnitstid over grænsen.\n` +
            `\`\`\`\n${lines}\n\`\`\`` +
            (message.omitted > 0 ? `\n+ ${message.omitted} flere` : "") +
            link,
          color: COLOR_WARN,
          timestamp: message.at,
        },
      ],
    };
  }
  const before = message.previousStart
    ? `Før: ${formatCopenhagen(message.previousStart)} (dansk tid)\n`
    : "Før: ukendt (vagtens tilstand var tabt)\n";
  return {
    embeds: [
      {
        title: "Databasevagt: Postgres er genstartet",
        description:
          before +
          `Nu: ${formatCopenhagen(message.newStart)} (dansk tid)\n` +
          (message.healthyNow
            ? "Alle checks er grønne nu."
            : "Nogle checks fejler stadig, se evt. fejlalarm.") +
          link,
        color: COLOR_RESTART,
      },
    ],
  };
}

/** @mention på nedetid, genstart og 5xx-stigning; "oppe igen" og langsomme forespørgsler er rolige. */
export function buildPayload(message, { runUrl = "", mention = getOpsMention() } = {}) {
  const embed = buildEmbed(message, { runUrl });
  return PING_KINDS.has(message.kind) ? withOpsMention(embed, mention) : embed;
}

const PING_KINDS = new Set(["down", "restart", "api5xx"]);

// ---------------------------------------------------------------------------
// Checks (IO injiceret så de kan testes)
// ---------------------------------------------------------------------------

function describeError(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `timeout efter ${HTTP_TIMEOUT_MS / 1000} s`;
  return `netværksfejl (${err?.cause?.code ?? err?.code ?? err?.name ?? "ukendt"})`;
}

export async function checkBackend(fetchFn, baseUrl) {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/health/ready`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return res.status === 200 ? { ok: true, detail: "HTTP 200" } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: describeError(err) };
  }
}

export async function checkPostgrest(fetchFn, supabaseUrl, publishableKey) {
  try {
    const res = await fetchFn(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/app_config?select=key&limit=1`, {
      method: "HEAD",
      // Kun apikey: sb_publishable_-nøgler er ikke JWT'er og må ikke sendes som Bearer.
      headers: { apikey: publishableKey },
      redirect: "error",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return res.status >= 200 && res.status < 300
      ? { ok: true, detail: `HTTP ${res.status}` }
      : { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: describeError(err) };
  }
}

const START_TIME_SQL =
  `select to_char(pg_postmaster_start_time() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const ISO_SECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** REN: psql-fejl -> grov klasse uden at afsløre host/URL. */
export function classifyPsqlFailure(err) {
  const text = `${err?.stderr ?? ""}`;
  if (err?.code === "ENOENT") return "psql ikke fundet";
  if (err?.killed || err?.signal) return "psql-timeout";
  if (/statement timeout/i.test(text)) return "statement timeout (5 s)";
  if (/timeout expired|timed out/i.test(text)) return "connect timeout (5 s)";
  if (/too many connections|remaining connection slots/i.test(text)) return "for mange forbindelser";
  if (/password authentication failed/i.test(text)) return "login afvist";
  if (/could not connect|connection refused|could not translate host/i.test(text)) return "forbindelse afvist";
  return "forbindelsesfejl";
}

export async function checkPostmaster(execFn, dbUrl) {
  try {
    const { stdout } = await execFn(
      "psql",
      [dbUrl, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", START_TIME_SQL],
      {
        timeout: 15_000,
        env: { ...process.env, PGCONNECT_TIMEOUT: "5", PGOPTIONS: "-c statement_timeout=5s" },
      }
    );
    const startTime = String(stdout).trim();
    if (!ISO_SECONDS_RE.test(startTime)) return { ok: false, detail: "uventet svar fra Postgres" };
    return { ok: true, detail: `oppe siden ${startTime}`, startTime };
  } catch (err) {
    return { ok: false, detail: classifyPsqlFailure(err) };
  }
}

// ---------------------------------------------------------------------------
// 5xx-måling (Management-API logquery, samme endpoint som supabase-log-watch)
// ---------------------------------------------------------------------------

export const API_5XX_SQL = `
select
  countIf(toInt32OrZero(log_attributes['response.status_code']) >= 500) as errors,
  count() as total
from logs
where source = 'edge_logs'
`.trim();

function toCount(value) {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Returnerer { errors, total } eller null (med årsag i `reason`), aldrig et kast. */
export async function fetchApi5xxSample(fetchFn, token, ref, nowDate) {
  try {
    const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs`);
    url.searchParams.set("sql", API_5XX_SQL);
    url.searchParams.set("iso_timestamp_start", new Date(nowDate.getTime() - API_5XX_WINDOW_MS).toISOString());
    url.searchParams.set("iso_timestamp_end", nowDate.toISOString());
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { sample: null, reason: `Management-API HTTP ${res.status}` };
    const body = await res.json();
    if (!body || body.error != null || !Array.isArray(body.result)) {
      return { sample: null, reason: "uventet svar fra Management-API" };
    }
    const row = body.result[0];
    const errors = toCount(row?.errors ?? 0);
    const total = toCount(row?.total ?? 0);
    if (errors === null || total === null) return { sample: null, reason: "ugyldig tæller fra Management-API" };
    return { sample: { errors, total }, reason: "" };
  } catch (err) {
    return { sample: null, reason: describeError(err) };
  }
}

// ---------------------------------------------------------------------------
// Langsomme forespørgsler (pg_stat_statements, kun læsning)
// ---------------------------------------------------------------------------

// Intern støj og bevidste vedligeholdelseskommandoer ekskluderes (samme idé som scripts/db-health.sql).
export const SLOW_SQL =
  "select coalesce(json_agg(t), '[]'::json) from (" +
  "select queryid::text as id, sum(calls)::bigint as calls, round(sum(total_exec_time))::bigint as total_ms, " +
  "left(regexp_replace(max(query), '\\s+', ' ', 'g'), 80) as query " +
  "from pg_stat_statements " +
  "where calls > 0 and queryid is not null " +
  "and query !~* '(pg_stat_statements|pg_proc|information_schema|pg_catalog|pg_class|pg_attribute|pg_namespace)' " +
  "and query !~* '^\\s*(VACUUM|REINDEX|CLUSTER|ANALYZE|COPY|CREATE|ALTER)' " +
  // Samme queryid kan optræde pr. bruger/database: tællerne lægges sammen, så
  // snapshot-nøglen er stabil. Bred grænse, så nye regressioner ikke falder uden for listen.
  `group by queryid order by sum(total_exec_time) desc limit ${SLOW_FETCH_LIMIT}) t`;

/** Returnerer { rows, reason }; rows er null ved fejl. Printer aldrig URL eller stderr. */
export async function fetchSlowStatements(execFn, dbUrl) {
  try {
    const { stdout } = await execFn(
      "psql",
      [dbUrl, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", SLOW_SQL],
      {
        timeout: 15_000,
        env: { ...process.env, PGCONNECT_TIMEOUT: "5", PGOPTIONS: "-c statement_timeout=5s" },
      }
    );
    const parsed = JSON.parse(String(stdout).trim());
    if (!Array.isArray(parsed)) return { rows: null, reason: "uventet svar fra pg_stat_statements" };
    const rows = [];
    for (const r of parsed) {
      const calls = toCount(typeof r?.calls === "number" ? r.calls : Number(r?.calls));
      const totalMs = toCount(typeof r?.total_ms === "number" ? r.total_ms : Number(r?.total_ms));
      if (typeof r?.id !== "string" || !r.id || calls === null || totalMs === null) continue;
      rows.push({ id: r.id, calls, totalMs, query: typeof r.query === "string" ? r.query : "" });
    }
    return { rows, reason: "" };
  } catch (err) {
    if (err instanceof SyntaxError) return { rows: null, reason: "uventet svar fra pg_stat_statements" };
    return { rows: null, reason: classifyPsqlFailure(err) };
  }
}

// ---------------------------------------------------------------------------
// Sentry Cron Monitor (valgfri)
// ---------------------------------------------------------------------------

/** REN: DSN -> check-in-URL, eller null hvis DSN ikke kan læses. */
export function sentryCheckinUrl(dsn, slug = "db-watchdog", status = "ok") {
  try {
    const u = new URL(dsn);
    const key = u.username;
    const projectId = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!key || !projectId) return null;
    return `${u.protocol}//${u.host}/api/${projectId}/cron/${encodeURIComponent(slug)}/${key}/?status=${status}&environment=production`;
  } catch {
    return null;
  }
}

async function sentryCheckin(fetchFn, dsn, slug) {
  const url = sentryCheckinUrl(dsn, slug);
  if (!url) return "SENTRY_DSN kunne ikke læses, check-in sprunget over";
  try {
    const res = await fetchFn(url, { method: "POST", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    return res.ok ? "Sentry check-in sendt" : `Sentry check-in afvist (HTTP ${res.status})`;
  } catch (err) {
    return `Sentry check-in fejlede (${describeError(err)})`;
  }
}

// ---------------------------------------------------------------------------
// Tilstandsfil + Discord
// ---------------------------------------------------------------------------

export function readState(file) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return emptyState();
  }
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function missingEnv(env) {
  return REQUIRED_ENV.filter((name) => !String(env[name] ?? "").trim());
}

async function postDiscord(fetchFn, url, payload) {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main({
  env = process.env,
  fetchFn = fetch,
  execFn = execFileAsync,
  now = () => new Date(),
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const missing = missingEnv(env);
  if (missing.length) {
    console.error(
      `::error::Databasevagten mangler: ${missing.join(", ")}. Opret dem som GitHub-secrets (gh secret set <NAVN>). Se scripts/ops/db-watchdog.mjs header. Der er ikke sendt nogen alarm.`
    );
    return 1;
  }

  const stateFile = env.DB_WATCHDOG_STATE || ".db-watchdog-state/state.json";
  const stateExisted = fs.existsSync(stateFile);
  const prevState = readState(stateFile);
  if (!stateExisted) {
    log("::warning::Tilstandsfil mangler (cache og artefakt gav intet): baseline starter forfra");
  }
  const nowIso = now().toISOString();

  // #6854: GitHub kører ofte kun vagten hver 2.-4. time i stedet for hvert 5. min
  // (18/10 så kørslen kl. 07:06 udfaldet, men næste kørsel kom først efter det).
  // En fejl bekræftes derfor i samme kørsel: nye målinger med kort pause, indtil
  // en er grøn, alarmen er sendt, eller CONFIRM_ROUNDS er brugt.
  let state = prevState;
  let checks;
  const messages = [];
  for (let round = 0; round < CONFIRM_ROUNDS; round += 1) {
    if (round > 0) await sleep(CONFIRM_DELAY_MS);
    const checkedAt = round === 0 ? nowIso : now().toISOString();
    const [backend, postgrest, postmaster] = await Promise.all([
      checkBackend(fetchFn, env.DB_WATCHDOG_BACKEND_URL || DEFAULT_BACKEND_URL),
      checkPostgrest(fetchFn, env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
      checkPostmaster(execFn, env.SUPABASE_DB_URL),
    ]);
    checks = { backend, postgrest, postmaster, checkedAt };
    const result = evaluate(state, checks, checkedAt);
    state = result.state;
    messages.push(...result.messages);
    if (!runFailed(checks) || state.alertActive) break;
  }

  // #7662: de to ekstra regler må aldrig fælde kørslen eller selve nedetids-alarmen;
  // kan en måling ikke hentes, logges årsagen og tilstanden røres ikke.
  if (checks.postmaster.ok) {
    const { rows, reason } = await fetchSlowStatements(execFn, env.SUPABASE_DB_URL);
    if (!rows) log(`langsomme forespørgsler: måling sprunget over (${reason})`);
    const slow = evaluateSlowQueries(state, rows, now().toISOString());
    state = slow.state;
    messages.push(...slow.messages);
  }
  if (env.SUPABASE_ACCESS_TOKEN) {
    const { sample, reason } = await fetchApi5xxSample(
      fetchFn, env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF, now()
    );
    if (!sample) log(`5xx-regel: måling sprunget over (${reason})`);
    else log(`5xx seneste ${API_5XX_WINDOW_MS / 60_000} min: ${sample.errors} af ${sample.total}`);
    const api = evaluateApi5xx(state, sample, now().toISOString());
    state = api.state;
    messages.push(...api.messages);
  } else {
    log("::warning::SUPABASE_ACCESS_TOKEN ikke sat: 5xx-reglen er slukket");
  }
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
    ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : "";

  let finalState = state;
  const mention = getOpsMention();
  for (const message of messages) {
    const sent = await postDiscord(fetchFn, env.DISCORD_OPS_WEBHOOK_URL, buildPayload(message, { runUrl, mention }));
    log(`${message.kind}: ${sent ? "sendt til Discord-ops" : "SENDING FEJLEDE (prøver igen næste kørsel)"}`);
    if (!sent) finalState = rollbackUnsent(finalState, prevState, message);
  }

  writeState(stateFile, finalState);

  log(checksText(checks));
  log(`fejl i træk: ${finalState.consecutiveFailures}, alarm aktiv: ${finalState.alertActive}`);

  if (env.SENTRY_DSN) {
    log(await sentryCheckin(fetchFn, env.SENTRY_DSN, env.DB_WATCHDOG_SENTRY_SLUG || "db-watchdog"));
  } else {
    log("::warning::SENTRY_DSN ikke sat: Sentry Cron Monitor check-in sprunget over (opret secret: gh secret set SENTRY_DSN)");
  }
  return 0;
}

if (isMain()) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`::error::Databasevagten crashede: ${err?.name ?? "Error"}`);
      process.exit(1);
    }
  );
}
