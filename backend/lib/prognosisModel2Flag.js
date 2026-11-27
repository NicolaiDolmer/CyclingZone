// #8604/#8810: kontakten prognosis_model2 i sit eget modul, så skrivningen af potentiale-
// skøn (potentialEstimateWriter.js) kan spørge den uden en cirkulær import via Model 2-
// beregningen, som selv importerer skrivningen.
//
// ON  = Model 2-prognosen og første skøn fra dag ét (egne ryttere uden for akademiet,
//       timesweepet for egne ryttere uden række, Læres indtil skønnet er skrevet).
// OFF = alt det ovenfor er slukket, og adfærden er som før #8604.
//
// Fail-safe: manglende række, "off", "beta", ukendt værdi eller fejl → false
// (featureStage.js uden en bruger).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const PROGNOSIS_MODEL2_FLAG_KEY = "prognosis_model2";

export async function isPrognosisModel2Enabled(supabase) {
  return evaluateFlagStage(await readFlagStage(supabase, PROGNOSIS_MODEL2_FLAG_KEY));
}
