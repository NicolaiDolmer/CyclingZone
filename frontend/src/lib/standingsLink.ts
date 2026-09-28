// #5315 — "Full standings" på dashboardet skal deep-linke til managerens EGEN
// pulje/gruppe i stillingen (samme division + samme pulje som holdet), ikke
// hele divisionen. Ren funktion (unit-testet, node --test), genbruger samme
// ownPoolRow-/hasPoolSubtabs-kilde som "My division standings"-modulet
// (lib/dashboardDivStandings.js), så de to aldrig kan pege på to forskellige
// puljer for samme hold.
//
// Fallback: pulje ukendt (hasPoolSubtabs=false — helt nyt hold uden egen
// pulje endnu, ELLER tieren har kun én pulje) → almindeligt /standings uden
// query-param, som i dag. StandingsPage autoselecter allerede spillerens
// division via sit eget "mine"-opslag, så "hele divisionen" i det tilfælde
// reelt ER holdets division (samme UX som før #5315) — kun pulje-sub-fanen
// (POOL_ALL) forbliver uspecificeret.

export interface OwnPoolRow {
  id: number | string;
  tier?: number | null;
}

/**
 * Bygger stien til "Full standings"-linket.
 *
 * @param hasPoolSubtabs - har egen tier mere end én pulje? (false = ingen
 *   deep-link nødvendig, en enkelt pulje ER hele tieren)
 * @param ownPoolRow - holdets egen pulje-række (league_divisions: id + tier),
 *   eller null/undefined hvis ukendt
 * @returns "/standings?division=<tier>&pool=<id>" når puljen er kendt,
 *   ellers bare "/standings" (dagens fallback: hele divisionen)
 */
export function buildStandingsLink(
  hasPoolSubtabs: boolean,
  ownPoolRow: OwnPoolRow | null | undefined,
): string {
  if (!hasPoolSubtabs || !ownPoolRow || ownPoolRow.id == null) return "/standings";
  const params = new URLSearchParams();
  if (ownPoolRow.tier != null) params.set("division", String(ownPoolRow.tier));
  params.set("pool", String(ownPoolRow.id));
  return `/standings?${params.toString()}`;
}
