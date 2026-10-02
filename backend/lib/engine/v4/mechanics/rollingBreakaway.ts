// backend/lib/engine/v4/mechanics/rollingBreakaway.ts
// #6073 (KUN regel-revisionen "orders_gc_v2", KUN rullende profil): dagens
// udbrud faar ikke laengere orders_gc_v1's fulde ekstra lad-gaa-loft paa
// rullende terraen.
//
// orders_gc_v1's lad-gaa-balance (mechanics/breakaway.ts ORDERS_GC_V1_LET_GO)
// gav et ikke-farligt udbrud langt mere plads end legacy, ogsaa paa rullende
// etaper, for at kompensere for at udbruddet uden indfyldte kaptajner blev
// hentet for tidligt. Maalt paa rigtige startfelter (aegte test 2/10) blev det
// for meget paa rullende terraen: forspringet voksede til et niveau jagten
// ikke kunne lukke, foer de smaa stigninger i finalen sprængte feltet, og
// morgenudbruddet vandt omtrent hver anden rullende etape. Rullende etaper
// ender oftest i en spurt eller med en reduceret gruppe; udbruddet skal kunne
// vinde, men sjaeldnere end paa kuperet og oftere end paa flad.
//
// Under orders_gc_v2 paa rullende profil faar udbruddet derfor et mindre
// ekstra loft. Vaeksthastigheden er uaendret (den flyttede ikke udfaldet).
// Daempningerne fra #6074 (mange hold lader gaa) og #6089 (farligt udbrud)
// gaelder uaendret, fordi de beregnes i letGoBalanceFor foerst.
//
// REN: ingen IO, ingen rng. Legacy og orders_gc_v1 ser aldrig flaget
// (segmentLoop saetter kun `rollingBreakawayV2` under orders_gc_v2 paa rullende).

import type { ProfileType, RulesRevision } from "../types.ts";

/** #6073: kalibrerings-kandidat (tal og maaling ligger privat i balance-internals/6073/). */
export const ROLLING_BREAKAWAY_V2_TUNING: Readonly<{ maxGapFactor: number }> = Object.freeze({
  maxGapFactor: 2.5,
});

/** Gaelder den rullende udbrudsbalance paa denne etape? Kun orders_gc_v2 paa rullende profil. */
export function rollingBreakawayV2For(revision: RulesRevision, profileType: ProfileType): boolean {
  return revision === "orders_gc_v2" && profileType === "rolling";
}

/**
 * Lad-gaa-faktorerne for rullende terraen under orders_gc_v2. `balance` er
 * resultatet fra letGoBalanceFor (med alle daempninger), `v1MaxGapFactor`
 * orders_gc_v1's raa rullende loft-faktor. Det ekstra loft over 1 skaleres med
 * forholdet mellem v2's og v1's ekstra, saa daempningerne bevares
 * proportionalt. Uden flaget returneres `balance` uaendret (samme objekt).
 */
export function rollingLetGoBalance(
  active: boolean | undefined,
  balance: { maxGapFactor: number; rateFactor: number },
  v1MaxGapFactor: number,
  v2MaxGapFactor: number = ROLLING_BREAKAWAY_V2_TUNING.maxGapFactor,
): { maxGapFactor: number; rateFactor: number } {
  if (!active || !(v1MaxGapFactor > 1)) return balance;
  const scale = (v2MaxGapFactor - 1) / (v1MaxGapFactor - 1);
  return { maxGapFactor: 1 + (balance.maxGapFactor - 1) * scale, rateFactor: balance.rateFactor };
}
