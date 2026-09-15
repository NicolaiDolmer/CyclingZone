// Flag for VISNINGEN af traeningsscoren (#4851). Moenster kopieret fra
// trainingTickRaceDayFlag.js / raceDayDevelopmentFlag.js.
//
// ON  = /api/training/me leverer `trainingScore`-feltet, og fladerne tegner
//       kolonnen paa traeningssidens rytterliste + kortet paa rytterprofilens
//       traeningsfane.
// OFF = feltet UDELADES helt af responsen (ikke bare tomt), praecis som
//       `racingToday` goer bag race_day_development_enabled. Ingen consumer kan
//       skelne "flag off" fra "ingen data" paa et felt der ikke findes.
//
// VIGTIGT: flaget gater KUN visningen. Motoren skriver rider_training_scores
// fra dag ét uanset flaget, saa der er historik at vise naar det taendes —
// ellers ville den foerste sparkline vaere ét punkt og 30-dages-aggregatet tomt.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl → false (featureStage.js).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_SCORE_VISIBLE_FLAG_KEY = "training_score_visible";

export async function isTrainingScoreVisible(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_SCORE_VISIBLE_FLAG_KEY), opts);
}
