// #8799: én kontakt for selektionen paa kuperet og mellembjerg (#7645, variant 3: jagt med
// aarsag + forsvar) og afslutningen paa kuperet og boelget efter dagens haardhed (#8189, variant C:
// udbrud paa haarde dage + reduceret spurt). Ejer 26/11: de taendes SAMMEN foer S6's foerste loeb.
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// hilly_selection_8799 har vaerdien "on". Alt andet (raekken mangler, "off", "beta", boolean
// true fra gammelt skema, opslagsfejl) = slukket. Kontakten aendrer loebsresultater, saa der
// findes ingen beta-tilstand, og en fejl maa aldrig taende den.
//
// Kontakten rammer KUN loeb der ikke er startet: raceRunner stempler races.hilly_selection_8799
// ved foerste etape-claim (raceStartStamp.js), og et stemplet loeb koerer faerdigt med reglen.
// Et loeb uden stempel koerer videre uden, ogsaa selvom kontakten er taendt. Vaerdien "stop"
// er ejerens noedstop for stemplede loeb (fra naeste etape).
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4. Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { isRaceStampEmergencyStop, readRaceStamp, stampRaceAtFirstClaim } from "./raceStartStamp.js";

export const HILLY_SELECTION_8799_FLAG_KEY = "hilly_selection_8799";

/** Kun den eksakte streng "on" taender. */
export function evaluateHillySelection8799Flag(value) {
  return value === "on";
}

export async function isHillySelection8799Enabled(supabase) {
  return evaluateHillySelection8799Flag(await readFlagStage(supabase, HILLY_SELECTION_8799_FLAG_KEY));
}

function withoutMarker(v4Engine) {
  const { hillySelection8799: _dropped, ...rest } = v4Engine;
  return rest;
}

/**
 * Afgoer om loebet koerer med selektionen og afslutningerne, og returnerer motoren derefter.
 * Markeringen fra resolveRaceEngineV4 er kun et forslag; stemplet paa loebet afgoer.
 */
export async function bindHillySelection8799({ supabase, race, v4Engine, rulesRevision, firstStageClaim, dryRun = false, readStage = readFlagStage }) {
  if (!v4Engine) return v4Engine;
  const proposed = v4Engine.hillySelection8799 === true;
  if (!isS5ProfilesV3OrLater(rulesRevision)) return proposed ? withoutMarker(v4Engine) : v4Engine;
  const column = HILLY_SELECTION_8799_FLAG_KEY;
  const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column });
  if (missingColumn) return proposed ? withoutMarker(v4Engine) : v4Engine;
  if (stamped) {
    // Kontakten er "on" (forslaget staar): loebet koerer videre med reglen. Ellers koerer et
    // stemplet loeb videre med reglen, medmindre ejeren har sat noedstoppet.
    if (proposed) return v4Engine;
    const stopped = await isRaceStampEmergencyStop({ supabase, flagKey: column, readStage });
    return stopped ? v4Engine : { ...v4Engine, hillySelection8799: true };
  }
  if (!proposed) return v4Engine;
  const bound = await stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun });
  return bound ? v4Engine : withoutMarker(v4Engine);
}
