// #6961 — trøjevindere pr. hold i sæsonoversigten. Ren funktion (ingen fetch,
// ingen React). Kilden er de ENDELIGE klassementsrækker i race_results
// (result_type points/mountain/young, rank 1), som motoren kun skriver på et
// etapeløbs sidste etape. Holdet er resultat-tidspunktets hold (race_results.
// team_id), samme tilskrivning som season_standings.stage_wins/gc_wins.

export const JERSEY_RESULT_TYPES = ["points", "mountain", "young"];

/**
 * @param {Array<{result_type?: string, rank?: number, team_id?: string|null}>} rows
 * @returns {{ [teamId: string]: { total: number, points: number, mountain: number, young: number } }}
 */
export function aggregateJerseyWins(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r || r.rank !== 1 || !r.team_id) continue;
    if (!JERSEY_RESULT_TYPES.includes(r.result_type)) continue;
    const entry = out[r.team_id] || (out[r.team_id] = { total: 0, points: 0, mountain: 0, young: 0 });
    entry[r.result_type] += 1;
    entry.total += 1;
  }
  return out;
}
