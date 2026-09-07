/**
 * discordHandle — delt validering/normalisering af det offentlige Discord-
 * brugernavn på managerprofilen (#5012, #4751).
 *
 * Discords nuværende brugernavn-regler (post-2023-migration væk fra
 * discriminator#tag): 2-32 tegn, kun små bogstaver, tal, punktum og
 * underscore. Vi validerer mod de samme regler her, delt mellem
 * indstillinger (ProfilePage) og evt. fremtidige call-sites.
 *
 * Ren .js (ingen React) så den er node --test-venlig, samme opskrift som
 * amountInput.js.
 */

const DISCORD_HANDLE_RE = /^[a-z0-9._]{2,32}$/;

/**
 * @param {string|null|undefined} raw
 * @returns {{ valid: boolean, value: string|null }}
 *   value === null betyder "ryd feltet" (tomt input er altid gyldigt — feltet
 *   er valgfrit). value er trimmet, men IKKE lowercased — Discord-brugernavne
 *   er selv altid lowercase, så et input med versaler er en fejl, ikke noget
 *   vi bare retter stiltiende.
 */
export function parseDiscordHandle(raw) {
  if (raw === null || raw === undefined) return { valid: true, value: null };
  const trimmed = String(raw).trim();
  if (trimmed === "") return { valid: true, value: null };
  if (!DISCORD_HANDLE_RE.test(trimmed)) return { valid: false, value: null };
  return { valid: true, value: trimmed };
}

/** @param {string|null|undefined} raw */
export function isValidDiscordHandle(raw) {
  return parseDiscordHandle(raw).valid;
}

// Discord snowflake-ID'er (det interne bruger-ID, adskilt fra det offentlige
// brugernavn ovenfor) er 17-19 cifre. Samme mønster som ProfilePage.jsx's
// eksisterende discord_id-validering (#2161) — genbrugt her så manager-
// profilens klik-logik kan afgøre link-vs-kopi uden at duplikere regexen.
const DISCORD_SNOWFLAKE_RE = /^\d{17,19}$/;

/** @param {string|null|undefined} raw */
export function isValidDiscordSnowflake(raw) {
  return typeof raw === "string" && DISCORD_SNOWFLAKE_RE.test(raw);
}
