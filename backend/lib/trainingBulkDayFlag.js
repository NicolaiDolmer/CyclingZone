// Flag for traeningssidens "saet dagen for flere ryttere paa een gang" (#6523).
// Moenster kopieret fra trainingMobileTableFlag.js.
//
// ON  = desktop-fanen Today viser altid vaerktoejslinjen "Set today's day for
//       [scope] to [session]" (scope = alle i visningen naar intet er markeret),
//       "Set for group" paa hver gruppe-overskrift og en forklaring paa
//       Today/R1-R5-overskriften.
// OFF = fanen er PRAECIS som den staar paa main i dag.
//
// Intet fjernes i nogen af stadierne; flaget gater kun hvad der kommer til.
// Startstadiet er `off` (migrationen), fordi ejeren skal se aegte billeder foer
// beta. Beta-status laeses SERVER-SIDE (isViewerBetaTester i routes/api.js) og
// er aldrig noget klienten sender — svaret er en bar boolean.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl giver false (featureStage.js),
// dvs. den gamle visning.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_BULK_DAY_FLAG_KEY = "training_bulk_day";

export async function isTrainingBulkDayEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_BULK_DAY_FLAG_KEY), opts);
}
