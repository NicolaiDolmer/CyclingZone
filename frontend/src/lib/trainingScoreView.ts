// trainingScoreView — traeningsscorens SPARKLINE-serie, fladens side (#5486).
//
// Baggrund: backend/lib/trainingScore.js (buildTrainingScoreView) sender ÉN
// raekke pr. dag i vinduet, ogsaa loebsdage — de har bevidst `score: null`
// (raekken uden tal er selve kontrakten backend-testen laaser, ikke en fejl).
// Fladen brugte det raa udsnit direkte til kurven, saa en loebsdag blev et
// HUL i sparklinen (TrainingScoreSparkline tegnede den som et brud).
//
// Ejeren (22/9, #5486): kurven skal vaere SAMMENHAENGENDE — loebsdage
// udelades helt af SERIEN (ikke tegnes som 0, ikke som gap). Datoen forsvinder
// fra x-aksen i stedet for at staa som et tomt slot. Gaelder ogsaa naar
// `training_tick_per_race_day` er taendt: filteret kigger kun paa `score`, ikke
// paa hvordan raekkerne blev til, saa det er ligegyldigt om en kalenderdag har
// 1 eller 5 loebsdage bag sig.
//
// Ren funktion, ingen DOM/React: testes isoleret med `node --test`.

export interface TrainingScoreSparkPoint {
  date: string;
  score: number | null;
  raceDay?: boolean;
}

/**
 * Filtrerer en traeningsscore-spark-serie saa kun dage MED et tal er tilbage.
 * Loebsdage (og enhver anden raekke uden et gyldigt tal) udelades af
 * outputtet i stedet for at blive vist som et hul eller et nul.
 */
export function filterTrainingScoreSpark(
  points: ReadonlyArray<TrainingScoreSparkPoint | null | undefined> | null | undefined,
): Array<TrainingScoreSparkPoint & { score: number }> {
  if (!Array.isArray(points)) return [];
  return points.filter(
    (p): p is TrainingScoreSparkPoint & { score: number } =>
      p != null && typeof p.score === "number" && Number.isFinite(p.score),
  );
}
