// #5519: hvem staar paa U23 team- og Junior team-siden?
//
// Ren funktion (ingen DB), saa trup-siderne og testene deler EEN afgoerelse.
// Truppen afgoeres af effectiveSquad (squads.js), ikke af et frontend-gaet:
//
//   • riders.squad er sandheden naar den bærer en ungdomstrup.
//   • I overgangsvinduet foer backfill'en (ejer-gated, #4619) staar ALLE ryttere
//     med squad = 'senior'; en akademirytter placeres da ud fra sin SAESONALDER
//     (ageForSeason, riderSeasonAge.js er SSOT). En akademirytter der er fyldt
//     23 er stadig U23 indtil Graduation Day flytter ham (squads.js'
//     academySquadForSeasonAge).
//
// Frontend'en maa ALDRIG selv regne truppen ud af en alder: det ville vaere
// kopi nr. to af aldersgraenserne (samme lektie som #3071/#3081).

import { effectiveSquad } from "./squads.js";
import { ageForSeason } from "./riderSeasonAge.js";

/** De to ungdomstrupper der har en egen side, i menu-raekkefoelge. */
export const YOUTH_SQUAD_PAGE_KEYS = Object.freeze(["u23", "junior"]);

/** Kolonner rytter-queryen SKAL projicere for at effectiveSquad kan svare. */
export const YOUTH_SQUAD_ROSTER_COLUMNS = Object.freeze(["id", "birthdate", "squad", "is_academy"]);

/**
 * Del holdets ryttere op i de to ungdomstrupper.
 *
 * En rytter uden kendt trup (fx akademirytter uden foedselsdato) staar paa
 * ingen af siderne; vi gaetter aldrig en trup.
 *
 * @param {Array<{id:string, birthdate?:string|null, squad?:string|null, is_academy?:boolean}>} riders
 * @param {number|null|undefined} seasonNumber  aktiv saeson (1-baseret)
 * @returns {{u23:string[], junior:string[]}}
 */
export function groupYouthSquads(riders, seasonNumber) {
  const out = { u23: [], junior: [] };
  for (const rider of riders ?? []) {
    if (!rider?.id) continue;
    const squad = effectiveSquad(rider, ageForSeason(rider.birthdate, seasonNumber));
    if (squad === "u23" || squad === "junior") out[squad].push(rider.id);
  }
  return out;
}

/**
 * Svaret fra GET /api/youth-squads: rytter-id'er pr. ungdomstrup.
 *
 * Bevidst UDEN loft: SQUAD_CAPS (squads.js) er et sim-startpunkt, og i dag
 * begraenses akademiet stadig af sine faelles pladser. Et "x/12" paa siden
 * ville love plads der ikke findes endnu (TASTE P11).
 *
 * @param {Array<object>} riders
 * @param {number|null|undefined} seasonNumber
 */
export function buildYouthSquadsPayload(riders, seasonNumber) {
  const grouped = groupYouthSquads(riders, seasonNumber);
  const squads = {};
  for (const key of YOUTH_SQUAD_PAGE_KEYS) squads[key] = { riderIds: grouped[key] };
  return { seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null, squads };
}
