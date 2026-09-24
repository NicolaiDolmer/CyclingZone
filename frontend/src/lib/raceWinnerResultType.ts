// #5601 — hvor står vinderen af en etape/et løb i race_results?
//
// Motoren (backend/lib/raceRunner.js) skriver to forskellige former:
//   - ETAPELØB (race_type 'stage_race'): hver etapes placeringer som
//     result_type 'stage' på etapens stage_number. På sidste etape skrives
//     OGSÅ det samlede klassement som 'gc' på samme stage_number — den rank-1
//     'gc'-række er løbets samlede vinder, IKKE etapevinderen.
//   - ENDAGSLØB (alt andet, i praksis 'single'): KUN 'gc' + hold, altid på
//     stage_number 1. Ingen 'stage'-rækker ("= dobbelttælling, jf. PCM").
//     Prod 24/9: 751 rank-1 'gc'-rækker og 0 'stage'-rækker for endagsløb.
//
// Et opslag der kun filtrerer på 'stage' finder derfor aldrig et endagsløbs
// vinder (dashboardets "Today's stages" og Race Centre viste "No results" på
// alle 380 afsluttede endagskort 23/9). Og man kan ikke bare tilføje 'gc' til
// filteret, for så forveksles et etapeløbs samlede vinder med dagens
// etapevinder. Reglen bor derfor ét sted: her. Samme skelnen som backendens
// `isStageRace = race.race_type === "stage_race"` (raceRunner.js).
//
// Ren modul (ingen React, ingen I/O), så `node --test` kan loade den direkte.

/** stage_number som motoren altid skriver et endagsløbs resultater på. */
export const ONE_DAY_RESULT_STAGE = 1;

export type RaceResultType = "stage" | "gc";

/** Hvilken result_type + stage_number et løbs placeringer for en etape står under. */
export interface RaceResultSlot {
  resultType: RaceResultType;
  stageNumber: number;
}

/** Én etape i ét løb, som kortene kender den. */
export interface RaceStageRef {
  raceId: string;
  raceType: string | null | undefined;
  stageNumber: number;
}

/** Den del af en race_results-række hjælperen læser. */
export interface RaceResultRowLike {
  race_id?: string | null;
  stage_number?: number | null;
  result_type?: string | null;
}

/** En afgrænset race_results-forespørgsel: én result_type, kendte løb og etaper. */
export interface RaceResultQueryGroup {
  resultType: RaceResultType;
  raceIds: string[];
  stageNumbers: number[];
}

export function isStageRaceType(raceType: string | null | undefined): boolean {
  return raceType === "stage_race";
}

/**
 * Etapeløb → 'stage' på etapens eget nummer. Endagsløb → 'gc' på
 * stage_number 1, uanset hvilket etapenummer slottet bærer.
 */
export function raceResultSlot(raceType: string | null | undefined, stageNumber: number): RaceResultSlot {
  if (isStageRaceType(raceType)) return { resultType: "stage", stageNumber };
  return { resultType: "gc", stageNumber: ONE_DAY_RESULT_STAGE };
}

/**
 * Hører rækken til denne etapes placeringer? Rank-agnostisk: kalderen vælger
 * selv rank 1 (vinder) eller top-3 (podie). En 'gc'-række på et etapeløbs
 * sidste etape giver altid false.
 */
export function isRaceStageResultRow(row: RaceResultRowLike | null | undefined, ref: RaceStageRef): boolean {
  if (!row || row.race_id !== ref.raceId) return false;
  const slot = raceResultSlot(ref.raceType, ref.stageNumber);
  return row.result_type === slot.resultType && (row.stage_number ?? 1) === slot.stageNumber;
}

/** Kun de rækker der er denne etapes placeringer (se isRaceStageResultRow). */
export function raceStageResultRows<T extends RaceResultRowLike>(
  rows: readonly T[] | null | undefined,
  ref: RaceStageRef,
): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => isRaceStageResultRow(row, ref));
}

/**
 * Del dagens etaper op i højst to afgrænsede forespørgsler: én 'stage'-
 * forespørgsel for etapeløbene (deres egne etapenumre) og én 'gc'-forespørgsel
 * for endagsløbene (stage_number 1). Hver gruppe filtreres på race_id-liste +
 * stage_number-liste + result_type, og kalderen lægger rank-filteret på, så
 * svaret altid er et lille, kendt antal rækker (PostgREST-loftet, #5589). Et
 * etapeløb kommer aldrig i 'gc'-gruppen, så databasen returnerer slet ikke den
 * række der kunne forveksles med etapevinderen.
 */
export function planRaceResultQueries(refs: Iterable<RaceStageRef>): RaceResultQueryGroup[] {
  const byType = new Map<RaceResultType, { raceIds: Set<string>; stageNumbers: Set<number> }>();
  for (const ref of refs) {
    const slot = raceResultSlot(ref.raceType, ref.stageNumber);
    let group = byType.get(slot.resultType);
    if (!group) {
      group = { raceIds: new Set(), stageNumbers: new Set() };
      byType.set(slot.resultType, group);
    }
    group.raceIds.add(ref.raceId);
    group.stageNumbers.add(slot.stageNumber);
  }
  const order: RaceResultType[] = ["stage", "gc"];
  return order.flatMap((resultType) => {
    const group = byType.get(resultType);
    if (!group) return [];
    return [{
      resultType,
      raceIds: [...group.raceIds],
      stageNumbers: [...group.stageNumbers].sort((a, b) => a - b),
    }];
  });
}
