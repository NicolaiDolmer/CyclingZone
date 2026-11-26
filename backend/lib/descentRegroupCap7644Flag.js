// #7644 (ejer-valg B 4/11): kontakten for loftet paa samlingens gevinst pr. km paa
// lange nedkoersler i v4-motoren (mechanics/descentRegroup6486.ts).
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken
// descent_regroup_cap_7644 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket. Samme moenster som
// queen_stage_gap_7236: kontakten aendrer loebsresultater, saa der findes ingen
// beta-tilstand, og en fejl maa aldrig taende den.
//
// STARTSTEMPEL (ejer 26/11, "Byg stempel, taend ved S6"): kontakten rammer KUN loeb der
// ikke er startet. raceRunner stempler races.descent_regroup_cap_7644 ved loebets FOERSTE
// etape-claim (raceStartStamp.js, samme kontrakt som #7557/#7726/#7730), og senere etaper
// laeser stemplet i stedet for kontakten. Et igangvaerende etapeloeb skifter derfor aldrig
// regler midt i loebet: uden stempel koerer det videre uden loftet, ogsaa selvom kontakten
// er taendt. Et stemplet loeb koerer faerdigt med loftet, ogsaa hvis kontakten slukkes
// eller et opslag fejler. Vaerdien "stop" er ejerens noedstop for stemplede loeb.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4; markeringen derfra er kun et forslag, stemplet afgoer
// (bindDescentRegroupCap7644). Vaerdien indgaar i run-identiteten (input_checksum) og i
// motor-argumenterne, saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { isRaceStampEmergencyStop, readRaceStamp, stampRaceAtFirstClaim } from "./raceStartStamp.js";

export const DESCENT_REGROUP_CAP_7644_FLAG_KEY = "descent_regroup_cap_7644";

/** Kun den eksakte streng "on" taender. */
export function evaluateDescentRegroupCap7644Flag(value) {
  return value === "on";
}

export async function isDescentRegroupCap7644Enabled(supabase) {
  return evaluateDescentRegroupCap7644Flag(await readFlagStage(supabase, DESCENT_REGROUP_CAP_7644_FLAG_KEY));
}

function withoutMarker(v4Engine) {
  const { descentRegroupCap7644: _dropped, ...rest } = v4Engine;
  return rest;
}

/**
 * Afgoer om loebet koerer med loftet, og returnerer motoren derefter: med markeringen hvis
 * loebet er bundet til kontakten, ellers uden.
 *
 *  - v3-motor -> samme objekt, intet DB-kald.
 *  - Aeldre revision end s5_profiles_v3 -> uden markering, intet DB-kald.
 *  - Loebet er stemplet -> med markering (retry, genstart og senere etaper), ogsaa naar
 *    kontakten er slukket. Kun vaerdien "stop" fjerner den.
 *  - Kontakten er slukket og loebet er ikke stemplet -> samme objekt, intet skrives.
 *  - Ikke stemplet + foerste etape-claim paa et ikke-startet loeb -> stempl atomisk og genlaes.
 *  - Ellers (startet loeb) -> uden markering, intet skrives.
 *  - Kolonnen findes ikke (migrationen er ikke applied) -> uden markering, intet skrives.
 *  - Andre DB-fejl kaster: etapen maa hellere vente end koere paa de forkerte regler.
 *  - dryRun skriver aldrig; et ikke-startet loeb previewes med loftet.
 */
export async function bindDescentRegroupCap7644({ supabase, race, v4Engine, rulesRevision, firstStageClaim, dryRun = false, readStage = readFlagStage }) {
  if (!v4Engine) return v4Engine;
  const proposed = v4Engine.descentRegroupCap7644 === true;
  if (!isS5ProfilesV3OrLater(rulesRevision)) return proposed ? withoutMarker(v4Engine) : v4Engine;
  const column = DESCENT_REGROUP_CAP_7644_FLAG_KEY;
  const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column });
  if (missingColumn) return proposed ? withoutMarker(v4Engine) : v4Engine;
  if (stamped) {
    if (proposed) return v4Engine;
    const stopped = await isRaceStampEmergencyStop({ supabase, flagKey: column, readStage });
    return stopped ? v4Engine : { ...v4Engine, descentRegroupCap7644: true };
  }
  if (!proposed) return v4Engine;
  const bound = await stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun });
  return bound ? v4Engine : withoutMarker(v4Engine);
}
