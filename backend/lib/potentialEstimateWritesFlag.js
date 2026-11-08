// #7685 (Udvikling 2.0 trin 5): kontakten for skrivningen af gemte potentiale-skøn.
//
// ON  = søndagsjobbet, holdskifte-sweepet og nye kig skriver i
//       rider_potential_estimates (potentialEstimateWriter.js).
// OFF = ingen af dem læser eller skriver noget ud over selve flag-opslaget.
//
// Ikke spiller-synlig: ingen flade læser tabellen endnu, og flaget står derfor
// ikke i PLAYER_VISIBLE_FLAG_KEYS. Skrivning sker for alle hold på én gang, så
// "beta" betyder slukket (ingen `engineWrite`).
//
// Fail-safe: manglende/ukendt værdi eller fejl → false (featureStage.js).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const POTENTIAL_ESTIMATE_WRITES_FLAG_KEY = "potential_estimate_writes";

export async function isPotentialEstimateWritesEnabled(supabase) {
  return evaluateFlagStage(await readFlagStage(supabase, POTENTIAL_ESTIMATE_WRITES_FLAG_KEY));
}
