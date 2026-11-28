// #8604 (spec v1-v3 27/11): kontakten for trend-prognosen i sit eget modul, så læsestien
// (potentialEstimateRead.js) kan spørge den uden at importere hele beregningen.
//
// ON  = egne ryttere med en forberedt række i rider_prognosis_trend får trend-prognosen.
// OFF = intet læses ud over kontakten, og prognosen er præcis som før #8604.
//
// Fail-safe: manglende række, "off", "beta", ukendt værdi eller fejl → false
// (featureStage.js uden en bruger). Ejer-only flip.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const PROGNOSIS_TREND_FLAG_KEY = "prognosis_trend_8604";

export async function isPrognosisTrendEnabled(supabase) {
  return evaluateFlagStage(await readFlagStage(supabase, PROGNOSIS_TREND_FLAG_KEY));
}
