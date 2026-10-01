// backend/lib/peakTargetScope.js
// #5992: hvad formplanlæggeren må pege på, og hvem den planlægger for.
//
// To huller fandt en spiller 30/9 ("It shouldn't suggest you plan peak for
// races that has already been done" + "why is it showing U23 and junior
// riders?"):
//
// 1. Kandidat-løbene blev kun filtreret på STARTDATO >= i dag. Pakkeren lægger
//    flere løbsdage inden i én kalenderdag (docs/CALENDAR_RULES.md §1), så et
//    løb med startdato i dag kan være kørt færdigt længe før midnat og stod
//    stadig som forslag og som valgbart mål. "Startet" afgøres her med samme
//    definition som resten af løbskalenderen bruger (frontend
//    raceHubLogic.deriveRaceStatus + youthSelectionOpen, /selection-frysningen
//    #1825): status er ikke længere 'scheduled', eller mindst én etape er kørt.
//
// 2. Boardet hentede HELE holdet, ungdomstrupperne inklusive. Peak-mål er
//    seniorkalenderens løb (boardets races er senior-scopet, #5517), og dem
//    kører en U23-/juniorrytter ikke. Trup-afgørelsen går gennem det fælles
//    prædikat (squads.isSeniorSquadRider), aldrig en lokal kopi.
//
// Bevidst dependency-let (kun squads.js), så både api.js og tests kan bruge den.

import { isSeniorSquadRider, isYouthSquad, ACADEMY_SQUAD_WHEN_AGE_UNKNOWN, SENIOR_SQUAD_COLUMNS } from "./squads.js";

/** Kolonner en races-query skal projicere for at `peakTargetRaceStarted` kan svare. */
export const PEAK_TARGET_RACE_COLUMNS = Object.freeze(["status", "stages_completed"]);

/** Kolonner en riders-query skal projicere for at `plannerSquadFor` kan svare. */
export const PLANNER_RIDER_SQUAD_COLUMNS = SENIOR_SQUAD_COLUMNS;

/**
 * Er løbet startet (eller kørt færdigt)? Så kan det ikke længere være et NYT
 * peak-mål. En manglende status behandles som 'scheduled' (ældre rækker/mocks);
 * et ugyldigt etape-tal behandles defensivt som startet.
 *
 * @param {{status?:string|null, stages_completed?:number|string|null}|null|undefined} race
 * @returns {boolean}
 */
export function peakTargetRaceStarted(race) {
  if (!race) return true;
  if (race.status != null && race.status !== "scheduled") return true;
  const raw = race.stages_completed;
  if (raw === null || raw === undefined) return false;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return true;
  return n > 0;
}

/**
 * Rytterens trup set fra planlæggeren: "senior" når det fælles senior-prædikat
 * siger ja, ellers ungdomstruppen. En akademirytter uden gyldig `squad` (før
 * backfill) får samme fallback som akademi-placeringen bruger.
 *
 * @param {{squad?:string|null, is_academy?:boolean|null}|null|undefined} rider
 * @returns {"senior"|"u23"|"junior"}
 */
export function plannerSquadFor(rider) {
  if (isSeniorSquadRider(rider)) return "senior";
  return isYouthSquad(rider?.squad) ? rider.squad : ACADEMY_SQUAD_WHEN_AGE_UNKNOWN;
}
