// #6009 · "1 rytter = 1 loeb pr. loebsdag" (#4209) skal ogsaa holde mod loebsdage
// rytteren ALLEREDE HAR KOERT.
//
// HULLET. Bindingen (race_entry_days + race_entries.binding_span og EXCLUDE-
// constrainten no_rider_double_booking) frigives naar et loeb faar status
// `completed` (race_entry_days_rebuild). Et etapeloebs SIDSTE etape kan dele
// loebsdag med et andet loebs FOERSTE etape (forskellige klokkeslaet, samme
// game_day). Afsluttes det foerste loeb tidligt paa loebsdagen, er rytteren
// "fri" for den loebsdag, og en udtagelse til det andet loeb gaar igennem alle
// tre lag (app-preflight, RPC-guard, DB-constraint). Resultat: to etaperesultater
// paa samme loebsdag og en traeningsdato der ikke kan afregnes.
//
// Bindingen er desuden HOLD-scopet (race_entry_days.team_id); en rytter der skifter
// hold midt i saesonen bringer ikke sin koerte loebsdag med. Dette tjek er derfor
// RYTTER-scopet: kilden er race_results ⋈ race_stage_schedule (samme kilde som
// traeningsmotorens etape-opslag, raceDayStageLookup.js), og den forsvinder aldrig.
//
// FEJL-KONTRAKT: returnerer { data: Set<riderId>|null, error }. Kalderen afgoer om
// en fejl skal afvise (fail-closed) eller ignoreres.

/**
 * Ren del: hvilke ryttere har et etaperesultat paa en loebsdag inden for spaendet?
 *
 * @param {object} args
 * @param {{start: number, end: number}} args.span  loebets loebsdags-spaend (inkl.)
 * @param {Array<{race_id: string, stage_number: number, game_day: number|null}>} args.scheduleRows
 * @param {Array<{rider_id: string, race_id: string, stage_number: number, result_type: string}>} args.resultRows
 * @param {Set<string>} [args.singleRaceIds]  endagsloeb (gc-resultatet er loebsdagen)
 * @returns {Set<string>}
 */
export function ridersWithStageInSpan({ span, scheduleRows = [], resultRows = [], singleRaceIds = new Set() }) {
  const out = new Set();
  if (!span) return out;
  const key = (raceId, stageNumber) => `${raceId}:${Number(stageNumber)}`;
  const daysByStage = new Map(scheduleRows
    .filter((row) => Number.isFinite(row?.game_day))
    .map((row) => [key(row.race_id, row.stage_number), Number(row.game_day)]));
  for (const row of resultRows) {
    if (!row?.rider_id) continue;
    if (!(row.result_type === "stage" || (row.result_type === "gc" && singleRaceIds.has(row.race_id)))) continue;
    const day = daysByStage.get(key(row.race_id, row.stage_number));
    if (day !== undefined && day >= span.start && day <= span.end) out.add(row.rider_id);
  }
  return out;
}

/**
 * Slaa op hvilke af `riderIds` allerede har koert en etape (i et ANDET loeb i samme
 * saeson) paa en loebsdag inden for `race`'s spaend.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {{id: string, season_id: string}} args.race
 * @param {string[]} args.riderIds
 * @returns {Promise<{data: Set<string>|null, error: unknown}>}
 */
export async function loadRidersAlreadyRacedInSpan({ supabase, race, riderIds }) {
  if (!race?.id || !race?.season_id || !riderIds?.length) return { data: new Set(), error: null };
  try {
    // Loebets eget spaend (pagination-safe: <= 21 etaper).
    const { data: ownStages, error: ownError } = await supabase
      .from("race_stage_schedule").select("game_day").eq("race_id", race.id);
    if (ownError) return { data: null, error: ownError };
    const days = (ownStages ?? []).map((row) => row?.game_day).filter((day) => Number.isFinite(day));
    if (!days.length || days.length !== (ownStages ?? []).length) return { data: new Set(), error: null };
    const span = { start: Math.min(...days), end: Math.max(...days) };

    // Rytternes etaperesultater i saesonen, i andre loeb. pagination-safe: de udtagne
    // ryttere (en trup) x en saesons etaper pr. rytter, langt under 1000.
    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select("rider_id, race_id, stage_number, result_type, races!inner(season_id, race_type)")
      .in("rider_id", riderIds)
      .in("result_type", ["stage", "gc"])
      .eq("races.season_id", race.season_id)
      .neq("race_id", race.id);
    if (resultsError) return { data: null, error: resultsError };
    const resultRows = results ?? [];
    if (!resultRows.length) return { data: new Set(), error: null };

    const raceIds = [...new Set(resultRows.map((row) => row.race_id))];
    const singleRaceIds = new Set(resultRows.filter((row) => row.races?.race_type === "single").map((row) => row.race_id));
    // pagination-safe: de koerte loeb (faa pr. rytter) x etaper paa spaendets loebsdage.
    const { data: scheduleRows, error: scheduleError } = await supabase
      .from("race_stage_schedule")
      .select("race_id, stage_number, game_day")
      .in("race_id", raceIds)
      .gte("game_day", span.start)
      .lte("game_day", span.end);
    if (scheduleError) return { data: null, error: scheduleError };

    return { data: ridersWithStageInSpan({ span, scheduleRows: scheduleRows ?? [], resultRows, singleRaceIds }), error: null };
  } catch (err) {
    // best-effort HER, ikke hos kalderen: fejlen RETURNERES (data: null = "ved det
    // ikke"), og prepareSelectionChange afviser udtagelsen (fail-closed).
    return { data: null, error: err };
  }
}
