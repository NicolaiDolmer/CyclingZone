// #3333 — Podiet for ét løb på Resultat-hubbens Seneste-fane. Flyttet ud af
// ResultaterPage.jsx (en .jsx-fil er usynlig for `node --test` — ren logik hører
// hjemme i lib/ med sin egen test, samme mønster som raceHubLogic.js).
//
// Etapeløb afgøres på det samlede klassement (gc), endagsløb på selve
// etaperesultatet. For et FÆRDIGT etapeløb findes gc-rækkerne kun på den sidst
// kørte etape, så vi tager altid det højeste stage_number og lader rank bestemme
// rækkefølgen.
//
// For et IGANGVÆRENDE etapeløb findes der endnu ingen 'gc'-række — den skrives
// først ved finalization. Den løbende stilling ligger i stedet i 'leader'-
// rækkerne (én snapshot pr. kørt etape). buildLiveStandings (raceLiveStandings.js)
// er allerede den kanoniske, testede udregning af den stilling (samme kilde som
// RaceDetailPage's live-fane, #2081) — genbruges her i stedet for en femte
// klassement-udregning.
import { buildLiveStandings } from "./raceLiveStandings.js";

function byRank(a, b) {
  return (a.rank ?? 99) - (b.rank ?? 99);
}

function topThreeAtMaxStage(rows) {
  if (rows.length === 0) return [];
  const maxStage = Math.max(...rows.map((r) => r.stage_number ?? 0));
  return rows
    .filter((r) => (r.stage_number ?? 0) === maxStage)
    .sort(byRank)
    .slice(0, 3);
}

/**
 * @param {{id: string, race_type?: string|null}} race
 * @param {Array<{race_id: string, result_type: string, stage_number?: number|null, rank?: number|null}>} rows
 * @returns {Array} op til 3 rækker, sorteret på placering
 */
export function podiumFor(race, rows) {
  const forRace = (rows || []).filter((r) => r.race_id === race.id);

  if (race.race_type === "stage_race") {
    const gcRows = forRace.filter((r) => r.result_type === "gc");
    if (gcRows.length > 0) return topThreeAtMaxStage(gcRows);

    // Ingen 'gc' endnu → løbet kører stadig. Fald tilbage til seneste fuldt
    // persisterede 'leader'-snapshot fremfor at vise et tomt podie.
    const live = buildLiveStandings(forRace);
    return (live?.byType?.gc || []).slice(0, 3);
  }

  return topThreeAtMaxStage(forRace.filter((r) => r.result_type === "stage"));
}
