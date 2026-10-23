// #6961 — trøjevindere pr. hold i sæsonoversigten. Ren funktion (ingen React).
// Kilden er de ENDELIGE klassementsrækker i race_results (result_type
// points/mountain/young, rank 1), som motoren kun skriver på et etapeløbs
// sidste etape. Holdet er resultat-tidspunktets hold (race_results.team_id),
// samme tilskrivning som season_standings.stage_wins/gc_wins.

export const JERSEY_RESULT_TYPES = ["points", "mountain", "young"] as const;

type JerseyType = (typeof JERSEY_RESULT_TYPES)[number];

export interface JerseyRow {
  result_type?: string | null;
  rank?: number | null;
  team_id?: string | null;
}

export interface TeamJerseyCount {
  total: number;
  points: number;
  mountain: number;
  young: number;
}

export function aggregateJerseyWins(rows: JerseyRow[] | null | undefined): Record<string, TeamJerseyCount> {
  const out: Record<string, TeamJerseyCount> = {};
  for (const r of rows || []) {
    if (!r || r.rank !== 1 || !r.team_id) continue;
    if (!(JERSEY_RESULT_TYPES as readonly string[]).includes(r.result_type ?? "")) continue;
    const type = r.result_type as JerseyType;
    const entry = out[r.team_id] || (out[r.team_id] = { total: 0, points: 0, mountain: 0, young: 0 });
    entry[type] += 1;
    entry.total += 1;
  }
  return out;
}

interface JerseyQueryClient {
  from: (table: string) => any;
}

/**
 * Henter KUN de endelige trøje-rækker (rank 1, tre result_types) for de givne
 * løb, i bidder så URL'en holdes kort. Kaster ved fejl (kalderen degraderer).
 */
export async function fetchJerseyWinnerRows(
  client: JerseyQueryClient,
  raceIds: string[],
  chunkSize = 60,
): Promise<JerseyRow[]> {
  const rows: JerseyRow[] = [];
  for (let i = 0; i < raceIds.length; i += chunkSize) {
    const { data, error } = await client.from("race_results")
      .select("result_type, rank, team_id")
      .in("race_id", raceIds.slice(i, i + chunkSize))
      .in("result_type", [...JERSEY_RESULT_TYPES])
      .eq("rank", 1);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}
