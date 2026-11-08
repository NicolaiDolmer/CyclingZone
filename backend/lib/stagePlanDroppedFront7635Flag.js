// #7635 + #7636 (ejer-go 4/11, loesning A): kontakten for etapeplanens "sat"-regel.
//
// Taendt: kun en rigtig opdeling af feltet taeller som fronten, naar motoren afgoer om en
// rytter med etapeplan er sat (stagePlanEngine.ts), og etapeplanens resume krydstjekker
// rytterens gruppe i filmen (frontend StagePlanModel.stagePlanRecap).
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// stage_plan_dropped_front_7635 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket. Samme strenghed som
// queen_stage_gap_7236: kontakten aendrer loebsresultater, saa der findes ingen beta-tilstand,
// og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4. Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY = "stage_plan_dropped_front_7635";

/** Kun den eksakte streng "on" taender. */
export function evaluateStagePlanDroppedFront7635Flag(value) {
  return value === "on";
}

export async function isStagePlanDroppedFront7635Enabled(supabase) {
  return evaluateStagePlanDroppedFront7635Flag(await readFlagStage(supabase, STAGE_PLAN_DROPPED_FRONT_7635_FLAG_KEY));
}
