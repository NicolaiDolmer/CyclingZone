// backend/lib/engine/v4/mechanics/breakawayV3_6804.ts
// #6804 (KUN s5_profiles_v3, SLUKKET): udbrudspakken trin 2, ét trin ad gangen.
// Spec docs/superpowers/specs/2026-10-21-6804-udbrud-pr-loebsgruppe-design.md og
// 2026-10-17-6804-hilly-breakaway-design.md. Reglerne: docs/RACE_ENGINE_RULES.md.
//
// P1 "slank B" (ejer 18/10, B): jagten paa kuperet i etapeloeb.
//   1. Finalevaegten (etapeinteressen i stageWinChaseForceV3) ganges med en faktor pr.
//      afslutning, saa en kuperet etape med spurt jages mindre end en flad massespurt.
//      Ordenen i udbruddets favoer (spurt < bakke/mur < nedkoersel, K2) bevares.
//   2. Jagten foer finalestigningen er daempet (bjergets knap); en GC-reaktion jager
//      stadig uden daempning (breakaway.ts, uaendret).
//   3. Lavere lad-gaa-loft.
// Endagsloeb roeres ikke (de vinder allerede for ofte paa kuperet; G14). Ingen ny
// tilfaeldighed: alle tre knapper flytter kun eksisterende jagt-led.
//
// P6 (ejer-beslutning 4 = A): klassementskontrol paa snor, se afsnittet nedenfor.
//
// REN: ingen IO, ingen rng. Alle aeldre revisioner (ctx.s5ProfilesV3 udeladt) faar
// de neutrale vaerdier (faktor 1 / undefined), saa de er byte-identiske.

import type { FinaleType, GcContext, ProfileType } from "../types.ts";
import { S5_V3_BREAKAWAY_TUNING } from "../tuning.ts";

/** Etapeloeb (ikke endagsloeb): klassementet findes eller loebet er paa sin foerste etape. */
export function isStageRaceGcContext(gcContext: GcContext | null | undefined): boolean {
  return gcContext?.status === "standings" || gcContext?.status === "first_stage";
}

/** P1 gaelder: v3, kuperet profil og et etapeloeb. */
export function s5V3HillyChaseApplies(input: { s5ProfilesV3?: boolean; profileType: ProfileType; gcContext: GcContext | null | undefined }): boolean {
  return input.s5ProfilesV3 === true
    && S5_V3_BREAKAWAY_TUNING.p1.hillyProfiles.includes(input.profileType)
    && isStageRaceGcContext(input.gcContext);
}

/** P1.1: faktoren paa finalevaegten (1 = uaendret, fx nedkoersel og alt uden for P1). */
export function s5V3FinaleWeightScale(applies: boolean, finaleType: FinaleType | null | undefined): number {
  if (!applies || !finaleType) return 1;
  const f = S5_V3_BREAKAWAY_TUNING.p1.finaleWeightFactorByFinale[finaleType];
  return Number.isFinite(f) && (f as number) > 0 ? (f as number) : 1;
}

/** P1.2: jagtens lukning foer finalestigningen paa kuperet (undefined = profilens egen knap). */
export function s5V3PreFinalChaseClosingScale(applies: boolean): number | undefined {
  return applies ? S5_V3_BREAKAWAY_TUNING.p1.preFinalChaseClosingScale : undefined;
}

/** P1.3: faktoren paa lad-gaa-loftet (1 = uaendret). */
export function s5V3LetGoMaxGapScale(applies: boolean): number {
  return applies ? S5_V3_BREAKAWAY_TUNING.p1.letGoMaxGapScale : 1;
}

// ── P6 (ejer-beslutning 4 = A, 21/10): klassementskontrol paa snor ───────────
//   1. Kontrol: foer finalen holder en reagerende klassementsjagt forspringet paa det
//      holdet tolererer (snoren, #5978) i stedet for at hente; finalen henter, og en snor
//      under den mindste laengde er brudt (der hentes). Kun i etapeloeb (breakaway.ts).
//   2. Den fremskrevne gevinst paa resten af etapen vaegtes efter resterende distance.
//   3. "Noget at forsvare" i korte etapeloeb kraever en reel klassementschance.
//   4. En udbryder uden klassementsevne er ingen trussel, heller ikke mod troejen;
//      klassementets forreste (rivalRankAlways) er det stadig altid (gcThreat.ts).

/** P6.2: vaegten paa den fremskrevne gevinst med `remainingKm` tilbage, i [gulv, 1]; 1 i finalen. */
export function s5V3ProjectionWeight(remainingKm: number): number {
  const t = S5_V3_BREAKAWAY_TUNING.p6;
  if (!(Number.isFinite(remainingKm) && remainingKm > t.projectionFullKm)) return 1;
  return Math.max(t.projectionMinWeight, Math.min(1, t.projectionFullKm / remainingKm));
}

/**
 * P6.3: et kort etapeloeb (hoejst shortRaceMaxStages etaper). Antallet er dagens etape plus
 * etaperne tilbage efter i dag (broen), ellers loebets etaper (race_gc_stages). Ukendt = nej
 * (saa gaelder revisionens almindelige regel).
 */
export function s5V3IsShortStageRace(gc: GcContext | null | undefined): boolean {
  if (!gc || gc.status !== "standings") return false;
  const max = S5_V3_BREAKAWAY_TUNING.p6.shortRaceMaxStages;
  const remaining = Number(gc.stages_remaining);
  if (gc.stages_remaining !== undefined && Number.isInteger(remaining) && remaining >= 0) return gc.stage_number + remaining <= max;
  const stages = gc.race_gc_stages;
  return Array.isArray(stages) && stages.length > 0 && stages.length <= max;
}

/** P6.3: plads paa klassementsevne et hold i et kort etapeloeb hoejst maa have for at forsvare. */
export function s5V3ContenderAbilityRank(): number {
  return S5_V3_BREAKAWAY_TUNING.p6.contenderAbilityRank;
}

/** P6.1: ligger segmentets slutning i finalen (de sidste controlFinaleKm), hvor der hentes? */
export function s5V3InControlFinale(distanceKm: number, toKm: number): boolean {
  if (!(Number.isFinite(distanceKm) && distanceKm > 0)) return true;
  return distanceKm - toKm <= S5_V3_BREAKAWAY_TUNING.p6.controlFinaleKm;
}

/**
 * P6.1: snoren jagten holder udbruddet paa: det mindste forspring de reagerende hold
 * tolererer. null = ingen kontrol: ingen tolerance at holde, eller snoren er brudt
 * (kortere end minLeashSeconds), saa der hentes.
 */
export function s5V3ControlTargetSeconds(toleratedSeconds: readonly (number | undefined)[]): number | null {
  const finite = toleratedSeconds.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (finite.length === 0) return null;
  const target = Math.max(0, Math.min(...finite));
  return target >= S5_V3_BREAKAWAY_TUNING.p6.minLeashSeconds ? target : null;
}

/**
 * P6.1: jagtens lukning under kontrol. Uden reaktionerne lukker feltet `baseClosing`
 * (fx en etapeinteresse); reaktionernes ekstra lukning (op til `fullClosing`) maa kun
 * bringe forspringet ned til snoren, aldrig under. Aldrig mere end uden kontrol.
 */
export function s5V3ControlledClosing(input: { fullClosing: number; baseClosing: number; gapSeconds: number; targetSeconds: number }): number {
  const full = Math.max(0, input.fullClosing);
  const base = Math.min(full, Math.max(0, input.baseClosing));
  const room = Math.max(0, input.gapSeconds - input.targetSeconds);
  return Math.max(base, Math.min(full, room));
}
