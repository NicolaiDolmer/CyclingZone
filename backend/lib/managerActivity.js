// [epic #4592] Inaktiv manager (S3-forberedelse) · Ren, DB-fri klassifikation af
// manager-aktivitet ud fra users.last_seen. SSOT for "inaktiv"-definitionen fra
// ejer-beslutning 2/9: et hold anses "inaktivt" efter 30 dage uden login.
//
// Bevidst kun last_seen — ingen player_events/session-heuristik. Det er et
// ANDET spørgsmål end retentionScorecard.js's last_activity =
// GREATEST(created_at, last_seen, MAX(player_events.created_at)), som måler
// "kom brugeren tilbage inden for N dage efter signup" til retention-kohorter
// (et historisk, kohorte-relativt spørgsmål), ikke "er brugeren aktiv LIGE NU
// målt fra i dag" (et aktuelt, absolut spørgsmål). Se PR-body for hvorfor de
// to andre eksisterende last_seen-tærskler i koden (boardAutoAccept.js 14
// dage, api.js 5-minutters presence) IKKE er erstattet af dette modul.

const DAY_MS = 86_400_000;

/**
 * Antal dage siden `user.last_seen`, målt fra `now`. Kan være negativt hvis
 * last_seen ligger i fremtiden (ugyldigt input, men vi kaster ikke — se
 * isDormantManager/dormancyBucket for hvordan det håndteres nedstrøms).
 *
 * @param {{ last_seen?: string|null }|null} user
 * @param {Date} now
 * @returns {number|null} null hvis last_seen mangler eller ikke kan parses
 */
export function daysSinceLastSeen(user, now) {
  const raw = user?.last_seen ?? null;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) return null;
  return (now.getTime() - ms) / DAY_MS;
}

/**
 * Er manageren bag holdet inaktiv? Ejer-definition 2/9: 30 dage uden login.
 * Manglende/ugyldig last_seen tæller som inaktiv — der er intet login at måle
 * fra, samme retning som boardAutoAccept.resolveThresholds vælger ved manglende
 * last_seen (fallback til oprydnings-sættet, ikke det aktive).
 *
 * @param {{ last_seen?: string|null }|null} user
 * @param {Date} now
 * @param {{ days?: number }} [opts] — dormancy-tærskel i dage (default 30)
 * @returns {boolean}
 */
export function isDormantManager(user, now, { days = 30 } = {}) {
  const daysSince = daysSinceLastSeen(user, now);
  if (daysSince === null) return true;
  return daysSince >= days;
}

/**
 * Tre-vejs bucket til rapportering (dormantTeamsReport.js m.fl.):
 *   - "active_7d"   — logget ind inden for de seneste `activeDays` (default 7)
 *   - "away_8_30d"  — mellem `activeDays` og `dormantDays` (default 30)
 *   - "dormant_30d" — >= `dormantDays`, eller manglende/ugyldig last_seen
 *
 * Grænserne er inklusive i den retning der matcher isDormantManager: en
 * bruger med præcis `dormantDays` dages fravær er "dormant_30d" her OG
 * isDormantManager(..., { days: dormantDays }) === true for samme input.
 *
 * @param {{ last_seen?: string|null }|null} user
 * @param {Date} now
 * @param {{ activeDays?: number, dormantDays?: number }} [opts]
 * @returns {"active_7d"|"away_8_30d"|"dormant_30d"}
 */
export function dormancyBucket(user, now, { activeDays = 7, dormantDays = 30 } = {}) {
  const daysSince = daysSinceLastSeen(user, now);
  if (daysSince === null) return "dormant_30d";
  if (daysSince <= activeDays) return "active_7d";
  if (daysSince < dormantDays) return "away_8_30d";
  return "dormant_30d";
}
