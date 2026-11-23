// #8521: akademiets P-params bag XP-kontakten.
//
// Eget modul, så potentialP6110.js og akademi-generatoren forbliver rene og ikke trækker
// kontakt-, privat-config- og træningskæden med sig (heller ikke for typecheckeren).
//
// Kaldestederne (søndagens årgang) sender resultatet ind som `potentialP` i
// generateAcademyCandidates. null = dagens akademi, bit-identisk.

import { isDevelopmentXpEnabled } from "./developmentXpFlag.ts";
import { readPrivateConfigEntry } from "./privateConfig.ts";
import { POTENTIAL_P_PARAMS_KEY, validatePotentialPParams } from "./potentialP6110.js";

const LOG_TAG = "[potential-p]";

/**
 * Akademiets P-params, når XP-kontakten er tændt og talfilen er gyldig og har
 * academyDecay. Ellers null = dagens akademi. Logger aldrig tallene.
 * @param {{ supabase: { from(table: string): any }, log?: Pick<Console, "warn">, now?: () => number }} args
 * @returns {Promise<import("./potentialP6110.js").PotentialPParams|null>}
 */
export async function loadAcademyPotentialP({ supabase, log = console, now = Date.now }) {
  if (!(await isDevelopmentXpEnabled(supabase))) return null;
  const entry = await readPrivateConfigEntry(supabase, POTENTIAL_P_PARAMS_KEY, {
    log, now, schema: validatePotentialPParams,
  });
  const params = entry.status === "ok" ? /** @type {import("./potentialP6110.js").PotentialPParams} */ (entry.value) : null;
  if (!params || params.academyDecay === undefined) {
    log?.warn?.(`${LOG_TAG} development_xp_model is on, but ${POTENTIAL_P_PARAMS_KEY} is ${params ? "missing academyDecay" : entry.status} - academy keeps today's stars only`);
    return null;
  }
  return params;
}
