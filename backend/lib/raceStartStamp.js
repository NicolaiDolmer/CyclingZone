// #7557/#7733: faelles stempel for kontakter der kun maa ramme loeb, der ikke er startet.
//
// Ejerens standard: et loeb koeres faerdigt med de regler, det startede med. Derfor stemples
// en boolean-kolonne paa races ved loebets FOERSTE etape-claim, naar kontakten er taendt, og
// senere etaper laeser stemplet i stedet for kontakten. Samme kontrakt som #7726 og #7730:
//
//  - Et stemplet loeb koerer faerdigt, ogsaa hvis kontakten slukkes eller et opslag fejler.
//  - Vaerdien "stop" er ejerens noedstop og fjerner reglen fra naeste etape.
//  - Mangler kolonnen (migrationen er ikke applied), er loebet ikke stemplet, og intet skrives.
//  - Andre DB-fejl kaster: etapen maa hellere vente end koere paa de forkerte regler.

import { readFlagStage } from "./featureStage.js";
import { raceHasStarted } from "./raceEngineRulesRevision.ts";

export const RACE_STAMP_EMERGENCY_STOP = "stop";

function isMissingColumn(error, column) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (!message.includes(column)) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find/i.test(message);
}

/** Laeser stemplet. Kolonnen er kendt kode, aldrig brugerinput. */
export async function readRaceStamp({ supabase, race, column }) {
  const { data, error } = await supabase
    .from("races")
    // schema-columns-ok: kolonnerne tilfoejes af database/2026-11-06-7557-7733-race-start-binding.sql;
    // foer den er applied, falder laesningen bevidst tilbage til ikke stemplet.
    .select(`${column}, stages_completed`)
    .eq("id", race.id)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error, column)) return { stamped: false, missingColumn: true, stagesCompleted: null };
    throw new Error(`race ${race.id}: ${column} kunne ikke laeses (${error.message})`);
  }
  return { stamped: data?.[column] === true, missingColumn: false, stagesCompleted: data?.stages_completed ?? race.stages_completed ?? null };
}

/** Noedstop kun ved den eksakte vaerdi; en opslagsfejl maa aldrig aendre et loeb i gang. */
export async function isRaceStampEmergencyStop({ supabase, flagKey, readStage = readFlagStage }) {
  return Promise.resolve()
    .then(() => readStage(supabase, flagKey))
    .then((value) => value === RACE_STAMP_EMERGENCY_STOP, () => false);
}

/**
 * Stempler et ikke-startet loeb atomisk og genlaeser, saa to samtidige claims ender paa samme
 * gemte vaerdi. Returnerer true, naar loebet er omfattet. dryRun skriver aldrig.
 */
export async function stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun = false }) {
  const canBind = firstStageClaim === true && !raceHasStarted({ id: race.id, stages_completed: stagesCompleted });
  if (!canBind) return false;
  if (dryRun) return true;
  const { error } = await supabase
    .from("races")
    // schema-columns-ok: se readRaceStamp.
    .update({ [column]: true })
    .eq("id", race.id)
    .is(column, null)
    .eq("stages_completed", 0);
  if (error) {
    if (isMissingColumn(error, column)) return false;
    throw new Error(`race ${race.id}: ${column} kunne ikke bindes (${error.message})`);
  }
  return (await readRaceStamp({ supabase, race, column })).stamped;
}
