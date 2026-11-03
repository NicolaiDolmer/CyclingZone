// backend/lib/raceDistributionColumns.ts
// #7553 - hvilke af dagens loeb er holdets kolonner i Planlaegning > Dag?
//
// buildColumnSet giver alle puljens loeb paa dagen. Et loeb med laast trup (lineup_locked:
// etape 1's start er passeret eller en etape er koert) kan holdet ikke laengere komme med i.
// Har holdet ingen ryttere tilmeldt og ingen afmelding (frivillig eller did_not_start), er
// det ikke holdets loeb: fx et etapeloeb der startede foer holdet blev oprettet. Saadan et
// loeb vistes som "Trup laast · Truppen er endelig." med en Afmeld-knap.
// Samme regel som #7506 (trainNow.js filterRacesTeamCanJoin): et startet loeb uden holdets
// entries kan ikke joines.
//
// Et ulaast loeb vises altid, saa holdet stadig kan udtage til det.

type ColumnRace = { id: string; lineup_locked?: boolean | null; stages_completed?: number | null };

// Codex-review (#7555): lineup_locked er sand allerede naar etape 1s starttid er passeret,
// ogsaa hvis motoren er pauset eller forsinket. Indtil en etape faktisk er koert, kan
// raceRunner.fillMissingTeamEntries stadig give holdet en trup, saa kun et loeb med en
// koert etape kan holdet ikke laengere komme med i (samme regel som trainNow.js).
function hasRunStage(race: ColumnRace): boolean {
  return (Number(race.stages_completed) || 0) > 0;
}
type IdSet = ReadonlySet<string>;

/**
 * PURE: behold de kolonne-loeb holdet hoerer til.
 * - ulaast loeb: altid med,
 * - loeb med en koert etape: kun med naar holdet har entries i det ELLER en afmelding.
 * - laast men ikke koert (forsinket/pauset start): med, assistenten kan stadig fylde op.
 */
export function keepTeamDistributionColumns<T extends ColumnRace>({ columns, enteredRaceIds, withdrawnIds }: {
  columns: readonly T[] | null | undefined;
  enteredRaceIds: IdSet;
  withdrawnIds: IdSet;
}): T[] {
  return (columns ?? []).filter((race) => !hasRunStage(race)
    || enteredRaceIds.has(race.id) || withdrawnIds.has(race.id));
}

type QueryResult = PromiseLike<{ data: Array<{ race_id: string }> | null; error: { message: string } | null }>;
type SupabaseLike = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): { in(col: string, values: string[]): QueryResult };
    };
  };
};

/**
 * Holdets kolonner for dagen. Laeser kun holdets entries i de LAASTE kolonne-loeb uden
 * afmelding (de eneste der kan falde fra). En laesefejl kastes (route'en giver 500), saa
 * board'et aldrig viser en forkert kolonne-liste.
 */
export async function teamDistributionColumns<T extends ColumnRace>({ supabase, teamId, columns, withdrawnIds }: {
  supabase: SupabaseLike;
  teamId: string;
  columns: readonly T[] | null | undefined;
  withdrawnIds: IdSet;
}): Promise<T[]> {
  const lockedIds = (columns ?? [])
    .filter((race) => hasRunStage(race) && !withdrawnIds.has(race.id))
    .map((race) => race.id);
  const enteredRaceIds = new Set<string>();
  if (lockedIds.length) {
    // pagination-safe: one team's entries in today's locked races (a few squads of <= 9).
    const { data, error } = await supabase.from("race_entries").select("race_id")
      .eq("team_id", teamId).in("race_id", lockedIds);
    if (error) throw new Error(`race_entries (distribution columns): ${error.message}`);
    for (const row of data ?? []) enteredRaceIds.add(row.race_id);
  }
  return keepTeamDistributionColumns({ columns, enteredRaceIds, withdrawnIds });
}
