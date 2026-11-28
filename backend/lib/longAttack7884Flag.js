// #7884/#8828: kontakten for "Angrib paa <sted>" i etapeplanen (langt angreb fra foden af den
// valgte stigning). Kontrakten bor i tacticAttackTrigger7884.js, motorens regel i
// engine/v4/mechanics/longAttack7884.ts og tilslutningen i stagePlanEngine.ts.
//
// Virker KUN under s5_profiles_v3 (og senere) og KUN naar app_config-raekken long_attack_7884 har
// vaerdien "on". Alt andet (raekken mangler, "off", "beta", boolean true fra gammelt skema,
// opslagsfejl) = slukket. Kontakten aendrer loebsresultater, saa der findes ingen beta-tilstand,
// og en fejl maa aldrig taende den.
//
// Samme startstempel som #8799/#8180 (raceStartStamp.js): races.long_attack_7884 stemples ved
// loebets FOERSTE etape-claim, naar kontakten er taendt, og senere etaper laeser stemplet. Stemplet
// laeses FOER kontakten (Fable 26/11, #8801): et stemplet loeb koerer faerdigt med reglen, ogsaa hvis
// kontakten slukkes eller et opslag fejler; et loeb der allerede koerer, skifter aldrig regler midt i
// loebet. Vaerdien "stop" er ejerens noedstop for stemplede loeb (fra naeste etape).
//
// API'et tager kun imod stederne, naar loebet vil koere med dem (longAttack7884OpenForRaceStamped):
// stemplet og ikke "stop", eller kontakten "on" og loebet ikke startet.
//
// Vaerdien indgaar i run-identiteten (input_checksum) og i motor-argumenterne, saa genafspilningen
// (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater, raceHasStarted } from "./raceEngineRulesRevision.ts";
import { RACE_STAMP_EMERGENCY_STOP, isRaceStampEmergencyStop, readRaceStamp, stampRaceAtFirstClaim } from "./raceStartStamp.js";
import { LONG_ATTACK_7884_FLAG_KEY, evaluateLongAttack7884Flag } from "./tacticAttackTrigger7884.js";

export { LONG_ATTACK_7884_FLAG_KEY };

export async function isLongAttack7884Enabled(supabase) {
  return evaluateLongAttack7884Flag(await readFlagStage(supabase, LONG_ATTACK_7884_FLAG_KEY));
}

function withoutMarker(v4Engine) {
  const { longAttack7884: _dropped, ...rest } = v4Engine;
  return rest;
}

/**
 * Afgoer om loebet koerer med "Angrib paa"-stederne, og returnerer motoren derefter. Markeringen
 * fra resolveRaceEngineV4 er kun et forslag (kontakten var "on" ved afviklingens start); stemplet
 * paa loebet afgoer. Samme kontrakt som bindHillySelection8799:
 *  - Aeldre revision end s5_profiles_v3 -> uden markering, intet DB-kald.
 *  - Stemplet -> med markering (retry, genstart og senere etaper), ogsaa naar kontakten er
 *    slukket. Kun "stop" fjerner den.
 *  - Ikke stemplet, ingen forslag -> samme objekt, intet skrives.
 *  - Ikke stemplet + forslag + foerste etape-claim paa et ikke-startet loeb -> stempl atomisk.
 *  - Kolonnen findes ikke (migrationen er ikke applied) -> uden markering, intet skrives.
 *  - Andre DB-fejl kaster: etapen maa hellere vente end koere paa de forkerte regler.
 */
export async function bindLongAttack7884({ supabase, race, v4Engine, rulesRevision, firstStageClaim, dryRun = false, readStage = readFlagStage }) {
  if (!v4Engine) return v4Engine;
  const proposed = v4Engine.longAttack7884 === true;
  if (!isS5ProfilesV3OrLater(rulesRevision)) return proposed ? withoutMarker(v4Engine) : v4Engine;
  const column = LONG_ATTACK_7884_FLAG_KEY;
  const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column });
  if (missingColumn) return proposed ? withoutMarker(v4Engine) : v4Engine;
  if (stamped) {
    if (proposed) return v4Engine;
    const stopped = await isRaceStampEmergencyStop({ supabase, flagKey: column, readStage });
    return stopped ? v4Engine : { ...v4Engine, longAttack7884: true };
  }
  if (!proposed) return v4Engine;
  const bound = await stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun });
  return bound ? v4Engine : withoutMarker(v4Engine);
}

/**
 * Tager etapeplanen imod stederne i dette loeb? Kun naar loebet vil koere med dem: stemplet og ikke
 * "stop", eller kontakten "on" og loebet ikke startet (stemplet saettes ved foerste etape-claim).
 * Revisionen (s5_profiles_v3) tjekker kalderen. Enhver fejl = false: en ordre motoren ikke vil
 * koere, maa aldrig kunne gemmes.
 */
export async function longAttack7884OpenForRaceStamped({ supabase, race, readStage = readFlagStage }) {
  try {
    const value = await readStage(supabase, LONG_ATTACK_7884_FLAG_KEY);
    const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column: LONG_ATTACK_7884_FLAG_KEY });
    if (missingColumn) return false;
    if (stamped) return value !== RACE_STAMP_EMERGENCY_STOP;
    return evaluateLongAttack7884Flag(value) && !raceHasStarted({ id: race.id, stages_completed: stagesCompleted });
  } catch {
    return false; // catch-ok: fail closed, stederne kan ikke gemmes
  }
}
