// #8857 · Raekkerne i stigningslisten (StageClimbList): ren logik, saa tallene testes uden React.
// Tallene kommer fra loebssidens egen model (climbDetail), saa listen, profilen og finaledetaljerne
// altid viser det samme.
import { climbDetail, type Climb, type ElevationSeries, type StageProfile } from "../race/stagePageV2/stagePageV2Model.ts";

export interface ClimbRow {
  index: number;
  name: string | null;
  category: string | null;
  topKm: number;
  lengthKm: number;
  avgGradient: number;
  kmToGo: number;
}

/** Klatringerne skal allerede vaere sorteret efter km (sortedClimbs); indeks foelger den raekkefoelge. */
export function climbRows(profile: StageProfile, series: ElevationSeries | null, climbs: Climb[]): ClimbRow[] {
  return climbs.map((climb, index) => {
    const detail = climbDetail(profile, series, climb);
    return {
      index,
      name: climb.name?.trim() || null,
      category: climb.category ?? null,
      topKm: Math.round(detail.topKm),
      lengthKm: Number(climb.length_km),
      avgGradient: Number(climb.avg_gradient),
      kmToGo: detail.kmToGo,
    };
  });
}
