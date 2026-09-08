/**
 * Daglig sundhedsrapport for mail-loopet (#2853).
 * ===============================================
 * HVORFOR: mail-loopet kan fejle STILLE paa to maader som ingen eksisterende
 * vagt fanger.
 *   1. Leveringssiden raadner langsomt: bounce-raten kryber op, en klage
 *      lander, afsender-omdoemmet falder — og ingen ser det, fordi hver
 *      enkelt haendelse ser harmloes ud.
 *   2. En sweep finder kandidater og sender til INGEN af dem. Fra email_log's
 *      side ligner det praecis en sweep uden kandidater. Det var netop formen
 *      paa fundet 8/9 (manglende unsub-hemmelighed kastede pr. kandidat, nul
 *      raekker skrevet) — kun Sentry saa det, og kun som en generisk fejl.
 *
 * Rapporten posterer ét kompakt embed til ops-kanalen hver morgen kl. 08 dansk
 * tid. Den @mentioner KUN naar en taerskel er brudt: en daglig ping man altid
 * faar er en ping man holder op med at laese.
 *
 * TAERSKLER (ejer-godkendt 8/9, se evaluateEmailHealthThresholds):
 *   - bounce-rate  > 2 %   (kun ved mindst 10 afsendte — under det er ét
 *                           uheld statistisk stoej, ikke et signal)
 *   - klage-rate   > 0,1 % (samme minimum; det er den graense
 *                           mailbox-udbyderne selv straffer paa)
 *   - doede retries > 0     (en mail er REELT tabt)
 *   - en type der havde kandidater men sendte 0 TO DOEGN i traek
 *
 * EN-GANG-PR.-DAG: cron tikker hver time (samme moenster som race-digesten:
 * et praecist times-vindue kan springes over af en deploy-klynge). Gaten er
 * `copenhagenHour >= 8` PLUS en dags-signatur i den eksisterende
 * ops_alert_state-tabel (opsAlertDedupe.js) — samme dato to gange giver ingen
 * ny besked, uanset hvor mange gange cron tikker.
 *
 * AERLIGHED OM TALLENE: email_log.status er raekkens NUVAERENDE tilstand, ikke
 * dens tilstand da den blev skrevet. En raekke fra i gaar der blev 'delivered'
 * i dag taeller derfor som delivered i gaarsdagens vindue. Det er det rigtige
 * for en leveringsrapport (vi vil vide hvad der skete med de mails), og det er
 * grunden til at "sendt" er defineret som ALLE fire naaede-Resend-statusser og
 * ikke kun bogstavet 'sent'.
 */

import { fetchAllRows } from "./supabasePagination.js";
import { copenhagenDateString, copenhagenHour } from "./copenhagenTime.js";
import { EMAIL_LOOP_TYPE_KEYS } from "./emailLoopFlag.js";
import { SENT_STATUSES } from "./emailService.js";
import { shouldAlertOnChange } from "./opsAlertDedupe.js";
import { postOpsEmbed } from "./emailOpsAlert.js";
import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";
import { captureException } from "./sentry.js";

export const EMAIL_SWEEP_RUNS_TABLE = "email_sweep_runs";
export const EMAIL_HEALTH_HOUR_COPENHAGEN = 8;
export const EMAIL_HEALTH_ALERT_KEY = "email-health-report";

export const BOUNCE_RATE_THRESHOLD = 0.02; // 2 %
export const COMPLAINT_RATE_THRESHOLD = 0.001; // 0,1 %
export const MIN_SENT_FOR_RATE = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const EMAIL_LOOP_TYPES = Object.keys(EMAIL_LOOP_TYPE_KEYS);

/**
 * Skriv én raekke om en sweep-koersel. BEST-EFFORT: kaster aldrig, saa en
 * fejlet log-skrivning ikke vaelter en sweep der ellers gjorde sit arbejde
 * (samme kontrakt som cronHeartbeat.js's recordCronCheckIn). Koersler UDEN
 * kandidater skriver intet — welcome-sweepen tikker hvert 5. minut, og en tom
 * tick har ingen informationsvaerdi.
 */
