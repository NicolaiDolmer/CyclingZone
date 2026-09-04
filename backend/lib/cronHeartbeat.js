/**
 * Cycling Zone Manager — Egen cron-heartbeat-vagt (#2892)
 * ==========================================================
 * Sentrys basisplan tillader kun 1 aktiv cron-monitor. cronMonitorRegistry.js
 * (ALL_CRON_MONITORS) registrerer ~40 periodiske jobs til Sentry-heartbeats,
 * men Sentry kan reelt kun holde ét af dem aktivt ad gangen — kvote, ikke en
 * fejl (ejer-beslutning 6/8, "valg A": byg egen vagt, forsøg ikke at
 * genforhandle Sentry-kvoten).
 *
 * Denne fil er den EGNE (Sentry-uafhængige) erstatning:
 *   - recordCronCheckIn: skriver "jeg er i live" til database/2026-08-30-
 *     2892-cron-heartbeat-checkins.sql's cron_checkins-tabel efter et
 *     vellykket tick. Kaldes centralt fra sentry.js' monitorCron via en
 *     injiceret recorder (se setCronHeartbeatRecorder i sentry.js) — IKKE
 *     kopieret ind i hvert af cron.js' ~40 kaldsteder.
 *   - primeCronHeartbeatCheckIns: samme boot-priming-idé som Sentrys
 *     primeCronMonitorCheckIns (#2440) — nulstiller last_checkin_at for ALLE
 *     jobs til "nu" ved hver proces-boot, så en deploy-KLYNGE ikke gør et
 *     stille-dødt job til en falsk alarm midt i en genstarts-storm.
 *   - computeOverdueSlugs / isOverdue: REN beregning (ingen I/O) — kadence +
 *     margin læses fra ALL_CRON_MONITORS (cronMonitorRegistry.js), som
 *     forbliver den ENESTE SSOT for forventet kadence. Ingen ny liste her.
 *   - runCronHeartbeatSweepCron: I/O-sweep — sammenligner check-ins mod
 *     kadence+margin og alarmerer Discord #ops (opsWebhook.js) når et job er
 *     overskredet. Anti-spam: edge-triggered dedup via den allerede
 *     etablerede ops_alert_state-tabel (#2730-mønsteret, samme som
 *     balanceDriftWatch.js/trainingSlotHealthWatch.js) — kun ÉT alarm-kald
 *     pr. ÆNDRING i sættet af overskredne jobs, ikke ét pr. sweep-tick.
 *
 * En fejlende check-in-skrivning må ALDRIG vælte selve cron-jobbet: alle
 * Supabase-kald i denne fil er wrappet i try/catch der logger + captureException'er
 * og derefter fortsætter (aldrig re-throw fra recordCronCheckIn/primeCronHeartbeatCheckIns).
 */

import { ALL_CRON_MONITORS } from "./cronMonitorRegistry.js";
import { withOpsMention } from "./opsWebhook.js";
import { shouldAlertOnChange } from "./opsAlertDedupe.js";

export const CRON_CHECKINS_TABLE = "cron_checkins";
const HEARTBEAT_ALERT_KEY = "cron-heartbeat";

const SECONDS_PER_UNIT = { minute: 60, hour: 3600, day: 86400 };

/** @returns {number} forventet kadence i sekunder, udledt af monitorConfig.schedule. */
export function cadenceSecondsFromConfig(monitorConfig) {
  const { value, unit } = monitorConfig.schedule;
  const perUnit = SECONDS_PER_UNIT[unit];
  if (!perUnit) throw new Error(`cadenceSecondsFromConfig: ukendt schedule-unit "${unit}"`);
  return value * perUnit;
}

// checkinMargin i cronMonitorRegistry.js's CRON_MONITOR_*-configs er ALTID i
// MINUTTER (se fx CRON_MONITOR_5MIN: checkinMargin: 10). Genbruger den
// eksisterende, ejer-tunede værdi i stedet for at opfinde en ny margin-
// konstant — se PR-beskrivelsen for begrundelsen.
export function marginSecondsFromConfig(monitorConfig) {
  return (monitorConfig.checkinMargin ?? 0) * 60;
}

