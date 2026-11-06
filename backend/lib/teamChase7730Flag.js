// #7730: kontakten for at jagt-gulvets maal afgoeres af de hold der jager, ikke af etapens
// lodtraekning (mechanics/chaseGroup.ts judgeFloorChase7730).
//
// Virker KUN under s5_profiles_v3 (og senere), KUN naar app_config-raekken team_chase_7730
// har vaerdien "on", og KUN for et loeb der ikke var startet da flaget blev taendt: loebet
// bindes ved sin foerste etape-claim (raceRunner.bindRaceTeamChase7730). Alt andet (raekken
// mangler, "off", "beta", boolean true fra gammelt skema, opslagsfejl) = slukket. Kontakten
// aendrer loebsresultater, saa der findes ingen beta-tilstand, og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4. Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const TEAM_CHASE_7730_FLAG_KEY = "team_chase_7730";

/** Kun den eksakte streng "on" taender. */
export function evaluateTeamChase7730Flag(value) {
  return value === "on";
}

export async function isTeamChase7730Enabled(supabase) {
  return evaluateTeamChase7730Flag(await readFlagStage(supabase, TEAM_CHASE_7730_FLAG_KEY));
}
