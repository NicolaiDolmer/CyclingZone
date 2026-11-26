// #8180 (ejer 26/11): kontakten for formtoppens optakt over ALLE traeningsraekker.
//
// Fejlen: peak-signalet (racePeakPlans.loadTeamTrainingRuns) laeser holdenes training_day_runs i
// eet kald uden sortering og uden paginering. PostgREST afkorter ved sit raekkeloft, saa i store
// felter faar de sidste hold i id-raekkefoelge ingen optakt, og deres formtop regnes paa et tomt
// traeningsgrundlag. Taendt: optakten laeses side for side i en fast raekkefoelge, saa alle hold
// faar alle deres raekker.
//
// Virker KUN naar app_config-raekken peak_leadup_all_rows_8180 har vaerdien "on". Alt andet (raekken
// mangler, "off", "beta", boolean true fra gammelt skema, opslagsfejl) = slukket. Kontakten aendrer
// motorens input, saa der findes ingen beta-tilstand, og en fejl maa aldrig taende den.
//
// Kontakten rammer KUN loeb der ikke er startet (samme kontrakt som #7733, raceStartStamp.js):
// foerste etape-claim stempler races.peak_leadup_all_rows_8180, naar kontakten er taendt, og
// etaperne derefter laeser stemplet. Et stemplet loeb koerer faerdigt med den hele optakt, ogsaa hvis
// kontakten slukkes; et loeb der allerede koerer, skifter aldrig input midt i loebet. Vaerdien "stop"
// er ejerens noedstop for stemplede loeb. Traeningskvaliteten staar i input_checksum
// (serializePeakInputs) og i motorens input, saa genafspilningen (#1857) ikke behoever kontakten.

import { readFlagStage } from "./featureStage.js";
import { isRaceStampEmergencyStop, readRaceStamp, stampRaceAtFirstClaim } from "./raceStartStamp.js";

export const PEAK_LEADUP_ALL_ROWS_8180_FLAG_KEY = "peak_leadup_all_rows_8180";

/** Kun den eksakte streng "on" taender. */
export function evaluatePeakLeadupAllRows8180Flag(value) {
  return value === "on";
}

export async function isPeakLeadupAllRows8180Enabled(supabase) {
  return evaluatePeakLeadupAllRows8180Flag(await readFlagStage(supabase, PEAK_LEADUP_ALL_ROWS_8180_FLAG_KEY));
}

/**
 * Skal dette loeb (denne etape) laese hele optakten?
 *
 * Foerste etape-claim: stempl loebet, hvis kontakten er taendt (fejl i opslaget = slukket).
 * Senere etaper, retries og genoptagelser: laes stemplet; kun "stop" fjerner det igen.
 * En laesefejl paa stemplet kaster (raceStartStamp.js), saa etapen hellere venter end koerer paa
 * det forkerte input. dryRun skriver aldrig.
 *
 * @returns {Promise<boolean>}
 */
export async function resolvePeakLeadupAllRows8180({
  supabase, race, firstStageClaim, dryRun = false,
  checkEnabled = isPeakLeadupAllRows8180Enabled, readStage = readFlagStage,
}) {
  const column = PEAK_LEADUP_ALL_ROWS_8180_FLAG_KEY;
  // Fable 26/11: laes STEMPLET foerst. Et allerede stemplet loeb (fx en genkoersel af etape 1, der
  // ogsaa er et "foerste claim") skal koere med hele optakten uanset kontaktens tilstand, ellers
  // kunne etape 1 koere paa den afkortede laesning og etape 2+ paa alle raekker.
  const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column });
  if (stamped) return !(await isRaceStampEmergencyStop({ supabase, flagKey: column, readStage }));
  if (firstStageClaim !== true || missingColumn) return false;
  const enabled = await Promise.resolve().then(() => checkEnabled(supabase)).catch(() => false);
  if (enabled !== true) return false;
  return stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun });
}
