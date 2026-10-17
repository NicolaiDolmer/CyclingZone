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
 * #6740 (regel B, ejer 16/10): et hold der kun er under gulvet fordi udtagne ryttere
 * blev skadet efter udtagelsen, starter med de raske det har tilbage (mindst 1, efter
 * at assistenten har fyldt op med frie). Spejler raceFieldIntegrity.injuryShortTeamIds.
 *
 * @param {{ entryCount?: number, injuredEntryCount?: number, freeEligibleCount?: number,
 *   stagesCompleted?: number, inField?: boolean|null, withdrawn?: boolean }} args
 *   entryCount: RASKE udtagne. injuredEntryCount: skadede udtagne (motoren fjerner dem ved start).
 *   inField: efter start, er holdet i det faktiske startfelt? null = ukendt (fejler mod "stiller op").
 * @returns {{ starts: boolean, min: number, reason: null|"withdrawn"|"did_not_start"|"below_min" }}
 */
export function teamWillStart({ entryCount = 0, injuredEntryCount = 0, freeEligibleCount = 0, stagesCompleted = 0, inField = null, withdrawn = false } = {}) {
  const min = MIN_RACE_ENTRIES;
  if (withdrawn === true) return { starts: false, min, reason: "withdrawn" };
  if ((Number(stagesCompleted) || 0) > 0) {
    return inField === false ? { starts: false, min, reason: "did_not_start" } : { starts: true, min, reason: null };
  }
  const picked = Math.max(0, Number(entryCount) || 0);
  const free = Math.max(0, Number(freeEligibleCount) || 0);
  const injured = Math.max(0, Number(injuredEntryCount) || 0);
  const shortByInjury = injured > 0 && picked < min && picked + injured >= min && picked + free >= 1;
  const starts = picked + free >= min || shortByInjury;
  return { starts, min, reason: starts ? null : "below_min" };
}

/**
 * #6740: for startede løb — står holdet i det faktiske startfelt? Map<raceId, boolean>.
 * Kilden er det frosne startfelt (race_simulation_runs.entrant_snapshot for etape 1,
 * #1844): det rummer også ryttere der udgik eller kom ind uden for tidsgrænsen på
 * etape 1, som race_results udelader. Holdet er med, hvis en af dets tilmeldte ryttere
 * står i snapshottet. Et startet løb uden snapshot (legacy) falder tilbage til
 * rytterens etape-1-række i race_results ("stage" i etapeløb, "gc" i endagsløb).
 * Kaster ved DB-fejl; kalderne er best-effort og fejler mod "stiller op".
 */
export async function loadTeamsInStartedField({ supabase, raceIds, teamId }) {
  const ids = [...new Set((raceIds ?? []).filter(Boolean))];
  const out = new Map(ids.map((id) => [id, false]));
  if (!ids.length || !teamId) return out;
  // pagination-safe: etape 1 for få løb (ét snapshot pr. løb) og ét holds tilmeldinger.
  const [runsRes, entriesRes] = await Promise.all([
    supabase.from("race_simulation_runs").select("race_id, entrant_snapshot").eq("stage_number", 1).in("race_id", ids),
    supabase.from("race_entries").select("race_id, rider_id").eq("team_id", teamId).in("race_id", ids),
  ]);
  if (runsRes.error) throw new Error(`race_simulation_runs (started field): ${runsRes.error.message ?? runsRes.error}`);
  if (entriesRes.error) throw new Error(`race_entries (started field): ${entriesRes.error.message ?? entriesRes.error}`);
  const snapshotByRace = new Map();
  for (const run of runsRes.data ?? []) {
    if (!Array.isArray(run?.entrant_snapshot)) continue;
    snapshotByRace.set(run.race_id, new Set(run.entrant_snapshot.map((x) => (typeof x === "string" ? x : x?.rider_id)).filter(Boolean)));
  }
  for (const entry of entriesRes.data ?? []) {
    if (snapshotByRace.get(entry.race_id)?.has(entry.rider_id)) out.set(entry.race_id, true);
  }
  const legacyIds = ids.filter((id) => !snapshotByRace.has(id));
  if (legacyIds.length) {
    // pagination-safe: ét hold, etape 1, to rækketyper — højst én trup (≤ 9) pr. løb.
    const { data, error } = await supabase.from("race_results").select("race_id")
      .eq("team_id", teamId).eq("stage_number", 1).in("result_type", ["stage", "gc"]).in("race_id", legacyIds);
    if (error) throw new Error(`race_results (started field): ${error.message ?? error}`);
    for (const row of data ?? []) out.set(row.race_id, true);
  }
  return out;
}
