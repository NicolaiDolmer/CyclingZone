// backend/lib/engine/v4/mechanics/mountainSelection.ts
// #6084 (KUN regel-revisionen "orders_gc_v2"): bjergetaper holder samlet til
// finalen, og dagens udbrud hentes paa finalestigningen.
//
// Undersoegelsen #6075 (docs/reports/2026-10-02-6075-climb-selection-timing.md)
// viste at feltet knaekker paa dagens foerste rigtige stigning, og at den lille
// elitegruppe derefter henter udbruddet med sit eget klatretempo laenge foer
// finalen. Revisionen samler to haandtag (forslag B + A):
//
//   B. Paa stigninger FOER finalestigningen er selektionen bloedere: en tom
//      reserve tvinger kun rytteren af paa en alvorlig stigning, og split-
//      taersklen er hoejere. Finalestigningen er uaendret.
//   A. Paa stigninger FOER finalestigningen flytter tempo-modellen ikke hullet
//      mellem dagens udbrud og jagtgruppen. Det goer kun jagten (M5), praecis
//      som paa fladt og rullende terraen (segmentLoop.neutralizeBreakawayTempoDrift).
//
// Begge gaelder kun paa profilerne i MOUNTAIN_SELECTION_V2_TUNING.profileTypes.
// Kuperede etaper er uroerte af konstruktion.
//
// REN: ingen IO, ingen rng. Legacy og orders_gc_v1 ser aldrig en fase
// (segmentLoop saetter kun `mountainSelectionPhase` under orders_gc_v2).

import type { ProfileType, Segment, RulesRevision } from "../types.ts";
import { MOUNTAIN_SELECTION_V2_TUNING } from "../tuning.ts";

export type MountainSelectionPhase = "pre_final" | "final";

/**
 * Indeks for finalestigningens FOERSTE segment: den sidste blok af
 * sammenhaengende climb-segmenter paa ruten. -1 naar ruten ikke har en stigning.
 */
export function finalClimbStartIndex(segments: readonly Pick<Segment, "kind">[]): number {
  let i = segments.length - 1;
  while (i >= 0 && segments[i].kind !== "climb") i--;
  if (i < 0) return -1;
  while (i > 0 && segments[i - 1].kind === "climb") i--;
  return i;
}

/**
 * Fasen for segmentet under orders_gc_v2 paa en bjergprofil. `undefined` =
 * revisionen gaelder ikke her (anden revision, anden profil, ingen stigning):
 * hooksene opfoerer sig da praecis som under orders_gc_v1.
 */
export function mountainSelectionPhaseFor(
  revision: RulesRevision,
  profileType: ProfileType,
  segmentIndex: number,
  finalStartIndex: number,
  profileTypes: readonly ProfileType[] = MOUNTAIN_SELECTION_V2_TUNING.profileTypes,
): MountainSelectionPhase | undefined {
  if (revision !== "orders_gc_v2") return undefined;
  if (!profileTypes.includes(profileType)) return undefined;
  if (finalStartIndex < 0) return undefined;
  return segmentIndex < finalStartIndex ? "pre_final" : "final";
}

/** B: split-taersklen i fasen. Uaendret uden for "pre_final". */
export function phaseSplitThreshold(
  base: number,
  phase: MountainSelectionPhase | undefined,
  factor: number = MOUNTAIN_SELECTION_V2_TUNING.preFinalSplitThresholdFactor,
): number {
  return phase === "pre_final" ? base * factor : base;
}

/** B: mindste stigningsalvor hvor en tom reserve tvinger rytteren af. Uaendret uden for "pre_final". */
export function phaseWprimeForcedMinSeverity(
  base: number,
  phase: MountainSelectionPhase | undefined,
  preFinal: number = MOUNTAIN_SELECTION_V2_TUNING.preFinalWprimeForcedMinSeverity,
): number {
  return phase === "pre_final" ? Math.max(base, preFinal) : base;
}
