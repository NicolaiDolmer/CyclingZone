// Flag for traeningssidens "Dagens beslutning"-kort oeverst paa Today-fanen
// (#6110 S26). Moenster kopieret fra trainingBulkDayFlag.js.
//
// ON  = kortet staar over overblikket med 1-3 forslag og en Use-knap pr. forslag.
// OFF = siden er PRAECIS som den staar paa main i dag.
//
// Startstadiet er `off` (migrationen): ejeren flytter flaget til beta efter at
// have set aegte billeder. Beta-status laeses SERVER-SIDE (isViewerBetaTester i
// routes/api.js); svaret er en bar boolean. Fail-safe: ukendt vaerdi = false.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_DECISION_FLAG_KEY = "training_decision_card";

export async function isTrainingDecisionEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_DECISION_FLAG_KEY), opts);
}
