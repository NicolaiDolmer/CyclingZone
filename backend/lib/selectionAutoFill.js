// backend/lib/selectionAutoFill.js
// #2180 — "one-click auto-udtag": ren udvælgelses-kerne for ÉT holds trup til ÉT
// løb, når manageren selv beder assistenten om at udfylde den (indbakke-knappen
// på 36t-varslet, selectionWarningSweep.js).
//
// Genbruger assignTeamAcrossRaces (raceEntryGenerator.js) — SAMME motor som Race
// Hub's eksisterende dag-scopede "Auto-udfyld"-endpoint (POST /races/distribution/
// regenerate), bare skalet ned til ét løb. Det giver os GRATIS: 1-rytter-1-løb-pr-
// dag-bindingen (via lockedWindows — holdets ANDRE committede løb), skade-/
// eligibility-filtrering (kalderansvar, samme #1307/#2637-mønster som raceRunner
// fillMissingTeamEntries), og S3-strategipræferencen (aChain/captains), så
// "assistenten" opfører sig konsistent med resten af spillet frem for at opfinde
// en ny, uafhængig autopick-sti.
//
// Ren funktion — al I/O (riders/abilities/stages/binding/strategy) ligger hos
// kalderen (routes/api.js), så denne fil kan testes uden DB.

import { assignTeamAcrossRaces } from "./raceEntryGenerator.js";
import { selectionSizeForRace } from "./raceAutopick.js";

/**
 * @param {object} args
 * @param {Array<{rider_id:string, abilities:object, fatigue?:number}>} args.candidateRiders
 *   Holdets allerede eligibility- + skade-filtrerede ryttere MED en ability-række
 *   (ryttere uden abilities kan ikke scores — udelukkes af kalderen, samme
 *   mønster som raceRunner.fillMissingTeamEntries).
 * @param {{id:string, race_class?:string}} args.race
 * @param {Array} [args.stages]  race_stage_profiles-rækker (demand_vector pr. etape)
 * @param {{start:number,end:number}|null} [args.thisWindow]  løbets binding-vindue
 *   (raceBinding.raceBindingWindow — game_day eller CET-ordinal-rum)
 * @param {Array<{window:{start,end}, riderIds:string[]}>} [args.lockedWindows]
 *   holdets ANDRE committede løb (loadTeamBindingContext(...).otherRaces har
 *   præcis denne facon) — forhindrer at en rytter dobbeltbookes på tværs af løb.
 * @param {object|null} [args.strategy]  loadTeamStrategy(...)-resultat, eller null.
 * @returns {Array<{rider_id:string, race_role:string}>} tom hvis ingen egnede ryttere.
 */
export function pickAutoSelection({ candidateRiders = [], race, stages = [], thisWindow = null, lockedWindows = [], strategy = null }) {
  if (!race?.id) return [];
  const picksByRace = assignTeamAcrossRaces({
    riders: candidateRiders,
    races: [{ race_id: race.id, window: thisWindow, stages, sizeRule: selectionSizeForRace(race) }],
    lockedWindows,
    strategy,
  });
  return picksByRace[race.id] || [];
}
