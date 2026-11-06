// #7730: kontakten for at jagt-gulvets maal afgoeres af de hold der jager, ikke af etapens
// lodtraekning (mechanics/chaseGroup.ts judgeFloorChase7730).
//
// Virker KUN under s5_profiles_v3 (og senere), KUN naar app_config-raekken team_chase_7730
// har vaerdien "on", og KUN for loeb der ikke var startet, da kontakten blev taendt. Alt
// andet (raekken mangler, "off", "beta", boolean true fra gammelt skema, opslagsfejl) =
// slukket. Kontakten aendrer loebsresultater, saa der findes ingen beta-tilstand, og en
// fejl maa aldrig taende den.
//
// Samme regel som enkeltstartens kontakt (ittNoDayRoll7726Flag.js, ejer 6/11): races.team_chase_7730
// stemples ved loebets FOERSTE etape-claim, og senere etaper laeser stemplet. Et loeb uden
// stempel er ikke omfattet, ogsaa selvom kontakten er taendt.
//
// Slukkes kontakten igen, gaelder det kun nye loeb: et stemplet loeb koerer faerdigt med
// sine regler, ogsaa ved en opslagsfejl. Vaerdien "stop" er ejerens noedstop og fjerner
// reglen fra stemplede loeb fra naeste etape. Den bruges kun paa ejerens ord.
//
// Vaerdien indgaar i run-identiteten (input_checksum) og i motor-argumenterne, saa
// genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater, raceHasStarted } from "./raceEngineRulesRevision.ts";

export const TEAM_CHASE_7730_FLAG_KEY = "team_chase_7730";
export const TEAM_CHASE_7730_EMERGENCY_STOP = "stop";

/** Kun den eksakte streng "on" taender. */
export function evaluateTeamChase7730Flag(value) {
  return value === "on";
}

export async function isTeamChase7730Enabled(supabase) {
  return evaluateTeamChase7730Flag(await readFlagStage(supabase, TEAM_CHASE_7730_FLAG_KEY));
}

/** Noedstop kun ved den eksakte vaerdi; en opslagsfejl maa aldrig aendre et loeb i gang. */
async function isEmergencyStop7730(supabase, readStage) {
  return Promise.resolve()
    .then(() => readStage(supabase, TEAM_CHASE_7730_FLAG_KEY))
    .then((value) => value === TEAM_CHASE_7730_EMERGENCY_STOP, () => false);
}

/** Kun "kolonnen findes ikke" (migrationen er ikke applied); alt andet er en rigtig fejl. */
function isMissingColumn7730(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (!message.includes(TEAM_CHASE_7730_FLAG_KEY)) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find/i.test(message);
}

function withoutMarker(v4Engine) {
  const { teamChase7730: _dropped, ...rest } = v4Engine;
  return rest;
}

/**
 * Afgoer om jagten afgoeres af holdene i dette loeb, og returnerer motoren derefter: med
 * markeringen hvis loebet er bundet til kontakten, ellers uden.
 *
 *  - v3-motor -> samme objekt, intet DB-kald.
 *  - Aeldre revision end s5_profiles_v3 -> uden markering, intet DB-kald.
 *  - Loebet er stemplet -> med markering (retry, genstart og senere etaper), ogsaa naar
 *    kontakten er slukket. Kun vaerdien "stop" fjerner den.
 *  - Kontakten er slukket og loebet er ikke stemplet -> samme objekt, intet skrives.
 *  - Ikke stemplet + foerste etape-claim paa et ikke-startet loeb -> stempl atomisk, og
 *    genlaes, saa to samtidige claims altid ender paa samme gemte vaerdi.
 *  - Ellers (startet loeb) -> uden markering, intet skrives.
 *  - Kolonnen findes ikke (migrationen er ikke applied) -> uden markering, intet skrives.
 *  - Andre DB-fejl kaster: etapen maa hellere vente end koere paa de forkerte regler.
 *  - dryRun skriver aldrig; et ikke-startet loeb previewes med kontakten.
 */
export async function bindTeamChase7730({ supabase, race, v4Engine, rulesRevision, firstStageClaim, dryRun = false, readStage = readFlagStage }) {
  if (!v4Engine) return v4Engine;
  const proposed = v4Engine.teamChase7730 === true;
  if (!isS5ProfilesV3OrLater(rulesRevision)) return proposed ? withoutMarker(v4Engine) : v4Engine;

  const readRow = async () => supabase
    .from("races")
    // schema-columns-ok: team_chase_7730 tilfoejes af database/2026-11-06-7730-race-team-chase-binding.sql;
    // foer den er applied, falder laesningen bevidst tilbage til slukket (isMissingColumn7730).
    .select("team_chase_7730, stages_completed")
    .eq("id", race.id)
    .maybeSingle();
  const { data: row, error } = await readRow();
  if (error) {
    if (isMissingColumn7730(error)) return proposed ? withoutMarker(v4Engine) : v4Engine;
    throw new Error(`race ${race.id}: team_chase_7730 kunne ikke laeses (${error.message})`);
  }
  if (row?.team_chase_7730 === true) {
    if (proposed) return v4Engine;
    return (await isEmergencyStop7730(supabase, readStage)) ? v4Engine : { ...v4Engine, teamChase7730: true };
  }
  if (!proposed) return v4Engine;

  const stagesCompleted = row?.stages_completed ?? race.stages_completed ?? null;
  const canBind = firstStageClaim === true && !raceHasStarted({ id: race.id, stages_completed: stagesCompleted });
  if (!canBind) return withoutMarker(v4Engine);
  if (dryRun) return v4Engine;

  const { error: bindError } = await supabase
    .from("races")
    // schema-columns-ok: se laesningen ovenfor.
    .update({ team_chase_7730: true })
    .eq("id", race.id)
    .is("team_chase_7730", null)
    .eq("stages_completed", 0);
  if (bindError) {
    if (isMissingColumn7730(bindError)) return withoutMarker(v4Engine);
    throw new Error(`race ${race.id}: team_chase_7730 kunne ikke bindes (${bindError.message})`);
  }
  const { data: after, error: rereadError } = await readRow();
  if (rereadError) throw new Error(`race ${race.id}: team_chase_7730 kunne ikke genlaeses (${rereadError.message})`);
  // Er loebet startet imens, er det den gemte vaerdi der gaelder, aldrig den vi ville skrive.
  return after?.team_chase_7730 === true ? v4Engine : withoutMarker(v4Engine);
}
