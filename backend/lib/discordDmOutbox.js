/**
 * Discord DM-outbox — varig levering på tværs af rate-limits og restarts (#1115).
 * ===============================================================================
 * Når attemptDmDelivery fejler med en RETRYABLE fejl (429 fra Railways delte
 * egress-IP, Discord 5xx, netværk), gemmes DM'en her i stedet for at blive
 * droppet. En cron (hvert 5. minut) prøver igen med eksponentiel backoff op
 * til MAX_OUTBOX_ATTEMPTS; derefter markeres rækken 'dead' og der sendes ÉN
 * aggregeret alarm (webhook + Sentry) pr. drain-run — så vedvarende DM-fejl
 * opdages med det samme i stedet for at fejle tavst i ugevis (#1002, #1115).
 *
 * Tabel: discord_dm_outbox (database/2026-06-10-discord-dm-outbox.sql).
 * Kun service_role rører tabellen (RLS enabled, ingen policies).
 */

// Backoff-skema pr. attempt-nummer (1-indekseret). Sidste værdi genbruges.
// Samlet horisont ≈ 27 timer — dækker selv lange Cloudflare-IP-ban-vinduer.
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
 * Læg en fejlet DM i outbox'en. Best-effort: må ALDRIG kaste ind i kalderen
 * (DM-flowet er fire-and-forget), men insert-fejl logges + captures så en
 * defekt outbox ikke selv bliver en tavs fejl-kilde.
 */
export async function enqueueDm({
  supabase,
  discordId,
  payload,
  lastStatus = null,
  lastError = null,
  captureExceptionFn,
  now = new Date(),
}) {
  const { error } = await supabase.from("discord_dm_outbox").insert({
    discord_id: discordId,
    payload,
    status: "pending",
    attempts: 1, // det direkte forsøg i sendDM tæller som forsøg #1
    next_attempt_at: new Date(now.getTime() + nextAttemptDelayMs(1)).toISOString(),
    last_status: lastStatus,
    last_error: lastError ? String(lastError).slice(0, 500) : null,
  });
  if (error) {
    console.error("[discord-dm:outbox] enqueue fejlede", { error: error.message });
    captureExceptionFn?.(new Error(`Discord DM-outbox enqueue fejlede: ${error.message}`), {
      tags: { component: "discord-dm-outbox" },
    });
    return { enqueued: false };
  }
  return { enqueued: true };
}

/**
 * Drain: prøv at levere alle forfaldne pending-rækker.
 *
 * @param {object} deps
 * @param {Function} deps.deliverFn  async ({ discordId, payload }) =>
 *   resultat fra attemptDmDelivery ({ ok, status, failure, error }).
 * @returns {{ processed: number, sent: number, rescheduled: number, dead: number }}
 */
export async function processDmOutboxDrain({
  supabase,
  deliverFn,
  sendWebhookFn,
  getDefaultWebhookFn,
  captureExceptionFn,
  now = new Date(),
  maxAttempts = MAX_OUTBOX_ATTEMPTS,
}) {
  const { data: rows, error } = await supabase
    .from("discord_dm_outbox")
    .select("id, discord_id, payload, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(DRAIN_BATCH_SIZE);

  if (error) {
    console.error("[discord-dm:outbox] drain-select fejlede", { error: error.message });
    captureExceptionFn?.(new Error(`Discord DM-outbox drain-select fejlede: ${error.message}`), {
      tags: { component: "discord-dm-outbox" },
    });
    return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };
  }
  if (!rows?.length) return { processed: 0, sent: 0, rescheduled: 0, dead: 0 };

  let sent = 0;
  let rescheduled = 0;
  const deadRows = [];

  for (const row of rows) {
    const result = await deliverFn({ discordId: row.discord_id, payload: row.payload });

    if (result.ok) {
      await supabase.from("discord_dm_outbox").delete().eq("id", row.id);
      sent++;
      continue;
    }

    const attempts = row.attempts + 1;
    const isPermanent = result.failure?.kind === "permanent";
    const exhausted = attempts >= maxAttempts;

    if (isPermanent || exhausted) {
      await supabase
        .from("discord_dm_outbox")
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
        .from("discord_dm_outbox")
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
  if (deadRows.length > 0) {
    const summary = deadRows
      .map((r) => `id=${r.id} (status=${r.status ?? "n/a"}, ${r.reason ?? "ukendt"})`)
      .join(", ");
    const url = getDefaultWebhookFn ? await getDefaultWebhookFn() : null;
    if (url && sendWebhookFn) {
      await sendWebhookFn(url, {
        embeds: [
          {
            title: "🚨 Discord-DMs kunne ikke leveres",
            description:
              `${deadRows.length} DM(s) opgivet efter gentagne forsøg (outbox → dead).\n` +
              `Typisk årsag: vedvarende rate-limit af serverens IP eller ugyldigt token.\n${summary}`,
            color: 0xe74c3c,
            timestamp: now.toISOString(),
          },
        ],
      });
    }
    captureExceptionFn?.(
      new Error(`Discord DM-outbox: ${deadRows.length} DM(s) markeret dead — ${summary}`),
      { tags: { component: "discord-dm-outbox" }, extra: { deadRows } }
    );
  }

  return { processed: rows.length, sent, rescheduled, dead: deadRows.length };
}
