// #4557 · Kalenderdags-tærsklerne for "hvor længe venter bestyrelsen" er delt
// mellem to auto-accept-cron'er: den gamle (board_profiles, boardAutoAccept.js,
// #2463/#3579) og den nye Mandat-årsmøde-cron (board_mandates,
// boardMandateAutoAccept.js, #4557 S-M2c). Begge skal bruge SAMME regel (ejer-
// svar 2/9 spørgsmål 3: A — "5 dage / 10 for aktive spillere, som i dag") —
// derfor ligger tallene og `resolveThresholds` her, ét sted, importeret af
// begge moduler, i stedet for at blive dupliceret (og drifte fra hinanden,
// præcis den fejlklasse #3514-reworket findes for at fjerne).
//
// `boardAutoAccept.js` re-exporterer disse for bagudkompatibilitet — alt
// eksisterende importerende kode (tests, routes/api.js) er uændret.

export const DAY_MS = 24 * 60 * 60 * 1000;

// Tærskler — kalenderdage siden planen/mandatet blev åbnet til forhandling
// (#2463). NOTICE er en NEUTRAL åbnings-besked uden nedtælling (#3579).
export const AUTO_ACCEPT_THRESHOLDS = {
  NOTICE: 0,
  T_MINUS_3: 2,
  T_MINUS_1: 4,
  AUTO_ACCEPT: 5,
};

// #3579 · Aktive spillere får dobbelt vindue — se boardAutoAccept.js's
// modul-header for den fulde begrundelse (auto-accept er en sikkerhedsventil
// for de hold ingen passer, ikke en måde at afgøre en aktiv managers
// årsmøde på).
export const ACTIVE_PLAYER_THRESHOLDS = {
  NOTICE: 0,
  T_MINUS_3: 5,
  T_MINUS_1: 8,
  AUTO_ACCEPT: 10,
};

// Grænsen for "spiller stadig". users.last_seen inden for dette vindue = aktiv.
export const ACTIVE_PLAYER_LAST_SEEN_DAYS = 14;

/**
 * Vælg tærskelsæt ud fra om der sidder et menneske bag holdet. Ukendt/manglende
 * last_seen behandles som inaktiv: der er ingen at varsle, og oprydning/
 * auto-accept er det rigtige udfald.
 *
 * @param {object|null} lastSeenSource — `{ last_seen }`
 * @param {Date} now
 */
export function resolveThresholds(lastSeenSource, now) {
  const lastSeenRaw = lastSeenSource?.last_seen ?? null;
  if (!lastSeenRaw) return AUTO_ACCEPT_THRESHOLDS;
  const lastSeenMs = new Date(lastSeenRaw).getTime();
  if (Number.isNaN(lastSeenMs)) return AUTO_ACCEPT_THRESHOLDS;
  const daysSinceSeen = (now.getTime() - lastSeenMs) / DAY_MS;
  return daysSinceSeen <= ACTIVE_PLAYER_LAST_SEEN_DAYS
    ? ACTIVE_PLAYER_THRESHOLDS
    : AUTO_ACCEPT_THRESHOLDS;
}