/**
 * REN funktion: er et enkelt job overskredet?
 * @param {object} params
 * @param {string|Date|null} params.lastCheckinAt
 * @param {number} params.cadenceSeconds
 * @param {number} params.marginSeconds
 * @param {Date} [params.now]
 */
export function isOverdue({ lastCheckinAt, cadenceSeconds, marginSeconds, now = new Date() }) {
  if (!lastCheckinAt) return false; // intet check-in endnu — ikke vagtens sag at gætte
  const deadlineMs = new Date(lastCheckinAt).getTime() + (cadenceSeconds + marginSeconds) * 1000;
  return now.getTime() > deadlineMs;
}

/**
 * REN funktion: hvilke jobs (fra ALL_CRON_MONITORS) er overskredet lige nu?
 * @param {object} params
 * @param {[string, object][]} [params.monitors] default ALL_CRON_MONITORS
 * @param {Record<string, {last_checkin_at: string}>} params.checkinsBySlug
 * @param {Date} [params.now]
 * @returns {{slug: string, lastCheckinAt: string, cadenceSeconds: number, marginSeconds: number}[]}
 */
export function computeOverdueSlugs({ monitors = ALL_CRON_MONITORS, checkinsBySlug, now = new Date() }) {
  const overdue = [];
  for (const [slug, config] of monitors) {
    const row = checkinsBySlug[slug];
    // #2892: ingen række endnu (ny slug tilføjet efter migrationen, FØR første
    // boot-prime/tick har nået at skrive) — vent på data, gæt ikke en alarm frem.
    if (!row?.last_checkin_at) continue;
    const cadenceSeconds = cadenceSecondsFromConfig(config);
    const marginSeconds = marginSecondsFromConfig(config);
    if (isOverdue({ lastCheckinAt: row.last_checkin_at, cadenceSeconds, marginSeconds, now })) {
      overdue.push({ slug, lastCheckinAt: row.last_checkin_at, cadenceSeconds, marginSeconds });
    }
  }
  return overdue;
}

/**
 * Skriver/opdaterer ét jobs check-in. Kaldes efter et VELLYKKET tick (se
 * sentry.js' monitorCron, som denne er wired ind i via
 * setCronHeartbeatRecorder). Swallower ALDRIG stille — logger + captureException'er,
 * men re-throw'er aldrig, så en DB-hikke aldrig vælter selve cron-jobbet.
 */
export async function recordCronCheckIn({ supabase, jobSlug, cadenceSeconds, now = new Date(), captureExceptionFn }) {
  try {
    const { error } = await supabase.from(CRON_CHECKINS_TABLE).upsert(
      {
        job_slug: jobSlug,
        last_checkin_at: now.toISOString(),
        expected_cadence_seconds: cadenceSeconds,
        updated_at: now.toISOString(),
      },
      { onConflict: "job_slug" }
    );
    if (error) {
      console.error(`[cronHeartbeat] check-in-skrivning fejlede for "${jobSlug}":`, error.message);
      captureExceptionFn?.(new Error(`cron_checkins upsert (${jobSlug}): ${error.message}`), {
        tags: { cron: "cron-heartbeat" },
      });
    }
  } catch (err) {
    // best-effort — se filens header: en check-in-skrivning må aldrig vælte jobbet.
    console.error(`[cronHeartbeat] check-in kastede for "${jobSlug}":`, err.message);
    captureExceptionFn?.(err, { tags: { cron: "cron-heartbeat" } });
  }
}

/**
 * Boot-priming (mirror af primeCronMonitorCheckIns i cron.js, #2440): sætter
 * last_checkin_at = nu for ALLE ALL_CRON_MONITORS-jobs ved hver proces-boot.
 * Uden dette ville en deploy-KLYNGE (flere Railway-genstarter på kort tid)
 * kunne lade et job stå med et gammelt check-in længe nok til at sweepen
 * fejlagtigt melder det overskredet, selvom processen bare lige er genstartet.
 * Best-effort pr. job — én fejlende upsert stopper ikke de øvrige.
 */
