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

export interface ReceiptScoreSession extends TrainingScoreSparkPoint {
  seasonId?: string | null;
  gameDay?: number | null;
}
export interface ReceiptScoreView {
  sessions?: ReceiptScoreSession[];
  spark?: TrainingScoreSparkPoint[];
}
interface ReceiptScoreActivity {
  game_day?: number | null;
  race_day?: boolean;
  injured?: boolean;
  intensity?: string | null;
  status?: string;
  settlement_status?: string;
  score?: number;
}
const validPassScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 99;

/** Quality scores come from the score ledger, never the report's gain score. */
export function receiptPassScore(view: ReceiptScoreView | undefined, date: string,
  seasonId: string | null | undefined, activity: ReceiptScoreActivity): number | null {
  if (activity.race_day || activity.injured || activity.intensity === "rest" ||
    activity.status === "unknown_pending" || activity.settlement_status === "needs_reconciliation") return null;
  const sessions = view?.sessions;
  const legacy = activity.game_day == null && seasonId == null;
  const matches = sessions ? sessions.filter(p => p.date === date &&
    (p.gameDay ?? null) === (activity.game_day ?? null) &&
    (legacy || (p.seasonId ?? null) === (seasonId ?? null))) :
    legacy ? view?.spark?.filter(p => p.date === date) ?? [] : [];
  if (matches.length !== 1 || matches[0].raceDay || !validPassScore(matches[0].score)) return null;
  return matches[0].score;
}

export function latestReceiptPassScore(view: ReceiptScoreView | undefined, date: string,
  seasonId: string | null | undefined, activities: ReceiptScoreActivity[]): number | null {
  const ordered = [...activities].sort((a,b) => (a.game_day ?? -1) - (b.game_day ?? -1));
  for (const activity of ordered.reverse()) {
    const score = receiptPassScore(view,date,seasonId,activity);
    if (score != null) return score;
  }
  return null;
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
