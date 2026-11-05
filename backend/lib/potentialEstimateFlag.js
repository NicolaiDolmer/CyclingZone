// #7684 (#6110 byggetrin 4): kontakten for én prognose-kilde.
//
// ON  = estimates, scouting-rapporten, development-projection og akademiet svarer
//       fra det gemte skøn (potentialEstimateRead.js).
// OFF = alle fire svarer præcis som i dag, og ingen af dem slår et skøn op.
//
// Egen nøgle med vilje: potential_single_number er pensioneret og står on i prod.
// Fail-safe: manglende/ukendt værdi eller fejl = off (featureStage.js).
// Stadie `beta` = kun beta-testere/admin. Rent visning: motoren læser ikke flaget.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY = "potential_estimate_display";

// `viewerIsBeta` er en funktion, ikke en boolean: beta-status koster et bruger-opslag,
// og estimates kaldes af næsten alle flader. Det opslag sker kun på stadie `beta`.
// `now` er uret bag flag-cachen; tests giver et fast ur, produktionen bruger default.
export async function isPotentialEstimateDisplayEnabled(supabase, { viewerIsBeta, now } = {}) {
  const stage = await readFlagStage(supabase, POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY, { now });
  const isBetaTester = stage === "beta" && viewerIsBeta ? (await viewerIsBeta()) === true : false;
  return evaluateFlagStage(stage, { isBetaTester });
}
