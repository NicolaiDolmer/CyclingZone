// #7640 (ejer-go 4/11, valg A): kontakten for aarsagen paa et klatre-split der koerer FREM.
//
// Taendt: et split hvor rytteren angriber frem fra sin gruppe paa en stigning faar aarsagen
// "attack" i stedet for "climb_deficit" (mechanics/climbSelection.ts). Kun event-feltet cause
// aendres; grupper, huller, tider og resultater er de samme.
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// split_attack_cause_7640 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket. Samme strenghed som
// queen_stage_gap_7236: kontakten aendrer motorens output, saa der findes ingen beta-tilstand,
// og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4. Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const SPLIT_ATTACK_CAUSE_7640_FLAG_KEY = "split_attack_cause_7640";

/** Kun den eksakte streng "on" taender. */
export function evaluateSplitAttackCause7640Flag(value) {
  return value === "on";
}

export async function isSplitAttackCause7640Enabled(supabase) {
  return evaluateSplitAttackCause7640Flag(await readFlagStage(supabase, SPLIT_ATTACK_CAUSE_7640_FLAG_KEY));
}
