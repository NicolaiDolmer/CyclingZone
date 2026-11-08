// #7715: hvornår taktik og udtagelse viser mærket. Selve risikoen afgør serveren (samme
// funktion som motoren); her er kun spillerens udvej: Grupetto og Kør roligt holder ham
// under den almindelige regel. Listen er låst mod motoren i timeLimitRisk7715.test.ts.

export const TIME_LIMIT_SAFE_EFFORTS = Object.freeze(["grupetto", "save"] as const);

type RiderMark = {
  abandoned?: boolean;
  time_limit_risk?: Record<string, boolean> | null;
  time_limit_out_stage?: number | null;
};

/** Varslet for en rytter på en etape, med det indsatsvalg der står lige nu. */
export function showsTimeLimitRisk(rider: RiderMark | null | undefined, stageNumber: number | null | undefined, effort: string): boolean {
  if (stageNumber == null || rider?.abandoned || rider?.time_limit_risk?.[stageNumber] !== true) return false;
  return !(TIME_LIMIT_SAFE_EFFORTS as readonly string[]).includes(effort);
}

/** Forklaringen efter etapen: han røg ud på netop denne etape af træthed. */
export function showsTimeLimitOut(rider: RiderMark | null | undefined, stageNumber: number | null | undefined): boolean {
  return stageNumber != null && rider?.time_limit_out_stage === stageNumber;
}

/**
 * Udtagelsen: på den valgte etape, eller på en hvilken som helst etape når intet er valgt.
 * Indsatsen sættes først på Taktik, så her tæller den ikke.
 */
export function selectionTimeLimitRisk(rider: { stageTimeLimitRisk?: boolean[] | null } | null | undefined, selectedStageIndex: number | null | undefined): boolean {
  const risk = rider?.stageTimeLimitRisk;
  if (!Array.isArray(risk)) return false;
  return selectedStageIndex != null ? risk[selectedStageIndex] === true : risk.includes(true);
}
