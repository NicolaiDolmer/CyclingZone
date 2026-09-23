// #5327 — kontakten for rytter-generatorens PRIMÆRE type-kilde.
//
// ON  = nye ryttere trækker deres primære type tier-uafhængigt fra
//       archetypeDistribution.js' DEFAULT_DISTRIBUTION ("distribution").
// OFF = præcis dagens adfærd: tier-aware TIER_TYPE_WEIGHTS ("tier").
//
// Kontakten læses ÉN gang pr. allokering ved de tre kaldesteder, der skaber
// ryttere med fictionalRiderGenerator.js, og sendes ned som `primaryTypeMode`:
//   - starterSquadAllocator.js  (start-trupper: single-team + relaunch)
//   - aiTeamGenerator.js        (nye AI-hold)
//   - relaunchOrchestrator.js   (launch-populationen via fictionalLaunchPopulation.js)
// Generatoren selv rører ingen DB og kan derfor ikke slå flaget op.
//
// `beta` giver IKKE distribution her. Stadiet `beta` betyder "kun beta-testere
// ser det", men en genereret rytter er synlig for alle og har ingen viewer at
// spørge. Kun `on` (eller legacy `true`) tænder kontakten.
//
// Fail-safe: manglende række, ukendt værdi eller læsefejl → "tier" (dagens
// adfærd). En kontakt der ikke kan læses, må aldrig flytte type-fordelingen.
//
// NØGLEN står som strengliteral i DENNE fil med vilje: stadie-flag-kataloget
// (stageFlagCatalog.js) finder nøgler ved at scanne efter en literal i samme
// fil som evaluateFlagStage-kaldet. Den er identisk med generatorens
// PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY, og testen for denne fil fejler hvis
// de to nogensinde glider fra hinanden.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { PRIMARY_TYPE_MODE_TIER, PRIMARY_TYPE_MODE_DISTRIBUTION } from "./fictionalRiderGenerator.js";

export const PRIMARY_TYPE_MODE_FLAG_KEY = "rider_primary_type_from_distribution";

/** True kun ved eksplicit `on`/true i app_config. Alt andet (inkl. fejl) = false. */
export async function isPrimaryTypeFromDistributionEnabled(supabase) {
  return evaluateFlagStage(await readFlagStage(supabase, PRIMARY_TYPE_MODE_FLAG_KEY));
}

/**
 * Den `primaryTypeMode` generatoren skal kaldes med lige nu.
 * @param {object} supabase
 * @returns {Promise<"tier"|"distribution">} aldrig andet end de to
 */
export async function readPrimaryTypeMode(supabase) {
  try {
    return (await isPrimaryTypeFromDistributionEnabled(supabase))
      ? PRIMARY_TYPE_MODE_DISTRIBUTION
      : PRIMARY_TYPE_MODE_TIER;
  } catch {
    return PRIMARY_TYPE_MODE_TIER;
  }
}
