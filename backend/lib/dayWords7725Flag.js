// #7725 (ejer 5/11): kontakten for dagsformen i ord efter etapen.
//
// Virker KUN naar #6649-dagsformen selv koerte, og KUN naar app_config-raekken
// day_words_7725 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket.
//
// Kontakten aendrer ingen resultater, kun hvad tidslinjen fortaeller bagefter. Laeses
// een gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage) i
// raceRunner.resolveRaceEngineV4.

import { readFlagStage } from "./featureStage.js";

export const DAY_WORDS_7725_FLAG_KEY = "day_words_7725";

/** Kun den eksakte streng "on" taender. */
export function evaluateDayWords7725Flag(value) {
  return value === "on";
}

export async function isDayWords7725Enabled(supabase) {
  return evaluateDayWords7725Flag(await readFlagStage(supabase, DAY_WORDS_7725_FLAG_KEY));
}
