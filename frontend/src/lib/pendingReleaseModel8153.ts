// #8153: en frigivelse midt i et etapeloeb venter til loebets slut (ejer 14/11 + 17/11).
// Rene hjaelpere til skaermdelen: dialogens ekstra linje, kvitteringen ved en
// bestilling og maerket "Leaves after {race}" paa holdsiden og rytterprofilen.
// Serveren er sandheden: release-quote svarer `pendingRace` (kontakten taendt og
// rytteren i et aktivt etapeloeb), POST /release svarer `{ pending: true, race, fee }`,
// og GET /api/me/pending-releases giver holdets ventende frigivelser.

export type PendingRace = { id: string; name: string | null };
export type PendingRelease = { raceId: string | null; raceName: string | null };

/** Loebet, frigivelsen kommer til at vente paa, eller null (frigivelsen sker straks). */
export function pendingRaceFromQuote(quote: unknown): PendingRace | null {
  const race = (quote as { pendingRace?: { id?: unknown; name?: string | null } } | null | undefined)?.pendingRace;
  if (!race || typeof race !== "object" || !race.id) return null;
  return { id: String(race.id), name: race.name ?? null };
}

/** Er POST /release-svaret en bestilling (rytteren bliver til efter loebet)? */
export function isPendingReleaseResult(data: unknown): boolean {
  return (data as { pending?: unknown } | null | undefined)?.pending === true;
}

/** Loebsnavnet til teksterne. Mangler navnet, bruges den oversatte reserve. */
export function pendingRaceLabel(
  race: { name?: string | null; raceName?: string | null } | null | undefined,
  fallback: string,
): string {
  const name = race?.name ?? race?.raceName ?? null;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

/**
 * GET /api/me/pending-releases -> { [riderId]: { raceId, raceName } }.
 * Alt andet end en liste giver et tomt opslag (maerket falder bare vaek).
 */
export function pendingReleasesByRider(rows: unknown): Record<string, PendingRelease> {
  if (!Array.isArray(rows)) return {};
  const out: Record<string, PendingRelease> = {};
  for (const row of rows as Array<{ riderId?: unknown; raceId?: string | null; raceName?: string | null } | null>) {
    const riderId = row?.riderId;
    if (!riderId) continue;
    out[String(riderId)] = { raceId: row?.raceId ?? null, raceName: row?.raceName ?? null };
  }
  return out;
}
