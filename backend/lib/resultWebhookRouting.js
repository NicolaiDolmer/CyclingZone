/**
 * Cycling Zone — resultat-webhook-routing (#2153, ændret #4999).
 * =================================================
 * Ren routing-logik: given en gruppe-URL og en default-URL, bestem hvilken
 * webhook-URL et resultat skal sendes til.
 *
 * Ingen Supabase-import (mirror opsWebhook.js / discordDmTarget.js), så
 * unit-tests kan importere den uden at trigge SupabaseClient-init. I/O-delen
 * (opslag i discord_settings) bor i discordNotifier.js.
 */

/**
 * Vælg den webhook-URL et løbsresultat skal sendes til.
 *
 * Regel (#4999, ejer 7/9): KUN gruppekanalen (division + gruppe,
 * `discord_settings.league_division_id`-match). Division-samlekanalerne
 * (fx results-d2/d3/d4, `is_summary`) fik tidligere OGSÅ hver post (#2153,
 * 2026-07-03) — det er ejeren nu gået væk fra for at skære støj i Discord.
 * Er der slet ikke konfigureret en gruppekanal endnu (fx før wiring er
 * færdig), falder vi tilbage til defaultUrl, så resultater ikke tavst
 * forsvinder i overgangen.
 *
 * @param {{ groupUrl?: string|null, defaultUrl?: string|null }} [o]
 * @returns {string[]} unikke, ikke-tomme URL'er (kan være tom hvis intet er sat)
 */
export function computeResultWebhookUrls({ groupUrl, defaultUrl } = {}) {
  return groupUrl ? [groupUrl] : [defaultUrl].filter(Boolean);
}
