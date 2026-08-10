/**
 * Discord webhook-outbox — varig levering af kanal-poster (#3545).
 * ================================================================
 * Søstermodul til discordDmOutbox.js (#1115). Samme kontrakt, anden destination:
 * DM'er adresseres på discord_id, kanal-poster på webhook-URL.
 *
 * Rod-årsag (7/8 22:21-22:23): discordWebhookDelivery.js har KUN inline-retry —
 * 4 forsøg med 500/1000/1500ms backoff ≈ 3 sekunders samlet tålmodighed, loftet
 * af MAX_INLINE_RETRY_WAIT_MS så en cron-tick eller HTTP-request ikke blokeres.
 * Det design (#2882) løste 429-rate-limits, som varer millisekunder. Men et
 * Discord-5xx-UDFALD varer typisk minutter — 3 sekunder kan pr. konstruktion
 * ikke overleve det, og beskeden blev droppet permanent. 8 auktioner blev aldrig
 * annonceret. Samme kodesti bærer resultat-poster, så et længere udfald midt i
 * en resultat-runde ville tabe resultater, ikke bare auktioner.
 *
 * Fix: retryable fejl der overlever inline-forsøgene lander her i stedet for at
 * blive droppet, og en cron (hvert 5. minut) prøver igen med eksponentiel
 * backoff over ~27 timer. Inline-loftet er UÆNDRET — vi venter ikke længere i
 * kalderen, vi husker bare det vi ikke nåede at levere.
 *
 * IDEMPOTENS: Discord opretter kun beskeden ved 2xx (se modul-headeren i
 * discordWebhookDelivery.js). Et 429/5xx/netværks-svar betyder at beskeden
 * ALDRIG blev oprettet, så et genforsøg fra outbox'en kan ikke give en dublet.
 *
 * ORDNING: en genleveret post lander efter beskeder sendt i mellemtiden. Det er
 * bevidst valgt frem for at holde en hel webhook-kø tilbage bag én fejlet post —
 * en forsinket auktions-annoncering er langt bedre end en tabt.
 *
 * Tabel: discord_webhook_outbox (database/2026-08-10-discord-webhook-outbox.sql).
 * Kun service_role rører tabellen (RLS enabled, ingen policies).
 */

import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

// Backoff-skema pr. attempt-nummer (1-indekseret). Sidste værdi genbruges.
// Samlet horisont ≈ 27 timer — samme skema som DM-outbox'en (#1115), rigeligt
// til selv et langt Discord-udfald eller et Cloudflare-IP-ban-vindue.
const RETRY_SCHEDULE_MS = [
  5 * 60 * 1000, // efter 1. outbox-fejl: +5 min
  15 * 60 * 1000, // +15 min
  60 * 60 * 1000, // +1 t
  3 * 60 * 60 * 1000, // +3 t
  6 * 60 * 60 * 1000, // +6 t
  8 * 60 * 60 * 1000, // +8 t
  8 * 60 * 60 * 1000, // +8 t
];

export const MAX_OUTBOX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;
const DRAIN_BATCH_SIZE = 25;

export function nextAttemptDelayMs(attempts) {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_SCHEDULE_MS.length - 1);
  return RETRY_SCHEDULE_MS[index];
}

/**
 * Læg en fejlet webhook-post i outbox'en. Best-effort: må ALDRIG kaste ind i
 * kalderen (sendWebhook er fire-and-forget for ~10 kaldere), men insert-fejl
 * logges + captures, så en defekt outbox ikke selv bliver en tavs fejl-kilde.
 *
 * @returns {Promise<{enqueued: boolean}>}
 */
export async function enqueueWebhook({
  supabase,
  webhookUrl,
  payload,
  lastStatus = null,
  lastError = null,
  captureExceptionFn,
  now = new Date(),
}) {
  if (!supabase?.from) return { enqueued: false };

  const { error } = await supabase.from("discord_webhook_outbox").insert({
    webhook_url: webhookUrl,
    payload,
    status: "pending",
    attempts: 1, // de inline-forsøg i sendWebhook tæller samlet som forsøg #1
    next_attempt_at: new Date(now.getTime() + nextAttemptDelayMs(1)).toISOString(),
    last_status: typeof lastStatus === "number" ? lastStatus : null,
    last_error: lastError ? String(lastError).slice(0, 500) : null,
  });

  if (error) {
    const reason = normalizeSupabaseErrorMessage(error.message);
    console.error("[discord-webhook:outbox] enqueue fejlede", { error: reason });
    captureExceptionFn?.(new Error(`Discord webhook-outbox enqueue fejlede: ${reason}`), {
      tags: { component: "discord-webhook-outbox" },
    });
    return { enqueued: false };
  }
  return { enqueued: true };
}

