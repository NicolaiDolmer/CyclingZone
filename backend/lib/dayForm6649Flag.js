// #6649 (ejer 27/10): kontakten for dagsformen med forklaring i v4-motoren.
//
// Dagsformen virker KUN under s5_profiles_v3 og KUN naar app_config-raekken
// day_form_6649 har vaerdien "on". Alt andet (raekken mangler, "off", "beta",
// boolean true fra gammelt skema, opslagsfejl) = slukket. Strengere end
// evaluateFlagStage med vilje: dagsformen aendrer loebsresultater, saa der
// findes ingen beta-tilstand, og en fejl maa aldrig taende den.
//
// Laeses een gang pr. afvikling (whole-race) / pr. etape-invokation
// (stage-by-stage) i raceRunner.resolveRaceEngineV4, som race_form_peaks.
// Vaerdien indgaar i run-identiteten (input_checksum) og i motor-argumenterne,
// saa genafspilningen (#1857 engine_input_snapshots) genskaber den.

import { readFlagStage } from "./featureStage.js";

export const DAY_FORM_6649_FLAG_KEY = "day_form_6649";

/** Kun den eksakte streng "on" taender. */
export function evaluateDayForm6649Flag(value) {
  return value === "on";
}

export async function isDayForm6649Enabled(supabase) {
  return evaluateDayForm6649Flag(await readFlagStage(supabase, DAY_FORM_6649_FLAG_KEY));
}