export async function recordEmailSweepRun({
  supabase,
  emailType,
  stage,
  candidates = 0,
  sent = 0,
  skipped = 0,
  failed = 0,
}) {
  if (!candidates) return { recorded: false };
  try {
    const { error } = await supabase
      .from(EMAIL_SWEEP_RUNS_TABLE)
      .insert({ email_type: emailType, stage, candidates, sent, skipped, failed });
    if (error) {
      console.error(`[email:health] sweep-run-log fejlede (${emailType}):`, normalizeSupabaseErrorMessage(error.message));
      return { recorded: false };
    }
    return { recorded: true };
  } catch (err) {
    console.error(`[email:health] sweep-run-log kastede (${emailType}):`, err?.message || err);
    return { recorded: false };
  }
}

/**
 * REN: taeller email_log-raekker i ét tidsvindue.
 * @param {Array<{status: string, attempts?: number, next_attempt_at?: string|null, created_at: string}>} rows
 * @param {{fromIso: string, toIso?: string|null}} window
 */
export function summarizeEmailLogWindow(rows, { fromIso, toIso = null }) {
  const counts = {
    sent: 0, dryRun: 0, delivered: 0, bounced: 0, complained: 0,
    failedPermanent: 0, failedRetryable: 0, deadRetries: 0,
  };
  for (const row of rows) {
    if (row.created_at < fromIso) continue;
    if (toIso && row.created_at >= toIso) continue;
    if (SENT_STATUSES.includes(row.status)) counts.sent += 1;
    if (row.status === "dry_run") counts.dryRun += 1;
    if (row.status === "delivered") counts.delivered += 1;
    if (row.status === "bounced") counts.bounced += 1;
    if (row.status === "complained") counts.complained += 1;
    if (row.status === "failed") {
      if (row.next_attempt_at) counts.failedRetryable += 1;
      else {
        counts.failedPermanent += 1;
        // attempts > 1 = drainen har proevet igen og opgivet. attempts === 1 er
        // en permanent fejl paa foerste forsoeg (ugyldig adresse/noegle) — den
        // taeller under failedPermanent, ikke som en "doed retry".
        if ((row.attempts ?? 1) > 1) counts.deadRetries += 1;
      }
    }
  }
  return counts;
}

/**
 * REN: kandidater vs. faktisk sendt pr. type i ét vindue.
 * @param {Array<{email_type: string, candidates: number, sent: number, created_at: string}>} runRows
 */
export function summarizeSweepRunsWindow(runRows, { fromIso, toIso = null }) {
  const byType = {};
  for (const type of EMAIL_LOOP_TYPES) byType[type] = { candidates: 0, sent: 0, runs: 0 };
  for (const row of runRows) {
    if (row.created_at < fromIso) continue;
    if (toIso && row.created_at >= toIso) continue;
    if (!byType[row.email_type]) byType[row.email_type] = { candidates: 0, sent: 0, runs: 0 };
    byType[row.email_type].candidates += row.candidates ?? 0;
    byType[row.email_type].sent += row.sent ?? 0;
    byType[row.email_type].runs += 1;
  }
  return byType;
}

/**
 * REN: hvilke taerskler er brudt? Returnerer en liste af menneskelaesbare
 * linjer — tom liste betyder "alt inden for graenserne" (og dermed ingen
 * @mention).
 *
 * @param {object} args
 * @param {ReturnType<typeof summarizeEmailLogWindow>} args.window24h
 * @param {number} args.retryQueue
 * @param {Record<string, {candidates: number, sent: number}>} args.types24h
 * @param {Record<string, {candidates: number, sent: number}>} args.types48h dagen FOER (24-48 t)
 */
