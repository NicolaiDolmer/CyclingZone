// #8153: en frigivelse midt i et etapeloeb venter til loebets slut (ejer 14/11 + 17/11).
// Rene hjaelpere til skaermdelen: dialogens ekstra linje, kvitteringen ved en
// bestilling og maerket "Leaves after {race}" paa holdsiden og rytterprofilen.
// Serveren er sandheden: release-quote svarer `pendingRace` (kontakten taendt og
// rytteren i et aktivt etapeloeb), POST /release svarer `{ pending: true, race, fee }`,
// og GET /api/me/pending-releases giver holdets ventende frigivelser.

/**
 * Loebet, frigivelsen kommer til at vente paa, eller null (frigivelsen sker straks).
 * @param {unknown} quote svaret fra release-quote
 * @returns {{ id: string, name: string|null } | null}
 */
export function pendingRaceFromQuote(quote) {
  const race = /** @type {any} */ (quote)?.pendingRace;
  if (!race || typeof race !== "object" || !race.id) return null;
  return { id: String(race.id), name: race.name ?? null };
}

/**
 * Er POST /release-svaret en bestilling (rytteren bliver til efter loebet)?
 * @param {unknown} data
 */
export function isPendingReleaseResult(data) {
  return /** @type {any} */ (data)?.pending === true;
}

/**
 * Loebsnavnet til teksterne. Mangler navnet, bruges den oversatte reserve.
 * @param {{ name?: string|null, raceName?: string|null } | null | undefined} race
 * @param {string} fallback
 */
export function pendingRaceLabel(race, fallback) {
  const name = race?.name ?? race?.raceName ?? null;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

/**
 * GET /api/me/pending-releases -> { [riderId]: { raceId, raceName } }.
 * Alt andet end en liste giver et tomt opslag (maerket falder bare vaek).
 * @param {unknown} rows
 * @returns {Record<string, { raceId: string|null, raceName: string|null }>}
 */
export function pendingReleasesByRider(rows) {
  if (!Array.isArray(rows)) return {};
  /** @type {Record<string, { raceId: string|null, raceName: string|null }>} */
  const out = {};
  for (const row of rows) {
    const riderId = row?.riderId;
    if (!riderId) continue;
    out[String(riderId)] = { raceId: row.raceId ?? null, raceName: row.raceName ?? null };
  }
  return out;
}
