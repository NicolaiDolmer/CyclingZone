// #7715: hvornår taktik og udtagelse viser mærket. Selve risikoen afgør serveren (samme
// funktion som motoren); her er kun spillerens udvej: Grupetto og Kør roligt holder ham
// under den almindelige regel. Listen er låst mod motoren i timeLimitRisk7715.test.js.

export const TIME_LIMIT_SAFE_EFFORTS = Object.freeze(["grupetto", "save"]);

/** Varslet for en rytter på en etape, med det indsatsvalg der står lige nu. */
export function showsTimeLimitRisk(rider, stageNumber, effort) {
  if (rider?.abandoned || rider?.time_limit_risk?.[stageNumber] !== true) return false;
  return !TIME_LIMIT_SAFE_EFFORTS.includes(effort);
}

/** Forklaringen efter etapen: han røg ud på netop denne etape af træthed. */
export function showsTimeLimitOut(rider, stageNumber) {
  return rider?.time_limit_out_stage != null && rider.time_limit_out_stage === stageNumber;
}

/**
 * Udtagelsen: på den valgte etape, eller på en hvilken som helst etape når intet er valgt.
 * Indsatsen sættes først på Taktik, så her tæller den ikke.
 */
export function selectionTimeLimitRisk(rider, selectedStageIndex) {
  const risk = rider?.stageTimeLimitRisk;
  if (!Array.isArray(risk)) return false;
  return selectedStageIndex != null ? risk[selectedStageIndex] === true : risk.includes(true);
}
