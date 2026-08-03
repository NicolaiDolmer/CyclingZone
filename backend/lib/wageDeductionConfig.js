// #2840 · Config-gate for dagsbaseret løntræk. Samme mønster som
// transferPriceBand.js: nøglen bor i app_config, IKKE hardcodet, så flip kan
// ske uden deploy. DEFAULT er "season_upfront" — PRÆCIS nuværende adfærd
// (ét træk ved sæson-start). "daily" aktiveres tidligst ved S3-skiftet 23/8,
// og KUN efter ejer-godkendt dry-run mod ægte population (simulér-før-ship-
// disciplinen, jf. #1137/#1101).
//
// Fail-safe-retning: enhver læse-fejl (DB nede, netværk, malformed value)
// falder tilbage til "season_upfront" — den SIKRE retning her er at IKKE
// utilsigtet skifte til en ny, ikke-simuleret løn-mekanik under en forbigående
// DB-fejl. Modsat featureStage.evaluateFlagStage (adgangskontrol, fail-safe =
// ingen adgang), er fail-safe her "uændret økonomisk adfærd".
//
// ADVARSEL (midt-sæson-flip-faren): denne værdi læses BÅDE af
// economyEngine.processTeamSeasonPayroll (én gang, ved sæson-start) OG af
// wageDeductionSweep.js (dagligt, hele sæsonen). Flippes værdien MIDT i en
// sæson hvor season-start-payroll allerede har trukket det fulde sæsonbeløb
// upfront, vil den daglige sweep begynde at trække OVENI det allerede betalte
// beløb — et hold der har betalt en hel sæsons løn på forhånd ville blive
// dobbelttrukket for resten af sæsonen. Flip må derfor KUN ske ved en
// sæson-grænse (før `processTeamSeasonPayroll` kører for den nye sæson),
// aldrig mens en sæson er aktiv.

export const WAGE_DEDUCTION_MODE_KEY = "wage_deduction_mode";

export const WAGE_DEDUCTION_MODES = Object.freeze({
  SEASON_UPFRONT: "season_upfront",
  DAILY: "daily",
});

/**
 * Læs wage_deduction_mode fra app_config. Returnerer altid en gyldig mode —
 * aldrig null/undefined — så kaldere kan sammenligne direkte mod
 * WAGE_DEDUCTION_MODES uden selv at håndtere fail-safe.
 * @param {object} supabase — Supabase-client (service-role)
 * @returns {Promise<"season_upfront"|"daily">}
 */
export async function readWageDeductionMode(supabase) {
  if (!supabase?.from) return WAGE_DEDUCTION_MODES.SEASON_UPFRONT;
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", WAGE_DEDUCTION_MODE_KEY)
      .maybeSingle();
    if (error) return WAGE_DEDUCTION_MODES.SEASON_UPFRONT;
    const value = data?.value;
    return value === WAGE_DEDUCTION_MODES.DAILY
      ? WAGE_DEDUCTION_MODES.DAILY
      : WAGE_DEDUCTION_MODES.SEASON_UPFRONT;
  } catch {
    return WAGE_DEDUCTION_MODES.SEASON_UPFRONT;
  }
}

export function isDailyWageMode(mode) {
  return mode === WAGE_DEDUCTION_MODES.DAILY;
}
