// #7947 / #8476 punkt 5: "Udsigt: Efter peak, i tilbagegang" følger det, sæsonskiftet gør.
//
// Før: fladerne sagde "efter peak" ud fra PROGRESSION_CONFIG.peakAge, en alder fra den gamle
// model, mens sæsonskiftet ældede efter AGING_V2_CONFIG (plateau, derefter fald bremset af
// løbsdage). Nu læses grænsen fra samme konfiguration som motoren:
//   - XP slukket: dagens aldring (AGING_V2_CONFIG), uændret motor.
//   - XP tændt for i dag: talfilens aldring (xpAgingConfig), samme læsning som skiftet.
// Ingen tal forlader serveren: kun flaget pastPeak.
import { AGING_V2_CONFIG, xpAgingConfig } from "./riderProgression.js";
import { loadEstimateDevelopmentXp } from "./potentialEstimateWriter.js";

/** Aldringen for XP-params (null = XP slukket): talfilens, ellers dagens. */
export function agingCfgForXp(xpParams) {
  return xpAgingConfig(xpParams) ?? AGING_V2_CONFIG;
}

/**
 * Er rytteren forbi plateauet, dvs. kroppen falder ved sæsonskiftet (samme alder som
 * motoren: sæsonalderen; et fald kræver alder over plateauet, se agingV2BaseDrop).
 * Ukendt alder = false.
 */
export function pastPeakFromAging(age, agingCfg = AGING_V2_CONFIG) {
  if (age == null) return false;
  const a = Number(age);
  if (!Number.isFinite(a)) return false;
  return a > (agingCfg ?? AGING_V2_CONFIG).plateauThroughAge;
}

/** Aldringen der gælder i dag. Best effort: en fejlet XP-læsning er dagens regel. */
export async function loadPastPeakAging(supabase, opts) {
  return agingCfgForXp(await loadEstimateDevelopmentXp(supabase, opts));
}
