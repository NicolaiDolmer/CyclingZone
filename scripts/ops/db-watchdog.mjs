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
 *   2. Alarmregel: 2 fejlede kørsler i træk -> én Discord-ops-besked; når alt er
 *      grønt igen -> én "oppe igen"-besked med varighed. Ingen gentagne alarmer
 *      mens nedetiden varer.
 *   3. Genstart-markør: ændres pg_postmaster_start_time, sendes én besked med
 *      gammel og ny starttid, også selvom alt er grønt nu.
 *
 * Tilstand (antal fejl i træk, alarm aktiv, sidste postmaster-start) ligger i en
 * lille JSON-fil som workflowet gemmer i Actions-cache. Aldrig i prod-databasen,
 * fordi den skal kunne læses mens databasen er nede.
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
export const HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_BACKEND_URL = "https://cyclingzone-production.up.railway.app";
export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_DB_URL",
  "DISCORD_OPS_WEBHOOK_URL",
];

const COLOR_DOWN = 0xe74c3c;
const COLOR_UP = 0x2ecc71;
const COLOR_RESTART = 0xe67e22;

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
  };
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
  // tidligere værdi) registrerer blot baseline.
  const start = checks.postmaster.ok ? checks.postmaster.startTime ?? null : null;
  if (start) {
    if (prev.lastPostmasterStart && prev.lastPostmasterStart !== start) {
      messages.push({
        kind: "restart",
        previousStart: prev.lastPostmasterStart,
        newStart: start,
        healthyNow: !failed,
      });
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
  if (message.kind === "restart") state.lastPostmasterStart = prev.lastPostmasterStart;
  return state;
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
            `${message.failures} kørsler i træk fejlet, siden ca. ${formatCopenhagen(message.since)} (dansk tid).` +
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
  return {
    embeds: [
      {
        title: "Databasevagt: Postgres er genstartet",
        description:
          `Før: ${formatCopenhagen(message.previousStart)} (dansk tid)\n` +
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

/** @mention kun på nedetids-alarmen; "oppe igen" og genstart er rolige. */
export function buildPayload(message, { runUrl = "", mention = getOpsMention() } = {}) {
  const embed = buildEmbed(message, { runUrl });
  return message.kind === "down" ? withOpsMention(embed, mention) : embed;
}

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
} = {}) {
  const missing = missingEnv(env);
  if (missing.length) {
    console.error(
      `::error::Databasevagten mangler: ${missing.join(", ")}. Opret dem som GitHub-secrets (gh secret set <NAVN>). Se scripts/ops/db-watchdog.mjs header. Der er ikke sendt nogen alarm.`
    );
    return 1;
  }

  const stateFile = env.DB_WATCHDOG_STATE || ".db-watchdog-state/state.json";
  const prevState = readState(stateFile);
  const nowIso = now().toISOString();

  const [backend, postgrest, postmaster] = await Promise.all([
    checkBackend(fetchFn, env.DB_WATCHDOG_BACKEND_URL || DEFAULT_BACKEND_URL),
    checkPostgrest(fetchFn, env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
    checkPostmaster(execFn, env.SUPABASE_DB_URL),
  ]);
  const checks = { backend, postgrest, postmaster, checkedAt: nowIso };

  const { state, messages } = evaluate(prevState, checks, nowIso);
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
    log("SENTRY_DSN ikke sat: Sentry Cron Monitor check-in sprunget over");
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
