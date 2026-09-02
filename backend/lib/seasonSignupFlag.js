// [epic #4592 del 3] "Tilmeld dig næste sæson"-knap (#452) + parkerings-
// forberedelsen (del 2). ÉT fælles flag styrer BEGGE dele: knappen på
// Dashboard OG parkerings-kaldet i sæsonskifte-cutoveren (processSeasonEnd).
// Bor i app_config (key/value) → flippes runtime uden re-deploy, samme
// mønster som poolReseedFlag.js/seasonEndMovementFlag.js.
//
// DEFAULT = OFF. Fail-safe: manglende nøgle, ukendt værdi eller fejlet
// opslag → false → ingen ændring i spilleroplevelsen og INGEN parkering ved
// cutover. Denne PR flipper IKKE flaget — det kræver ejer-go efter S3-
// dry-run-rapporten er gennemgået (checkliste-punkt i #4592).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const SEASON_SIGNUP_FLAG_KEY = "season_signup_enabled";

/** True kun ved eksplicit 'on' (eller 'beta' + isBetaTester) i app_config. */
export async function isSeasonSignupEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, SEASON_SIGNUP_FLAG_KEY), opts);
}