export function evaluateEmailHealthThresholds({ window24h, retryQueue = 0, types24h = {}, types48h = {} }) {
  const breaches = [];

  if (window24h.sent >= MIN_SENT_FOR_RATE) {
    const bounceRate = window24h.bounced / window24h.sent;
    if (bounceRate > BOUNCE_RATE_THRESHOLD) {
      breaches.push(
        `Bounce-rate ${(bounceRate * 100).toFixed(1)} % over graensen paa ${(BOUNCE_RATE_THRESHOLD * 100).toFixed(0)} % (${window24h.bounced}/${window24h.sent})`
      );
    }
    const complaintRate = window24h.complained / window24h.sent;
    if (complaintRate > COMPLAINT_RATE_THRESHOLD) {
      breaches.push(
        `Klage-rate ${(complaintRate * 100).toFixed(2)} % over graensen paa ${(COMPLAINT_RATE_THRESHOLD * 100).toFixed(1)} % (${window24h.complained}/${window24h.sent})`
      );
    }
  }

  if (window24h.deadRetries > 0) {
    breaches.push(`${window24h.deadRetries} retry(s) opgivet - mailene naaede aldrig frem`);
  }

  for (const type of Object.keys(types24h)) {
    const today = types24h[type];
    const yesterday = types48h[type];
    const silentToday = (today?.candidates ?? 0) > 0 && (today?.sent ?? 0) === 0;
    const silentYesterday = (yesterday?.candidates ?? 0) > 0 && (yesterday?.sent ?? 0) === 0;
    if (silentToday && silentYesterday) {
      breaches.push(`\`${type}\`: kandidater fundet men 0 sendt to doegn i traek`);
    }
  }

  // Koen i sig selv er ikke en alarm (den toemmes af sig selv), men en koe der
  // ikke kan vaere reel — flere end drainens batch kan naa paa et doegn — er.
  if (retryQueue > 100) breaches.push(`Retry-koen staar paa ${retryQueue} mails`);

  return breaches;
}

/** REN: det daglige embed. Kort, ingen emoji-klynger. */
export function buildHealthReportEmbed({ window24h, window7d, types24h, retryQueue, breaches, now = new Date() }) {
  const rate = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)} %` : "-");
  const typeLines = Object.entries(types24h)
    .map(([type, s]) => `\`${type}\`: ${s.candidates} kandidat(er) -> ${s.sent} sendt`)
    .join("\n");

  return {
    embeds: [
      {
        title: breaches.length ? "Mail-drift: taerskel brudt" : "Mail-drift: daglig rapport",
        description: breaches.length
          ? breaches.map((b) => `- ${b}`).join("\n")
          : "Alle taerskler inden for graenserne.",
        color: breaches.length ? 0xe74c3c : 0x2ecc71,
        fields: [
          {
            name: "Seneste 24 t",
            value:
              `Sendt ${window24h.sent} - dry_run ${window24h.dryRun}\n` +
              `Leveret ${window24h.delivered} (${rate(window24h.delivered, window24h.sent)}) - ` +
              `bounce ${window24h.bounced} (${rate(window24h.bounced, window24h.sent)}) - ` +
              `klager ${window24h.complained}\n` +
              `Fejlet: ${window24h.failedPermanent} permanent, ${window24h.failedRetryable} i retry`,
            inline: false,
          },
          {
            name: "Seneste 7 d",
            value:
              `Sendt ${window7d.sent} - dry_run ${window7d.dryRun} - ` +
              `leveret ${window7d.delivered} - bounce ${window7d.bounced} - klager ${window7d.complained}\n` +
              `Fejlet: ${window7d.failedPermanent} permanent, ${window7d.deadRetries} opgivet`,
            inline: false,
          },
          { name: "Pr. type (24 t)", value: typeLines || "(ingen koersler med kandidater)", inline: false },
          { name: "Retry-koe", value: String(retryQueue), inline: true },
        ],
        timestamp: now.toISOString(),
      },
    ],
  };
}

/**
 * I/O-sweepen. Time-gate + dags-dedupe, saa den reelt koerer én gang dagligt
 * kl. 08 dansk tid uanset cron-kadence og deploy-genstarter.
 */
