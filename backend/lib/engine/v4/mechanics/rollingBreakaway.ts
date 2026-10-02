// backend/lib/engine/v4/mechanics/rollingBreakaway.ts
// #6073 (KUN regel-revisionen "orders_gc_v2", KUN rullende profil): dagens
// udbrud faar ikke laengere orders_gc_v1's ekstra lad-gaa-plads paa rullende
// terraen.
//
// orders_gc_v1's lad-gaa-balance (mechanics/breakaway.ts ORDERS_GC_V1_LET_GO)
// gav et ikke-farligt udbrud langt mere plads end legacy, ogsaa paa rullende
// etaper, for at kompensere for at udbruddet uden indfyldte kaptajner blev
// hentet for tidligt. Maalt paa rigtige startfelter (aegte test 2/10) blev det
// for meget paa rullende terraen: forspringet voksede til et niveau jagten
// ikke kunne lukke foer de smaa stigninger i finalen sprængte feltet, og
// morgenudbruddet vandt omtrent hver anden rullende etape. Rullende etaper
// ender oftest i en spurt eller med en reduceret gruppe; udbruddet skal kunne
// vinde, men sjaeldnere end paa kuperet og oftere end paa flad.
//
// Under orders_gc_v2 paa rullende profil erstattes de to rullende faktorer
// (loft og vaekst) derfor af en mindre ekstra plads. Daempningerne fra
// #6074 (mange hold lader gaa), #6088 (staerkt udbrud) og #6089 (farligt
// udbrud) gaelder uaendret oven paa, fordi de beregnes i letGoBalanceFor.
//
// REN: ingen IO, ingen rng. Legacy og orders_gc_v1 ser aldrig flaget
// (segmentLoop saetter kun `rollingBreakawayV2` under orders_gc_v2 paa rullende).

import type { ProfileType, RulesRevision } from "../types.ts";

/** #6073: kalibrerings-kandidat (tal og maaling ligger privat i balance-internals/6073/). */
export const ROLLING_BREAKAWAY_V2_TUNING: Readonly<{ maxGapFactor: number; rateFactor: number }> = Object.freeze({
  maxGapFactor: 1.6,
  rateFactor: 1.3,
});

/** Gaelder den rullende udbrudsbalance paa denne etape? Kun orders_gc_v2 paa rullende profil. */
export function rollingBreakawayV2For(revision: RulesRevision, profileType: ProfileType): boolean {
  return revision === "orders_gc_v2" && profileType === "rolling";
}

/**
 * Lad-gaa-faktorerne for rullende terraen under orders_gc_v2. `v1Factors` er
 * orders_gc_v1's raa rullende faktorer, `balance` er letGoBalanceFor's
 * resultat (med alle daempninger). Det ekstra over 1 skaleres med forholdet
 * mellem v2's og v1's ekstra, saa daempningerne bevares proportionalt.
 * Uden flaget returneres `balance` uaendret (samme objekt).
 */
export function rollingLetGoBalance(
  active: boolean | undefined,
  balance: { maxGapFactor: number; rateFactor: number },
  v1Factors: { maxGapFactor: number; rateFactor: number },
  tuning: { maxGapFactor: number; rateFactor: number } = ROLLING_BREAKAWAY_V2_TUNING,
): { maxGapFactor: number; rateFactor: number } {
  if (!active) return balance;
  const rescale = (value: number, v1: number, v2: number) => (v1 > 1 ? 1 + (value - 1) * ((v2 - 1) / (v1 - 1)) : value);
  return {
    maxGapFactor: rescale(balance.maxGapFactor, v1Factors.maxGapFactor, tuning.maxGapFactor),
    rateFactor: rescale(balance.rateFactor, v1Factors.rateFactor, tuning.rateFactor),
  };
}
