/**
 * Udfalds-alarm i backend-processen (#6854).
 * ==========================================
 * 18/10-2026 var PostgREST nede i ca. 2 t 40 min (05:42-08:20 dansk tid), og
 * ingen alarm nåede ejeren. Databasevagten (scripts/ops/db-watchdog.mjs) så
 * fejlen, men GitHub Actions kørte den kun hver 2.-4. time, og alarmreglen
 * ventede på næste kørsel. Sentry fragmenterede udfaldet i ca. 45 små kort.
 *
 * Denne vagt kører i backend-processen på Railway (pålidelig takt) og prober
 * PostgREST hvert 15. sekund med ét HEAD-kald (limit 1). Over 20 fejlede
 * prober inden for 10 min (ejer-go 18/10) -> én Discord-ops-besked med
 * ejer-@mention (push via Discord-appen). Efter 1 min grønt -> én "oppe
 * igen"-besked med varighed. Ingen gentagne alarmer mens udfaldet varer.
 *
 * Alarmvejen rører aldrig databasen: webhook-URL læses kun fra env
 * (DISCORD_OPS_WEBHOOK_URL, ingen DB-fallback), og en fejlet afsendelse lægges
 * ikke i outbox'en (den ligger i databasen). Fejler afsendelsen, rulles
 * tilstanden tilbage, så næste probe prøver igen.
 *
 * Tilstanden er i hukommelsen. En genstart midt i et udfald nulstiller tælleren,
 * så alarmen kommer senest 20 fejlede prober (5 min) efter boot. Databasevagten
 * uden for Railway dækker "Railway selv er nede".
 */

import { getOpsMention, withOpsMention } from "./opsWebhook.js";

export const OUTAGE_WINDOW_MS = 10 * 60_000;
export const OUTAGE_FAILURE_THRESHOLD = 20; // alarm når fejl i vinduet > 20
export const OUTAGE_PROBE_INTERVAL_MS = 15_000;
export const OUTAGE_RECOVERY_CONSECUTIVE_OK = 5; // 5 prober med 15 s mellemrum spænder 60 s (Codex: 4 var kun 45 s)
export const OUTAGE_PROBE_TIMEOUT_MS = 10_000;

const COLOR_DOWN = 0xe74c3c;
const COLOR_UP = 0x2ecc71;

// ---------------------------------------------------------------------------
// Tilstand + alarmregel (REN)
// ---------------------------------------------------------------------------

export function emptyOutageState() {
  return { failures: [], alertActive: false, since: null, consecutiveOk: 0, lastDetail: null };
}

/**
 * REN: (forrige tilstand, probe-resultat, nu i ms) -> ny tilstand + evt. besked.
 * Besked: { kind: 'down', since, failures, detail } | { kind: 'recovered', since, until }.
 */
export function recordProbe(prev, probe, nowMs) {
  const cutoff = nowMs - OUTAGE_WINDOW_MS;
  const failures = prev.failures.filter((t) => t > cutoff);
  const next = { ...prev, failures };
  let message = null;

  if (!probe.ok) {
    failures.push(nowMs);
    next.consecutiveOk = 0;
    next.lastDetail = probe.detail;
    if (!prev.alertActive && failures.length > OUTAGE_FAILURE_THRESHOLD) {
      next.alertActive = true;
      next.since = failures[0];
      message = { kind: "down", since: failures[0], failures: failures.length, detail: probe.detail };
    }
    return { state: next, message };
  }

  next.consecutiveOk = prev.consecutiveOk + 1;
  if (prev.alertActive && next.consecutiveOk >= OUTAGE_RECOVERY_CONSECUTIVE_OK) {
    message = { kind: "recovered", since: prev.since, until: nowMs };
    next.alertActive = false;
    next.since = null;
    next.failures = [];
  }
  return { state: next, message };
}

/** En besked der ikke kom ud, må ikke tabes: rul den del af tilstanden tilbage. */
export function rollbackUnsent(state, prev, message) {
  if (message.kind === "down") return { ...state, alertActive: false, since: prev.since };
  return { ...state, alertActive: true, since: prev.since, failures: prev.failures };
}

// ---------------------------------------------------------------------------
// Beskeder (REN)
// ---------------------------------------------------------------------------

