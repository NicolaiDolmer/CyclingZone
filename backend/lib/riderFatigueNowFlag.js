// #7801 PR 2: kontakten for "træthed lige nu" på fladerne og i reglerne.
//
// Tændt: fladerne viser trætheden lige nu (åbningen plus datoens kørte etaper) og et skøn
// ved start af rytterens næste etape. Auto-hvile og træthedsgrænser, skaderisikoen ved
// træning og assistentens udtagelse regner på samme live-tal.
//
// Virker KUN når app_config-rækken fatigue_now_7801 har værdien "on". Alt andet (rækken
// mangler, "off", "beta", boolean true fra gammelt skema, opslagsfejl) = slukket. Kontakten
// ændrer træningens udfald og hvem assistenten udtager, så der findes ingen beta-tilstand,
// og en fejl må aldrig tænde den. Slukket = dagens tal og dagens regler, bit-identisk.
//
// Kun meningsfuld under condition_model_v2: uden den er rider_condition selv det sande tal,
// og live-tallet er åbningen (riderFatigueNow.js læser da ingen ledger).

import { readFlagStage } from "./featureStage.js";

export const FATIGUE_NOW_7801_FLAG_KEY = "fatigue_now_7801";

/** Kun den eksakte streng "on" tænder. */
export function evaluateFatigueNow7801Flag(value) {
  return value === "on";
}

/** Fejl i opslaget = slukket (readFlagStage giver null ved fejl). */
export async function isFatigueNow7801Enabled(supabase) {
  return evaluateFatigueNow7801Flag(await readFlagStage(supabase, FATIGUE_NOW_7801_FLAG_KEY));
}
