/**
 * Ops-alarm-kanal routing (#2077).
 * ================================
 * Kritiske backend-alarmer (tavse stalls, sæson-count-anomali, bot-token-drift,
 * DM-outbox-død) skal ramme en PRIVAT #ops-kanal med @mention af ejeren — ikke
 * drukne i "general". `getOpsWebhookUrl` læser DISCORD_OPS_WEBHOOK_URL og falder
 * gracefully tilbage til default-webhooken, så koden virker uændret indtil ops-
 * kanalen er provisioneret; `withOpsMention` prepender @mention når
 * DISCORD_OPS_MENTION er sat (fx "<@123456789012345678>").
 *
 * Ren + supabase-fri (mirror discordDmTarget.js) så unit-tests kan importere den
 * uden at trigge SupabaseClient-init (Node ESM + supabase-realtime websocket-factory).
 */

/** @returns {string|null} rå mention-streng (fx "<@123>") eller null hvis usat. */
export function getOpsMention() {
  const raw = (process.env.DISCORD_OPS_MENTION || "").trim();
  return raw || null;
}

/**
 * Ops-webhook-URL: eksplicit DISCORD_OPS_WEBHOOK_URL, ellers fallback til default.
 * @param {() => Promise<string|null>} [getDefaultWebhookFn]
 */
export async function getOpsWebhookUrl(getDefaultWebhookFn) {
  const explicit = (process.env.DISCORD_OPS_WEBHOOK_URL || "").trim();
  if (explicit) return explicit;
  return getDefaultWebhookFn ? await getDefaultWebhookFn() : null;
}

/**
 * Tilføjer @mention (content + allowed_mentions.parse:['users'] så <@id> faktisk
 * pinger via webhook) til et embed-payload. No-op når ingen mention er sat.
 */
export function withOpsMention(payload, mention = getOpsMention()) {
  if (!mention) return payload;
  return { content: mention, allowed_mentions: { parse: ["users"] }, ...payload };
}

/**
 * Wrapper omkring en sendWebhook(url, payload)-fn der auto-prepender ops-@mention.
 * mentionFn evalueres ved SEND-tid, så env-ændringer slår igennem uden re-import.
 */
export function makeSendOpsWebhook(sendWebhookFn, mentionFn = getOpsMention) {
  return (url, payload) => sendWebhookFn(url, withOpsMention(payload, mentionFn()));
}
