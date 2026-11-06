// #7733: kontakten for det laaste startfelt i et igangvaerende etapeloeb.
//
// Taendt: fra etape 2 spoerger motoren ikke laengere om holdet stadig er i loebets pulje,
// eller om rytteren stadig er i loebets trup. De to regler afgoer hvem der maa STILLE OP,
// ikke hvem der er i loebet (#1825/#1844). En rytter der har forladt holdet, er pensioneret
// eller skadet falder stadig ud som foer.
//
// Virker KUN naar app_config-raekken started_field_lock_7733 har vaerdien "on". Alt andet
// (raekken mangler, "off", "beta", boolean true fra gammelt skema, opslagsfejl) = slukket.
// Kontakten aendrer hvem der koerer, saa der findes ingen beta-tilstand, og en fejl maa
// aldrig taende den.
//
// Kontakten rammer KUN loeb der ikke er startet: foerste etape-claim stempler
// races.started_field_lock_7733, naar kontakten er taendt, og etaperne derefter laeser
// stemplet (raceStartStamp.js). Et stemplet loeb koerer faerdigt med laast felt, ogsaa hvis
// kontakten slukkes. Vaerdien "stop" er ejerens noedstop for stemplede loeb.
// Selve feltet staar i entrant_snapshot og i motorens input, saa genafspilningen (#1857)
// ikke behoever kontakten.

import { readFlagStage } from "./featureStage.js";
import { isRaceStampEmergencyStop, readRaceStamp, stampRaceAtFirstClaim } from "./raceStartStamp.js";

export const STARTED_FIELD_LOCK_7733_FLAG_KEY = "started_field_lock_7733";

/** Kun den eksakte streng "on" taender. */
export function evaluateStartedFieldLock7733Flag(value) {
  return value === "on";
}

export async function isStartedFieldLock7733Enabled(supabase) {
  return evaluateStartedFieldLock7733Flag(await readFlagStage(supabase, STARTED_FIELD_LOCK_7733_FLAG_KEY));
}

/** Foerste etape-claim: stempl loebet, hvis kontakten er taendt. Fejl i opslaget = slukket. */
export async function bindStartedFieldLock7733({ supabase, race, firstStageClaim, dryRun = false, checkEnabled = isStartedFieldLock7733Enabled }) {
  if (firstStageClaim !== true) return false;
  const enabled = await Promise.resolve().then(() => checkEnabled(supabase)).catch(() => false);
  if (enabled !== true) return false;
  const column = STARTED_FIELD_LOCK_7733_FLAG_KEY;
  const { stamped, missingColumn, stagesCompleted } = await readRaceStamp({ supabase, race, column });
  if (missingColumn) return false;
  return stamped || stampRaceAtFirstClaim({ supabase, race, column, stagesCompleted, firstStageClaim, dryRun });
}

/** Fra etape 2: er netop dette loeb stemplet, og er noedstoppet ikke trukket? */
export async function raceHasStartedFieldLock7733({ supabase, race, readStage = readFlagStage }) {
  const column = STARTED_FIELD_LOCK_7733_FLAG_KEY;
  const { stamped } = await readRaceStamp({ supabase, race, column });
  if (!stamped) return false;
  return !(await isRaceStampEmergencyStop({ supabase, flagKey: column, readStage }));
}