export async function runEmailHealthReport({
  supabase,
  now = new Date(),
  sendWebhookFn = null,
  getOpsWebhookFn = null,
  captureExceptionFn = captureException,
  hour = EMAIL_HEALTH_HOUR_COPENHAGEN,
} = {}) {
  if (!supabase?.from) throw new Error("runEmailHealthReport: supabase required");

  // `>=` frem for `===`: et praecist times-vindue kan aedes helt af en
  // deploy-klynge (samme rod-aarsag som discordRaceDigestSweep.js's
  // 2026-08-06-kommentar). Dags-signaturen nedenfor holder den paa én om dagen.
  if (copenhagenHour(now) < hour) return { posted: false, skipped: "outside_hour_window" };

  const { alert: isNewDay } = await shouldAlertOnChange({
    supabase,
    alertKey: EMAIL_HEALTH_ALERT_KEY,
    signature: copenhagenDateString(now),
    now,
    captureExceptionFn,
    // Fail-safe-STILLE: kan vi ikke afgoere om rapporten allerede er sendt i
    // dag, tier vi hellere end at sende den to gange (samme valg som
    // cronHeartbeat.js).
    alertOnReadError: false,
  });
  if (!isNewDay) return { posted: false, skipped: "already_reported_today" };

  const weekAgoIso = new Date(now.getTime() - WEEK_MS).toISOString();
  const dayAgoIso = new Date(now.getTime() - DAY_MS).toISOString();
  const twoDaysAgoIso = new Date(now.getTime() - 2 * DAY_MS).toISOString();

  let logRows = [];
  let runRows = [];
  try {
    logRows = await fetchAllRows(() =>
      supabase
        .from("email_log")
        .select("id, email_type, status, attempts, next_attempt_at, created_at")
        .gte("created_at", weekAgoIso)
        .order("created_at")
    );
    // schema-columns-ok: email_sweep_runs oprettes af database/2026-09-08-2853-
    // email-sweep-runs.sql, som anvendes post-merge (#2642-rammer) og derfor
    // endnu ikke staar i database/schema-snapshot.json paa PR-tidspunktet.
    runRows = await fetchAllRows(() =>
      supabase
        .from(EMAIL_SWEEP_RUNS_TABLE)
        .select("email_type, stage, candidates, sent, created_at")
        .gte("created_at", weekAgoIso)
        .order("created_at")
    );
  } catch (err) {
    // Vinduet mellem merge og anvendt migration er reelt (drainen har samme
    // gap, se emailRetrySweep.js's isMissingRetryColumnError): rapporter én
    // gang og lad vaere at poste en rapport bygget paa halve data.
    captureExceptionFn(new Error(`Email-sundhedsrapport: dataudtraek fejlede: ${err?.message || err}`), {
      tags: { cron: "email-health-report" },
    });
    return { posted: false, skipped: "fetch_failed" };
  }

  const window24h = summarizeEmailLogWindow(logRows, { fromIso: dayAgoIso });
  const window7d = summarizeEmailLogWindow(logRows, { fromIso: weekAgoIso });
  const types24h = summarizeSweepRunsWindow(runRows, { fromIso: dayAgoIso });
  const types48h = summarizeSweepRunsWindow(runRows, { fromIso: twoDaysAgoIso, toIso: dayAgoIso });
  const retryQueue = logRows.filter((r) => r.status === "failed" && r.next_attempt_at).length;

  const breaches = evaluateEmailHealthThresholds({ window24h, retryQueue, types24h, types48h });
  const payload = buildHealthReportEmbed({ window24h, window7d, types24h, retryQueue, breaches, now });

  // @mention KUN ved brud — se filhovedet. postOpsEmbed paalaegger mention'en,
  // saa den rene rapport sendes uden. `sendWebhookFn` SKAL derfor vaere den
  // BARE sendWebhook, ikke sendOpsWebhook (som auto-prepender mention'en paa
  // alt) — se emailOpsAlert.js's postOpsEmbed.
  const posted = await postOpsEmbed({
    payload,
    mention: breaches.length > 0,
    sendWebhookFn,
    getOpsWebhookFn,
  });

  return { posted, breaches, window24h, window7d, types24h, retryQueue };
}
