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
