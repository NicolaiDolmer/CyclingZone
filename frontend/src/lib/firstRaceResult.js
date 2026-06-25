// #940 målebølge — udleder payloaden til first_race_result_viewed-eventet.
//
// Eventet fyrer FØRSTE gang en bruger ser et af sine EGNE holds løbsresultater.
// Vi vælger det "bedste" resultat at attribuere eventet til (laveste placering =
// bedst), så payloaden bærer et meningsfuldt placement frem for en vilkårlig
// række. Pure + uden Supabase, så gatingen kan unit-testes.
//
// Input = race_results-rækker som TeamResultsTab allerede henter
// ({ rank, race: { id } } m.fl.). Returnerer { race_id, placement } eller null
// hvis der ikke er nogen brugbar række (intet at logge).

export function pickFirstRaceResultPayload(results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  let best = null;
  for (const r of results) {
    const raceId = r?.race?.id ?? null;
    const placement = Number.isFinite(r?.rank) ? r.rank : null;
    // Kræv et race_id (gamle PCM-løb uden race.id kan ikke attribueres til et løb).
    if (!raceId) continue;
    if (best === null) {
      best = { race_id: raceId, placement };
      continue;
    }
    // Lavere rank = bedre placering. null-placement taber mod et tal.
    const bestRank = best.placement ?? Infinity;
    const thisRank = placement ?? Infinity;
    if (thisRank < bestRank) best = { race_id: raceId, placement };
  }

  return best;
}
