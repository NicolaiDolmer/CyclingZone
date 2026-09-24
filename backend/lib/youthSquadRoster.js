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

import { effectiveSquad, SQUAD_CAPS } from "./squads.js";
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
 * Svaret fra GET /api/youth-squads: rytter-id'er + loft pr. ungdomstrup.
 *
 * #5631: loftet var bevidst udeladt (SQUAD_CAPS var "kun et sim-startpunkt,
 * P11"), men SQUAD_CAPS er live siden #5626 (u23: 12, junior: 10) og
 * begrænser akademiet reelt. Begrundelsen var forældet — se
 * docs/YOUTH_RULES.md. `caps` kommer direkte fra squads.js' SQUAD_CAPS,
 * ingen ny konstant.
 *
 * @param {Array<object>} riders
 * @param {number|null|undefined} seasonNumber
 */
export function buildYouthSquadsPayload(riders, seasonNumber) {
  const grouped = groupYouthSquads(riders, seasonNumber);
  const squads = {};
  const caps = {};
  for (const key of YOUTH_SQUAD_PAGE_KEYS) {
    squads[key] = { riderIds: grouped[key] };
    caps[key] = SQUAD_CAPS[key];
  }
  return { seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null, squads, caps };
}
