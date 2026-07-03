/**
 * Cycling Zone — resultat-webhook-routing (#2153).
 * =================================================
 * Ren routing-logik: given en gruppe-URL, en tier-samle-URL og en default-URL,
 * bestem hvilke webhook-URL'er et resultat skal sendes til.
 *
 * Ingen Supabase-import (mirror opsWebhook.js / discordDmTarget.js), så
 * unit-tests kan importere den uden at trigge SupabaseClient-init. I/O-delen
 * (opslag i discord_settings + league_divisions) bor i discordNotifier.js.
 */

/**
 * Vælg de webhook-URL'er et løbsresultat skal sendes til.
 *
 * Regel: er der konfigureret en gruppe- og/eller samle-kanal, sendes der KUN
 * dertil (dedupliceret — Division 1's gruppe og samle kan være samme kanal).
 * Er intet division-specifikt wired endnu (fx før Fase 3), falder vi tilbage til
 * defaultUrl, så resultater ikke tavst forsvinder i overgangen.
 *
 * @param {{ groupUrl?: string|null, summaryUrl?: string|null, defaultUrl?: string|null }} [o]
 * @returns {string[]} unikke, ikke-tomme URL'er (kan være tom hvis intet er sat)
 */
export function computeResultWebhookUrls({ groupUrl, summaryUrl, defaultUrl } = {}) {
  const specific = [groupUrl, summaryUrl].filter(Boolean);
  const chosen = specific.length ? specific : [defaultUrl].filter(Boolean);
  return [...new Set(chosen)];
}
