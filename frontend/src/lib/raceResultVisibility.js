// #3333 — Resultat-hubbens to flader (Seneste-fanens kort + CompletedRacesExplorer)
// brugte hver sit prædikat for "har resultater at vise": Seneste-fanen krævede
// status==='completed', CompletedRacesExplorer accepterede også race_results-rækker
// (r.results?.length > 0 || r.status === "completed"). Ingen af dem kendte til
// etapeløbs sande "i gang"-markør: status forbliver 'scheduled' under HELE
// afviklingen — kun stages_completed er en pålidelig "i gang"-markør (se
// backend/lib/stageRaceTransferDefer.js). Et etapeløb med fx 14 af 21 etaper kørt
// var derfor usynligt begge steder (Vuelta Ibérica, verificeret mod prod 2026-08-04).
//
// raceHasReportableResults er det ENE delte prædikat for "har løbet resultater at
// vise", brugt af BEGGE flader. Bygger på deriveRaceStatus (raceHubLogic.js) — den
// samme "completed"/"live"/"scheduled"-afledning Dashboard/RaceArchiveTable/
// RaceDetailPage allerede bruger — så der ikke opstår en fjerde definition.

import { deriveRaceStatus } from "./raceHubLogic.js";

/**
 * @param {{status?: string|null, stages_completed?: number|null, stages?: number|null}} race
 * @returns {boolean} true når løbet er færdigt ELLER har mindst én kørt etape.
 */
export function raceHasReportableResults(race) {
  const view = deriveRaceStatus(race?.status, race?.stages_completed, race?.stages);
  return view === "completed" || view === "live";
}

/**
 * Er løbet stadig i gang (mindst én, men ikke alle, etaper kørt)? Adskiller
 * "kørt-status"-badgen fra færdige løb — et igangværende etapeløb må ALDRIG
 * præsenteres som afsluttet (#3333 accept-kriterie).
 * @param {{status?: string|null, stages_completed?: number|null, stages?: number|null}} race
 * @returns {boolean}
 */
export function raceIsInProgress(race) {
  return deriveRaceStatus(race?.status, race?.stages_completed, race?.stages) === "live";
}
