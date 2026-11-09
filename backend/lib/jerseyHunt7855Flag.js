// #7855: kontakten for troejejagten i etapeplanen, opgaverne "Hent point i spurterne" og
// "Hent bjergpoint" (stagePlan.ts JERSEY_HUNT_TASKS, motor: mechanics/jerseyHunt7855.ts).
// Samme binding som #7730 (teamChase7730Flag.js), saa et loeb aldrig skifter regler midt i.
//
// API'et (raceTeamOrdersApi/stagePlanApi) tager kun imod opgaverne, naar loebet vil koere med
// dem: kontakten er "on" og loebet er ikke startet, eller loebet er allerede stemplet
// (jerseyHunt7855OpenForRace). Et stemplet loeb med "stop" tager ikke laengere imod dem.
//
// Virker KUN under s5_profiles_v3 (og senere), KUN naar app_config-raekken jersey_hunt_7855
// har vaerdien "on", og KUN for loeb der ikke var startet, da kontakten blev taendt. Alt
// andet (raekken mangler, "off", "beta", boolean true fra gammelt skema, opslagsfejl) =
// slukket. Kontakten aendrer loebsresultater, saa der findes ingen beta-tilstand, og en
// fejl maa aldrig taende den.
//
// Samme regel som enkeltstartens kontakt (ittNoDayRoll7726Flag.js, ejer 6/11): races.jersey_hunt_7855
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

export const JERSEY_HUNT_7855_FLAG_KEY = "jersey_hunt_7855";
export const JERSEY_HUNT_7855_EMERGENCY_STOP = "stop";

/** Kun den eksakte streng "on" taender. */
export function evaluateJerseyHunt7855Flag(value) {
  return value === "on";
}

export async function isJerseyHunt7855Enabled(supabase) {
  return evaluateJerseyHunt7855Flag(await readFlagStage(supabase, JERSEY_HUNT_7855_FLAG_KEY));
}

/** Noedstop kun ved den eksakte vaerdi; en opslagsfejl maa aldrig aendre et loeb i gang. */
async function isEmergencyStop7855(supabase, readStage) {
  return Promise.resolve()
    .then(() => readStage(supabase, JERSEY_HUNT_7855_FLAG_KEY))
    .then((value) => value === JERSEY_HUNT_7855_EMERGENCY_STOP, () => false);
}

/** Kun "kolonnen findes ikke" (migrationen er ikke applied); alt andet er en rigtig fejl. */
function isMissingColumn7855(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (!message.includes(JERSEY_HUNT_7855_FLAG_KEY)) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find/i.test(message);
}

/** Et endagsloeb giver ingen passagepoint (racePassages, passagesFromV4Output): opgaven ville koste uden at give noget. */
function isStageRace7855(row) {
  return row?.race_type === "stage_race";
}

function withoutMarker(v4Engine) {
  const { jerseyHunt7855: _dropped, ...rest } = v4Engine;
  return rest;
}

/**
 * Afgoer om troejejagten gaelder i dette loeb, og returnerer motoren derefter: med
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
export async function bindJerseyHunt7855({ supabase, race, v4Engine, rulesRevision, firstStageClaim, dryRun = false, readStage = readFlagStage }) {
  if (!v4Engine) return v4Engine;
  const proposed = v4Engine.jerseyHunt7855 === true;
  if (!isS5ProfilesV3OrLater(rulesRevision)) return proposed ? withoutMarker(v4Engine) : v4Engine;

  const readRow = async () => supabase
    .from("races")
    // schema-columns-ok: jersey_hunt_7855 tilfoejes af database/2026-11-07-7855-race-jersey-hunt-binding.sql;
    // foer den er applied, falder laesningen bevidst tilbage til slukket (isMissingColumn7855).
    .select("jersey_hunt_7855, stages_completed, race_type")
    .eq("id", race.id)
    .maybeSingle();
  const { data: row, error } = await readRow();
  if (error) {
    if (isMissingColumn7855(error)) return proposed ? withoutMarker(v4Engine) : v4Engine;
    throw new Error(`race ${race.id}: jersey_hunt_7855 kunne ikke laeses (${error.message})`);
  }
  if (row?.jersey_hunt_7855 === true) {
    if (proposed) return v4Engine;
    return (await isEmergencyStop7855(supabase, readStage)) ? v4Engine : { ...v4Engine, jerseyHunt7855: true };
  }
  if (!proposed) return v4Engine;

  const stagesCompleted = row?.stages_completed ?? race.stages_completed ?? null;
  const canBind = firstStageClaim === true && isStageRace7855(row) && !raceHasStarted({ id: race.id, stages_completed: stagesCompleted });
  if (!canBind) return withoutMarker(v4Engine);
  if (dryRun) return v4Engine;

  const { error: bindError } = await supabase
    .from("races")
    // schema-columns-ok: se laesningen ovenfor.
    .update({ jersey_hunt_7855: true })
    .eq("id", race.id)
    .is("jersey_hunt_7855", null)
    .eq("stages_completed", 0);
  if (bindError) {
    if (isMissingColumn7855(bindError)) return withoutMarker(v4Engine);
    throw new Error(`race ${race.id}: jersey_hunt_7855 kunne ikke bindes (${bindError.message})`);
  }
  const { data: after, error: rereadError } = await readRow();
  if (rereadError) throw new Error(`race ${race.id}: jersey_hunt_7855 kunne ikke genlaeses (${rereadError.message})`);
  // Er loebet startet imens, er det den gemte vaerdi der gaelder, aldrig den vi ville skrive.
  return after?.jersey_hunt_7855 === true ? v4Engine : withoutMarker(v4Engine);
}

/**
 * Tager etapeplanen imod troejejagtens opgaver i dette loeb? Kun naar loebet vil koere med dem:
 *  - loebet er stemplet (kontakten var taendt ved foerste etape), og vaerdien er ikke "stop", eller
 *  - kontakten er "on", og loebet er ikke startet (stemplet saettes ved foerste etape-claim).
 * Revisionen (s5_profiles_v3) tjekker kalderen (stagePlanRevisionOk). Enhver fejl = false: en
 * opgave motoren ikke vil koere, maa aldrig kunne gemmes.
 */
export async function jerseyHunt7855OpenForRace({ supabase, race, readStage = readFlagStage }) {
  try {
    const value = await readStage(supabase, JERSEY_HUNT_7855_FLAG_KEY);
    const { data: row, error } = await supabase
      .from("races")
      // schema-columns-ok: se bindJerseyHunt7855; uden kolonnen er loebet ikke omfattet.
      .select("jersey_hunt_7855, stages_completed, race_type")
      .eq("id", race.id)
      .maybeSingle();
    if (error) return false;
    if (row?.jersey_hunt_7855 === true) return value !== JERSEY_HUNT_7855_EMERGENCY_STOP;
    return evaluateJerseyHunt7855Flag(value) && isStageRace7855(row) && !raceHasStarted({ id: race.id, stages_completed: row?.stages_completed ?? race.stages_completed ?? null });
  } catch {
    return false; // catch-ok: fail closed, opgaverne kan ikke gemmes
  }
}
