// #7236 (ejer 4/11): kontakten for dronningeetapernes topgab-loft i v4-motoren.
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// queen_stage_gap_7236 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket. Strengere end
// evaluateFlagStage med vilje, som day_form_6649: kontakten aendrer loebsresultater,
// saa der findes ingen beta-tilstand, og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation
// (stage-by-stage) i raceRunner.resolveRaceEngineV4. Vaerdien indgaar i
// run-identiteten (input_checksum) og i motor-argumenterne, saa genafspilningen
// (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const QUEEN_STAGE_GAP_7236_FLAG_KEY = "queen_stage_gap_7236";

/** Kun den eksakte streng "on" taender. */
export function evaluateQueenStageGap7236Flag(value) {
  return value === "on";
}

export async function isQueenStageGap7236Enabled(supabase) {
  return evaluateQueenStageGap7236Flag(await readFlagStage(supabase, QUEEN_STAGE_GAP_7236_FLAG_KEY));
}
