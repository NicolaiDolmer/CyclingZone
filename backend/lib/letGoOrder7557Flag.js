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
// Kontakten rammer KUN loeb der ikke er startet: raceRunner stempler races.let_go_order_7557
// ved foerste etape-claim (raceStartStamp.js), og et stemplet loeb koerer faerdigt med reglen.
// Et loeb uden stempel koerer videre uden, ogsaa selvom kontakten er taendt. Vaerdien "stop"
// er ejerens noedstop for stemplede loeb.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4. Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { isRaceStampEmergencyStop, readRaceStamp, stampRaceAtFirstClaim } from "./raceStartStamp.js";

export const LET_GO_ORDER_7557_FLAG_KEY = "let_go_order_7557";

/** Kun den eksakte streng "on" taender. */
export function evaluateLetGoOrder7557Flag(value) {
  return value === "on";
}

export async function isLetGoOrder7557Enabled(supabase) {
  return evaluateLetGoOrder7557Flag(await readFlagStage(supabase, LET_GO_ORDER_7557_FLAG_KEY));
}

function withoutMarker(v4Engine) {
  const { letGoOrder7557: _dropped, ...rest } = v4Engine;
  return rest;
}

/**
 * Afgoer om loebet koerer med ordren der vinder, og returnerer motoren derefter. Markeringen
 * fra resolveRaceEngineV4 er kun et forslag; stemplet paa loebet afgoer.
 */
export async function bindLetGoOrder7557({ supabase, race, v4Engine, rulesRevision, firstStageClaim, dryRun = false, readStage = readFlagStage }) {
  if (!v4Engine) return v4Engine;
  const proposed = v4Engine.letGoOrder7557 === true;
  if (!isS5ProfilesV3OrLater(rulesRevision)) return proposed ? withoutMarker(v4Engine) : v4Engine;
  const column = LET_GO_ORDER_7557_FLAG_KEY;
  const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column });
  if (missingColumn) return proposed ? withoutMarker(v4Engine) : v4Engine;
  if (stamped) {
    if (proposed) return v4Engine;
    const stopped = await isRaceStampEmergencyStop({ supabase, flagKey: column, readStage });
    return stopped ? v4Engine : { ...v4Engine, letGoOrder7557: true };
  }
  if (!proposed) return v4Engine;
  const bound = await stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun });
  return bound ? v4Engine : withoutMarker(v4Engine);
}
