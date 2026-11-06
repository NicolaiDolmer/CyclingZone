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
// Laeses een gang pr. etape-invokation i raceRunner.simulateStageByIndex, kun fra etape 2.
// Selve feltet staar i entrant_snapshot og i motorens input, saa genafspilningen (#1857)
// ikke behoever kontakten.

import { readFlagStage } from "./featureStage.js";

export const STARTED_FIELD_LOCK_7733_FLAG_KEY = "started_field_lock_7733";

/** Kun den eksakte streng "on" taender. */
export function evaluateStartedFieldLock7733Flag(value) {
  return value === "on";
}

export async function isStartedFieldLock7733Enabled(supabase) {
  return evaluateStartedFieldLock7733Flag(await readFlagStage(supabase, STARTED_FIELD_LOCK_7733_FLAG_KEY));
}
