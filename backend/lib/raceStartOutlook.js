// backend/lib/raceStartOutlook.js
// #5945: PRE-hoc svar på "stiller holdet op i løbet?" til de flader der ellers
// kun kigger på race_entries (trænings-badget "løber i dag", Taktik-fanen).
//
// Ved afvikling fjerner raceRunner hold under startgulvet (filterTeamsBelowMinimumEntries,
// raceFieldIntegrity.js) efter at assistenten har forsøgt at fylde op fra holdets frie
// ryttere (fillMissingTeamEntries). Et hold der hverken har gulvet nu eller kan nå det
// med sine frie ryttere stiller altså ikke op — men står stadig i race_entries.
//
// Reglen er den samme som frontendens partialSquadOutlook (raceSelectionLogic.js):
//   et hold starter ikke hvis udtagne + frie egnede ryttere < MIN_RACE_ENTRIES.
//
// #6740: tre huller lukket. (1) Et afmeldt hold stiller ikke op, men dets entries
// bevares (#4306). (2) Efter start svarede funktionen altid "stiller op"; nu afgør
// det faktiske startfelt det (`inField`, se loadTeamsInStartedField). Et hold der
// blev fjernet ved start (gulvet) stod ellers som deltager hele løbet. (3) Kalderne
// trækker nu skadede udtagne og Train now-låste ryttere fra, samme som raceRunner.
//
// Ren funktion, ingen I/O. Kaster aldrig.

import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

/**
 * @param {{ entryCount?: number, freeEligibleCount?: number, stagesCompleted?: number,
 *   inField?: boolean|null, withdrawn?: boolean }} args
 *   inField: efter start, er holdet i det faktiske startfelt? null = ukendt (fejler mod "stiller op").
 * @returns {{ starts: boolean, min: number, reason: null|"withdrawn"|"did_not_start"|"below_min" }}
 */
export function teamWillStart({ entryCount = 0, freeEligibleCount = 0, stagesCompleted = 0, inField = null, withdrawn = false } = {}) {
  const min = MIN_RACE_ENTRIES;
  if (withdrawn === true) return { starts: false, min, reason: "withdrawn" };
  if ((Number(stagesCompleted) || 0) > 0) {
    return inField === false ? { starts: false, min, reason: "did_not_start" } : { starts: true, min, reason: null };
  }
  const picked = Math.max(0, Number(entryCount) || 0);
  const free = Math.max(0, Number(freeEligibleCount) || 0);
  const starts = picked + free >= min;
  return { starts, min, reason: starts ? null : "below_min" };
}

/**
 * #6740: for startede løb — står holdet i det faktiske startfelt? Map<raceId, boolean>.
 * Kilden er race_results: motoren skriver kun rækker for hold der kørte etape 1, og
 * stages_completed tælles først op efter skrivningen. Løb der ikke er startet kommer
 * ikke i mappet. Kaster ved DB-fejl; kalderne er best-effort og fejler mod "stiller op".
 */
export async function loadTeamsInStartedField({ supabase, raceIds, teamId }) {
  const ids = [...new Set((raceIds ?? []).filter(Boolean))];
  const out = new Map(ids.map((id) => [id, false]));
  if (!ids.length || !teamId) return out;
  // Rytterens etape-1-række: "stage" i etapeløb, "gc" i endagsløb (målt 16/10). Holdrækken
  // alene duer ikke: et hold uden nok ryttere i mål får måske ingen.
  // pagination-safe: ét hold, etape 1, to rækketyper — højst én trup (≤ 9) pr. løb.
  const { data, error } = await supabase.from("race_results").select("race_id")
    .eq("team_id", teamId).eq("stage_number", 1).in("result_type", ["stage", "gc"]).in("race_id", ids);
  if (error) throw new Error(`race_results (started field): ${error.message ?? error}`);
  for (const row of data ?? []) out.set(row.race_id, true);
  return out;
}
