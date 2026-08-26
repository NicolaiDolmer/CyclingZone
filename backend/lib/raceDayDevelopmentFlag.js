// Flag for løbsdags-UDVIKLINGEN alene (#4275) — udskilt fra race_day_engine_enabled.
//
// BAGGRUND. #3459 samlede fire ting bag ÉT flag: D1 (løbsdags-gaten), D2
// (løbet udvikler rytteren), D3 (rekalibrerede restitutions-konstanter) og D4
// (AI-hold kører samme motor). Ejer-beslutning 26/8: D1+D2 skal SLUKKES for S3
// og først genindføres til S4, mens D3+D4 skal blive on. Med ét fælles flag var
// det umuligt — at slukke udviklingen ville også have rullet træthedsmedianen
// tilbage fra 57 til 67 for alle spillere og frosset de 137 AI-holds udvikling.
//
// ANSVARSDELING EFTER SPLITTET:
//   race_day_engine_enabled       → D3 (recovery-konstanter) + D4 (AI-hold i
//                                   trainingSweep, aiRecoverySweep no-op'er).
//   race_day_development_enabled  → D1 (løbsdags-lookup + "race"-intensiteten)
//                                   + D2 (applyRaceDevelopmentTick).
//
// OFF (default, fail-safe) = S2-adfærd for løbsdage: motoren kender ikke
// løbskalenderen, en racende rytter får sit NORMALE træningspas den dag, og
// trætheden lægges oven i løbstrætheden fra raceRunner — præcis som i sæson 2.
//
// Flagget er BEVIDST uafhængigt af race_day_engine_enabled: de to må kunne stå
// i alle fire kombinationer. Der er ingen implicit "kun hvis motoren er on"-
// gate, fordi netop den kobling var fejlen vi retter her.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_DAY_DEVELOPMENT_FLAG_KEY = "race_day_development_enabled";

export async function isRaceDayDevelopmentEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_DAY_DEVELOPMENT_FLAG_KEY), opts);
}