export async function primeCronHeartbeatCheckIns({
  supabase,
  monitors = ALL_CRON_MONITORS,
  now = new Date(),
  captureExceptionFn,
}) {
  for (const [slug, config] of monitors) {
    await recordCronCheckIn({
      supabase,
      jobSlug: slug,
      cadenceSeconds: cadenceSecondsFromConfig(config),
      now,
      captureExceptionFn,
    });
  }
}

function buildOverdueEmbed(overdue, now) {
  const lines = overdue.map(({ slug, lastCheckinAt, cadenceSeconds, marginSeconds }) => {
    const minutesLate = Math.round(
      (now.getTime() - new Date(lastCheckinAt).getTime() - (cadenceSeconds + marginSeconds) * 1000) / 60000
    );
    return `• \`${slug}\` — sidste check-in ${new Date(lastCheckinAt).toISOString()} (${minutesLate} min over margin)`;
  });
  return {
    embeds: [
      {
        title: "⚠️ Cron-heartbeat-vagt: job(s) har misset check-in",
        description:
          "Egen backup for Sentrys cron-monitorer (#2892 — Sentrys basisplan tillader kun 1 aktiv monitor). " +
          "Tjek Railway-logs/deploy-status for de listede jobs.",
        color: 0xe74c3c,
        fields: [{ name: "Overskredne jobs", value: lines.join("\n") || "(ingen)" }],
        timestamp: now.toISOString(),
      },
    ],
  };
}

/**
 * I/O-sweep: hent alle check-ins, find overskredne jobs, alarmér Discord #ops
 * ved ÆNDRING i sættet af overskredne jobs (edge-triggered dedup via den
 * eksisterende ops_alert_state-tabel — #2730-mønsteret). Uændret sæt mellem to
 * sweeps sender IKKE en ny besked; kun når et NYT job bliver overskredet, eller
 * et overskredet job kommer sig igen, ændrer signaturen sig.
 */
export async function runCronHeartbeatSweepCron({
  supabase,
  monitors = ALL_CRON_MONITORS,
  now = new Date(),
  sendWebhookFn,
  getOpsWebhookFn,
  captureExceptionFn,
} = {}) {
  const { data: rows, error: fetchErr } = await supabase
    .from(CRON_CHECKINS_TABLE)
    .select("job_slug, last_checkin_at");
  if (fetchErr) {
    captureExceptionFn?.(new Error(`cron_checkins fetch: ${fetchErr.message}`), {
      tags: { cron: "cron-heartbeat-sweep" },
    });
    return { overdue: [], alerted: false };
  }

  const checkinsBySlug = {};
  for (const row of rows ?? []) checkinsBySlug[row.job_slug] = row;

  const overdue = computeOverdueSlugs({ monitors, checkinsBySlug, now });
  const signature = overdue
    .map((o) => o.slug)
    .sort()
    .join(",");

  // #2738: dedup-read/upsert-dansen flyttet til den delte opsAlertDedupe.js
  // (#4752/#4754). alertOnReadError:false bevarer denne vagts oprindelige
  // fail-safe-STILLE semantik ved en ops_alert_state-læsefejl (kan vi ikke
  // afgøre om sættet er nyt, tier vi hellere end at risikere gen-spam) — det
  // er IKKE hjælperens egen default (fail-open), se opsAlertDedupe.js's header.
  const { alert: changed } = await shouldAlertOnChange({
    supabase,
    alertKey: HEARTBEAT_ALERT_KEY,
    signature,
    now,
    captureExceptionFn,
    alertOnReadError: false,
  });

  // "changed" alene er ikke nok til at sende Discord-besked: en tom overdue-
  // liste (recovery) ÆNDRER signaturen (og skal persisteres), men er ikke i
  // sig selv alarmværdig — samme skel som før migreringen.
  const alerted = overdue.length > 0 && changed;

  if (alerted) {
    const url = getOpsWebhookFn ? await getOpsWebhookFn() : null;
    if (url && sendWebhookFn) {
      await sendWebhookFn(url, withOpsMention(buildOverdueEmbed(overdue, now)));
    }
  }

  return { overdue, alerted };
}