export function formatCopenhagen(ms) {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function formatDuration(fromMs, toMs) {
  const minutes = Math.max(1, Math.round((toMs - fromMs) / 60_000));
  if (minutes < 60) return `ca. ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `ca. ${h} t ${m} min` : `ca. ${h} t`;
}

/** REN: besked -> Discord-payload. @mention kun på nedetids-alarmen. */
export function buildOutagePayload(message, mention = getOpsMention()) {
  if (message.kind === "down") {
    return withOpsMention(
      {
        embeds: [
          {
            title: "Udfald: PostgREST svarer ikke",
            description:
              `${message.failures} prober fejlede på 10 min, første kl. ${formatCopenhagen(message.since)} (dansk tid).\n` +
              `Spillerne får fejl på de fleste sider. Seneste svar: ${message.detail}.\n` +
              "Tjek Supabase-status og #6184.",
            color: COLOR_DOWN,
            timestamp: new Date(message.since).toISOString(),
          },
        ],
      },
      mention
    );
  }
  return {
    embeds: [
      {
        title: "Udfald: PostgREST oppe igen",
        description:
          `Grønt i 1 min. Nede i ${formatDuration(message.since, message.until)} ` +
          `(fra kl. ${formatCopenhagen(message.since)}, dansk tid).`,
        color: COLOR_UP,
        timestamp: new Date(message.until).toISOString(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// IO (injiceret så det kan testes)
// ---------------------------------------------------------------------------

function describeError(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `timeout efter ${OUTAGE_PROBE_TIMEOUT_MS / 1000} s`;
  return `netværksfejl (${err?.cause?.code ?? err?.code ?? err?.name ?? "ukendt"})`;
}

/**
 * Ét HEAD-kald mod PostgREST. 5xx og netværksfejl/timeout tæller som fejl;
 * 4xx er en konfigurationsfejl, ikke et udfald, og tæller ikke.
 */
export async function probePostgrest(fetchFn, supabaseUrl, apiKey) {
  try {
    const res = await fetchFn(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/app_config?select=key&limit=1`, {
      method: "HEAD",
      headers: { apikey: apiKey },
      redirect: "error",
      signal: AbortSignal.timeout(OUTAGE_PROBE_TIMEOUT_MS),
    });
    return { ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (err) {
    // best-effort: en fejlet probe ER signalet (tælles som udfald), ikke en kodefejl.
    return { ok: false, detail: describeError(err) };
  }
}

async function postDiscord(fetchFn, url, payload) {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OUTAGE_PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    // best-effort: kalderen ruller tilstanden tilbage og prøver igen ved næste probe.
    return false;
  }
}

/**
 * Fabrik til cron-tikket. Holder tilstanden i closure; ét kald = én probe.
 * Mangler env, gør tikket intet (og logger det én gang).
 */
export function createOutageMonitor({
  env = process.env,
  fetchFn = fetch,
  now = () => Date.now(),
  log = console.log,
} = {}) {
  let state = emptyOutageState();
  let warnedMissing = false;
  let inFlight = false;

  return async function outageMonitorTick() {
    // Et tik kan tage op til 20 s (probe + Discord) mod et 15 s-interval. Overlap
    // ville lade to tik læse samme tilstand, så en tilbagerulning kunne tabe fejl.
    if (inFlight) return;
    inFlight = true;
    try {
      await runOnce();
    } finally {
      inFlight = false;
    }
  };

  async function runOnce() {
    const supabaseUrl = String(env.SUPABASE_URL ?? "").trim();
    const apiKey = String(env.SUPABASE_SERVICE_KEY ?? "").trim();
    const webhookUrl = String(env.DISCORD_OPS_WEBHOOK_URL ?? "").trim();
    if (!supabaseUrl || !apiKey || !webhookUrl) {
      if (!warnedMissing) {
        warnedMissing = true;
        console.error("[outage-monitor] mangler SUPABASE_URL, SUPABASE_SERVICE_KEY eller DISCORD_OPS_WEBHOOK_URL: vagten kører ikke");
      }
      return;
    }

    const probe = await probePostgrest(fetchFn, supabaseUrl, apiKey);
    const prev = state;
    const { state: next, message } = recordProbe(prev, probe, now());
    state = next;
    if (!message) return;

    const sent = await postDiscord(fetchFn, webhookUrl, buildOutagePayload(message));
    log(`[outage-monitor] ${message.kind}: ${sent ? "sendt til Discord-ops" : "SENDING FEJLEDE (prøver igen ved næste probe)"}`);
    if (!sent) state = rollbackUnsent(state, prev, message);
  }
}
