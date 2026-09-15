// Flag for traenings-tick pr. LOEBSDAG (#4846, fase B2). Moenster kopieret fra
// raceDayDevelopmentFlag.js / dailyTrainingFlag.js.
//
// ON  = tick-noeglen er (team_id, season_id, game_day): mutex, stoej-seeds,
//       historik-snapshot og budget-deleren foelger loebsdagen, og +1-loftet pr.
//       evne (#4801) gaelder pr. loebsdag.
// OFF = BIT-IDENTISK med kalenderdags-ticket. Motoren skriver hverken season_id
//       eller game_day paa training_day_runs, saa den gamle partielle
//       UNIQUE(team_id, tick_date) er stadig mutexen.
//
// NAAR MAA DEN FLIPPES? Foerst naar udloeseren "loebsdagen lukker" (fase B4) er
// live. Uden B4 koerer sweepen stadig ÉN gang pr. kalenderdag, saa et hold ville
// faa ét tick pr. kalenderdag men blive afregnet mod en delerkalibreret til 80
// loebsdage — altsaa systematisk undertraening. Flaget er derfor bevidst en
// SKEMA- og NOEGLE-omlaegning i B2, ikke en kadence-aendring.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl → false (featureStage.js).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_TICK_PER_RACE_DAY_FLAG_KEY = "training_tick_per_race_day";

export async function isTrainingTickPerRaceDayEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_TICK_PER_RACE_DAY_FLAG_KEY), opts);
}
