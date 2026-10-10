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
// Et løb der allerede er i gang røres ikke: gulvet afgjorde hvem der stillede op da
// første etape blev kørt, og assistenten top-fylder aldrig et igangværende løb (#1825).
//
// Ren funktion, ingen I/O. Kaster aldrig.

import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

/**
 * @param {{ entryCount?: number, freeEligibleCount?: number, stagesCompleted?: number }} args
 * @returns {{ starts: boolean, min: number }}
 */
export function teamWillStart({ entryCount = 0, freeEligibleCount = 0, stagesCompleted = 0 } = {}) {
  const min = MIN_RACE_ENTRIES;
  if ((Number(stagesCompleted) || 0) > 0) return { starts: true, min };
  const picked = Math.max(0, Number(entryCount) || 0);
  const free = Math.max(0, Number(freeEligibleCount) || 0);
  return { starts: picked + free >= min, min };
}
