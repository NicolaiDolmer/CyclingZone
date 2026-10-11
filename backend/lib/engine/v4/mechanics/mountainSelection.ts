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
// Jagten (M5) kalibreres med, fordi orders_gc_v1's lad-gaa-balance var sat til
// at kompensere for den tidlige elitegruppe: naar feltet holder samlet, er
// lad-gaa-loftet lavere, og jagten foer finalestigningen er kontrolleret (den
// lukker langsommere). I finalen jager feltet som under orders_gc_v1.
//
// Alt gaelder kun paa profilerne i MOUNTAIN_SELECTION_V2_TUNING.profileTypes.
//
// #6092: kuperede etaper er med. Under orders_gc_v1 fik et svagt udbrud paa
// kuperet terraen langt mere lad-gaa-plads end under legacy, og naar det holdt,
// blev forspringet til vinderen hele kaptajnernes tidstab (de koerte selv med
// favoritterne). Pakken gaelder nu ogsaa her, med et lavere lad-gaa-loft. Hver
// profil kan afvige paa knapperne (MOUNTAIN_SELECTION_V2_TUNING.byProfile).
//
// REN: ingen IO, ingen rng. Legacy og orders_gc_v1 ser aldrig en fase
// (segmentLoop saetter kun `mountainSelectionPhase` under orders_gc_v2).

import type { ProfileType, Segment, RulesRevision, SegmentHookContext } from "../types.ts";
import { BREAKAWAY_CHASE_V3_TUNING, MOUNTAIN_SELECTION_V2_TUNING, type MountainSelectionV2Knobs } from "../tuning.ts";

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
 * #6092: knapperne for en profil = de faelles vaerdier med profilens afvigelser
 * (MOUNTAIN_SELECTION_V2_TUNING.byProfile) lagt ovenpaa.
 */
export function mountainSelectionKnobsFor(profileType: ProfileType, officialTimesV3: boolean = false): MountainSelectionV2Knobs {
  const t = MOUNTAIN_SELECTION_V2_TUNING;
  const base: MountainSelectionV2Knobs = {
    preFinalSplitThresholdFactor: t.preFinalSplitThresholdFactor,
    preFinalWprimeForcedMinSeverity: t.preFinalWprimeForcedMinSeverity,
    preFinalBreakawayDriftNeutralShare: t.preFinalBreakawayDriftNeutralShare,
    letGoMaxGapScale: t.letGoMaxGapScale,
    preFinalChaseClosingScale: t.preFinalChaseClosingScale,
    finalChaseClosingScale: t.finalChaseClosingScale,
  };
  const knobs = { ...base, ...(t.byProfile[profileType] ?? {}) };
  // #6441 (KUN official_times_v3): profilens v3-afvigelser (kuperet jager uden daempning foer finalen).
  if (!officialTimesV3) return knobs;
  return { ...knobs, ...(BREAKAWAY_CHASE_V3_TUNING.mountainSelectionByProfile[profileType] ?? {}) };
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

/** #6199 (KUN orders_gc_v3): profiler der derudover faar den bloede selektion (kun selektionen, ikke M5). */
export const V3_EXTRA_SELECTION_PROFILE_TYPES: readonly ProfileType[] = Object.freeze(["rolling"]);

/**
 * Fasen klatre-selektionen ser. Under orders_gc_v2 og op: segmentLoops fase.
 * #6199 (KUN orders_gc_v3): rullende etaper faar samme bloede selektion som
 * bjerg (split-taersklen og den tomme reserve foer finalestigningen). Kun
 * selektionen: M5 (udbrud/jagt) og tempo-neutraliseringen ser stadig kun
 * segmentLoops fase, saa den rullende udbrudsbalance (#6073) er uroert.
 */
export function selectionPhaseFor(
  ctx: Pick<SegmentHookContext, "mountainSelectionPhase" | "ordersGcV3" | "sharedGroupTime" | "route" | "segmentIndex">,
): MountainSelectionPhase | undefined {
  if (ctx.mountainSelectionPhase) return ctx.mountainSelectionPhase;
  if ((ctx.ordersGcV3 !== true && !ctx.sharedGroupTime) || !V3_EXTRA_SELECTION_PROFILE_TYPES.includes(ctx.route.profile_type)) return undefined;
  const finalStart = finalClimbStartIndex(ctx.route.segments);
  if (finalStart < 0) return undefined;
  return ctx.segmentIndex < finalStart ? "pre_final" : "final";
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

/** A: andel af tempo-driften mod dagens udbrud der nulstilles paa stigningen. 0 uden for "pre_final". */
export function phaseClimbNeutralShare(
  phase: MountainSelectionPhase | undefined,
  share: number = MOUNTAIN_SELECTION_V2_TUNING.preFinalBreakawayDriftNeutralShare,
): number {
  return phase === "pre_final" ? share : 0;
}

/**
 * M5-loftet over dagens lad-gaa-forspring under orders_gc_v2 paa bjerg. orders_gc_v1-
 * faktorerne kompenserede for at elitegruppen hentede udbruddet med sit klatretempo;
 * naar feltet holder samlet, skaleres loftet. 1 uden en fase.
 */
export function phaseLetGoMaxGapScale(
  phase: MountainSelectionPhase | undefined,
  scale: number = MOUNTAIN_SELECTION_V2_TUNING.letGoMaxGapScale,
): number {
  return phase ? scale : 1;
}

/**
 * M5: jagtens lukning i fasen. Foer finalestigningen er jagten kontrolleret (lukker
 * langsommere); paa og efter finalestigningen jager favoritternes hold for alvor.
 * 1 uden fase.
 */
export function phaseChaseClosingScale(
  phase: MountainSelectionPhase | undefined,
  preFinal: number = MOUNTAIN_SELECTION_V2_TUNING.preFinalChaseClosingScale,
  final: number = MOUNTAIN_SELECTION_V2_TUNING.finalChaseClosingScale,
): number {
  if (phase === "pre_final") return preFinal;
  if (phase === "final") return final;
  return 1;
}
