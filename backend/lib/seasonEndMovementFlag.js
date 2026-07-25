// #2851 · Engangs-gate for S1→S2-pyramide-komprimeringen. Bor i app_config
// (key/value) → flippes runtime UDEN re-deploy. Når 'on' springer
// processSeasonEnd divisions-flytningen (processDivisionEnd) OG AI-fyld-sweepen
// (reconcileAiTeamsForPool) over — komprimeringen (scripts/compressPyramid.js)
// ER flytningen i det skifte og kører sit eget reconcile bagefter.
//
// Fail-safe: manglende nøgle/fejl → false → motorens NORMALE op/nedrykning
// (ejer-gate-krav 25/7: "fail-safe default = motorens adfærd"). Nøglen sættes
// 'on' i drejebogens skridt 3 og skal tilbage til 'off' EFTER skiftet, så
// S2→S3 kører motorens regler igen (#2164).
//
// Spejler autoCalendarFlag.js præcist: ét DB-opslag pr. kald (season-end er en
// sjælden handling), returnerer ALTID boolean via evaluateFlagStage.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const SEASON_END_SKIP_MOVEMENT_FLAG_KEY = "season_end_skip_division_movement";

export async function isSeasonEndDivisionMovementSkipped(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, SEASON_END_SKIP_MOVEMENT_FLAG_KEY), opts);
}
