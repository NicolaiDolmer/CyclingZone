// #7644 (ejer-valg B 4/11): kontakten for loftet paa samlingens gevinst pr. km paa
// lange nedkoersler i v4-motoren (mechanics/descentRegroup6486.ts).
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// descent_regroup_cap_7644 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket. Samme moenster som
// queen_stage_gap_7236: kontakten aendrer loebsresultater, saa der findes ingen
// beta-tilstand, og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation
// (stage-by-stage) i raceRunner.resolveRaceEngineV4. Vaerdien indgaar i
// run-identiteten (input_checksum) og i motor-argumenterne, saa genafspilningen
// (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const DESCENT_REGROUP_CAP_7644_FLAG_KEY = "descent_regroup_cap_7644";

/** Kun den eksakte streng "on" taender. */
export function evaluateDescentRegroupCap7644Flag(value) {
  return value === "on";
}

export async function isDescentRegroupCap7644Enabled(supabase) {
  return evaluateDescentRegroupCap7644Flag(await readFlagStage(supabase, DESCENT_REGROUP_CAP_7644_FLAG_KEY));
}