/**
 * Drain: prøv at levere alle forfaldne pending-rækker.
 *
 * @param {object} deps
 * @param {Function} deps.deliverFn  async ({ webhookUrl, payload }) => resultat
 *   fra attemptWebhookDelivery ({ ok, status, failure, error }). MÅ IKKE være
 *   sendWebhook selv — den ville lægge fejlen i outbox'en igen (uendelig vækst).
 * @param {Function} [deps.sendWebhookFn] bruges KUN til dead-alarmen; skal være
 *   en variant der ikke selv enqueuer, ellers kan outbox'en alarmere om sig selv.
 * @returns {{ processed: number, sent: number, rescheduled: number, dead: number }}
 */
export async function processWebhookOutboxDrain({
  supabase,
  deliverFn,
  sendWebhookFn,
  getAlarmWebhookFn,
  captureExceptionFn,
  now = new Date(),
  maxAttempts = MAX_OUTBOX_ATTEMPTS,
}) {
  const { data: rows, error } = await supabase
    .from("discord_webhook_outbox")
    .select("id, webhook_url, payload, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(DRAIN_BATCH_SIZE);

  if (error) {
    // #2023: normalisér en evt. Cloudflare/HTML-fejlside ned til én linje, så en
    // Supabase-outage ikke fylder Sentry med ulæselige HTML-dump-issues.
    const reason = normalizeSupabaseErrorMessage(error.message);
    console.error("[discord-webhook:outbox] drain-select fejlede", { error: reason });
    captureExceptionFn?.(new Error(`Discord webhook-outbox drain-select fejlede: ${reason}`), {
      tags: { component: "discord-webhook-outbox" },
    });
    return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };
  }
  if (!rows?.length) return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };

  let sent = 0;
  let rescheduled = 0;
  const deadRows = [];

  for (const row of rows) {
    const result = await deliverFn({ webhookUrl: row.webhook_url, payload: row.payload });

    if (result.ok) {
      await supabase.from("discord_webhook_outbox").delete().eq("id", row.id);
      sent++;
      continue;
    }

    const attempts = row.attempts + 1;
    const isPermanent = result.failure?.kind === "permanent";
    const exhausted = attempts >= maxAttempts;

    if (isPermanent || exhausted) {
      await supabase
        .from("discord_webhook_outbox")
        .update({
          status: "dead",
          attempts,
          last_status: result.status ?? null,
          last_error: String(result.error ?? "").slice(0, 500),
          dead_at: now.toISOString(),
        })
        .eq("id", row.id);
      deadRows.push({ id: row.id, status: result.status, reason: result.failure?.reason });
    } else {
      await supabase
        .from("discord_webhook_outbox")
        .update({
          attempts,
          last_status: result.status ?? null,
          last_error: String(result.error ?? "").slice(0, 500),
          next_attempt_at: new Date(now.getTime() + nextAttemptDelayMs(attempts)).toISOString(),
        })
        .eq("id", row.id);
      rescheduled++;
    }
  }

  // ÉN aggregeret alarm pr. drain-run (ikke pr. række) — forward-guard uden spam.
  // Først HER er beskeden reelt tabt; det er dette signal #3545 bad om at flytte
  // fra "3 sekunder efter første hik" til "efter ~27 timers forgæves forsøg".
  if (deadRows.length > 0) {
    const summary = deadRows
      .map((r) => `id=${r.id} (status=${r.status ?? "n/a"}, ${r.reason ?? "ukendt"})`)
      .join(", ");
    const url = getAlarmWebhookFn ? await getAlarmWebhookFn() : null;
    if (url && sendWebhookFn) {
      await sendWebhookFn(url, {
        embeds: [
          {
            title: "🚨 Discord-kanalposter kunne ikke leveres",
            description:
              `${deadRows.length} besked(er) opgivet efter gentagne forsøg (outbox → dead).\n` +
              `Typisk årsag: langvarigt Discord-udfald eller et slettet/fejlkonfigureret webhook.\n${summary}`,
            color: 0xe74c3c,
            timestamp: now.toISOString(),
          },
        ],
      });
    }
    captureExceptionFn?.(
      new Error(`Discord webhook-outbox: ${deadRows.length} besked(er) markeret dead — ${summary}`),
      { tags: { component: "discord-webhook-outbox" }, extra: { deadRows } }
    );
  }

  return { processed: rows.length, sent, rescheduled, dead: deadRows.length };
}
