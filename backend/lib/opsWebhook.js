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

/**
 * @returns {string|null} rå mention-streng (fx "<@123>") eller null hvis usat.
 *
 * Normaliserer en bar numerisk Discord-ID (fx "12345") til
 * bruger-mention-format "<@id>" (#2739). Uden normalisering sender Discord
 * det rå tal som ren tekst i stedet for at pinge nogen, så ops-alarmer
 * aldrig når frem som notifikation.
 *
 * Allerede-formaterede mentions ("<@id>", "<@&id>" for en rolle, "@here",
 * "@everyone") røres ikke. Vi kan ikke afgøre ud fra et bart tal om det er
 * en bruger eller en rolle, så default er bruger-format; skal det være en
 * rolle, skal DISCORD_OPS_MENTION sættes eksplicit til "<@&id>".
 */
export function getOpsMention() {
  const raw = (process.env.DISCORD_OPS_MENTION || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return `<@${raw}>`;
  return raw;
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
 *
 * #3545: 3. argument videresendes uændret til sendWebhook. Uden det tabte
 * wrapperen `enqueueOnFailure:false`, som webhook-outbox-drainens dead-alarm
 * bruger for ikke at lægge sig selv i outbox'en.
 */
export function makeSendOpsWebhook(sendWebhookFn, mentionFn = getOpsMention) {
  return (url, payload, opts) => sendWebhookFn(url, withOpsMention(payload, mentionFn()), opts);
}
