// #7557: kontakten for at spillerens gemte "lad andre jage" vinder over motorens egen jagt.
//
// Taendt: et hold hvis manager selv har gemt "lad gaa" for etapen, jager ikke: ingen
// forebyggende GC-reaktion, ingen snor og ingen automatisk etapeinteresse. Andre hold
// overtager pladsen i etapeinteressen. Et holds standard-"lad gaa" (rolle/M14) er uaendret.
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// let_go_order_7557 har vaerdien "on". Alt andet (raekken mangler, "off", "beta", boolean
// true fra gammelt skema, opslagsfejl) = slukket. Samme strenghed som
// queen_stage_gap_7236: kontakten aendrer loebsresultater, saa der findes ingen
// beta-tilstand, og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4. Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const LET_GO_ORDER_7557_FLAG_KEY = "let_go_order_7557";

/** Kun den eksakte streng "on" taender. */
export function evaluateLetGoOrder7557Flag(value) {
  return value === "on";
}

export async function isLetGoOrder7557Enabled(supabase) {
  return evaluateLetGoOrder7557Flag(await readFlagStage(supabase, LET_GO_ORDER_7557_FLAG_KEY));
}
