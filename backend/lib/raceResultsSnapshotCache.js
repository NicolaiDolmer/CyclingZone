// Proces-lokal cache for afledte race_results-værdier pr. completet løb (#4010).
//
// Baggrund: sponsor/auto-prize-sweepen kører hvert 5. minut og skal for HVERT
// completet løb i sæsonen vide hvilke hold der deltog, hvornår hvert hold blev
// registreret første gang, og hvilke rækker der er top-3. Den hentede før alle
// race_results-rækker for alle 700+ løb ved hver eneste tick — og smed så
// arbejdet væk igen, fordi paidKeys-prefilteret først blev anvendt bagefter.
//
// Målt over 23 timer (pg_stat_statements): 203.849 kald, 1.038 s DB-tid
// (19,9 % af al eksekveringstid) og 1,9 TB buffer-trafik. 288 ticks × ~708
// sider matcher tallet eksakt.
//
// Et completet løbs resultater er uforanderlige, så de afledte værdier kan
// beregnes én gang og genbruges. Cachen er bevidst proces-lokal og bevidst
// eksplicit invalideret: enhver skrivning til race_results tømmer den (se
// stageResultRpc.js og betaResetService.js), så en resultat-korrektion eller
// omkørsel ikke kan blive hængende i en stale snapshot.
//
// Størrelse: ét objekt pr. løb med deltager-id'er, tidspunkter og top-3-rækker
// — ikke de rå rækker. 800 completede løb fylder under 1 MB.

const snapshots = new Map();

/** @returns {{participatingTeamIds: string[], resultTimeByTeam: Record<string,string>, podiumResults: {team_id: string, rank: number}[]} | null} */
export function getRaceResultsSnapshot(raceId) {
  if (!raceId) return null;
  return snapshots.get(raceId) ?? null;
}

export function setRaceResultsSnapshot(raceId, snapshot) {
  if (!raceId || !snapshot) return;
  snapshots.set(raceId, snapshot);
}

// Kaldes fra ENHVER skrivesti mod race_results. Bevidst hele cachen og ikke kun
// det ene løb: skrivestierne kender ikke altid det fulde sæt berørte løb (fx en
// beta-reset eller en batch der spænder over flere løb), og en genopvarmning
// koster kun én sweep-tick.
export function clearRaceResultsSnapshots() {
  snapshots.clear();
}

// Til test + diagnostik.
export function raceResultsSnapshotCacheSize() {
  return snapshots.size;
}
