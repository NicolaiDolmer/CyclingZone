// backend/lib/engine/v4/mechanics/hillyFinish8189.ts
// #8189 (KUN s5_profiles_v3 + kontakten hilly_selection_8799, SLUKKET): en flad spurt paa kuperet og
// boelget afgoeres af hvor haard dagen var. Ejer 26/11 (#4596): boelget er en sprinterdag, men udbrud
// og reducerede spurter vinder en del; afslutningens og dagens haardhed afgoer vindertypen, og ingen
// ryttertype favoriseres af selve kategorien. Ejerens valg 26/11: variant C (udbrud paa haarde dage +
// reduceret spurt), taendt sammen med #7645's selektion bag én kontakt (mechanics/hillySelection8799.ts).
//
// Foer kontakten koerte motoren en flad spurt paa kuperet som en fuld massespurt uanset dagen
// (baseline-rapporten paa branchen docs/8189-motor-design-baseline): sprinterholdene jagede som paa
// en flad dag, det sene angreb var udelukket, og placerings-kravet var ren spurt. Tre led, hvert med
// sin egen knap i HILLY_FINISH_8189_TUNING:
//
//   - udbruddet (kun kuperet): sprinterholdenes interesse i at jage falder med haardheden, og
//     lad-gaa-loftet vokser med den;
//   - det sene angreb paa en kuperet spurtetape (mechanics/lateAttack.ts) med en chance der
//     vokser med haardheden;
//   - reduceret spurt: en andel af sprint-vaegten flyttes til udholdenhed og punch.
//
// Haardheden er et strukturelt led (rutens kategoriserede stigninger, ingen evne-akse, #4707).
// REN: ingen IO, ingen rng. Slukket (eller en anden revision/profil/finale) returnerer hver
// funktion den neutrale vaerdi (1, undefined eller null), og kaldestederne roerer intet.

import { hillySelection8799On } from "./hillySelection8799.ts"; // #8799
import { HILLY_FINISH_8189_TUNING } from "../tuning.ts";
import type { AbilityKey, RouteV2, StageInput } from "../types.ts";

type RouteLike = Pick<RouteV2, "profile_type" | "finale_type" | "distance_km" | "segments">;

/** Kontakten: den faelles hilly_selection_8799 (kun s5_profiles_v3 og senere, mechanics/hillySelection8799.ts). */
export function hillyFinish8189On(input: Pick<StageInput, "rules_revision" | "hilly_selection_8799">): boolean {
  return hillySelection8799On(input);
}

/** Gaelder leddene paa denne rute (profil og finale)? */
export function hillyFinish8189Applies(route: Pick<RouteV2, "profile_type" | "finale_type">): boolean {
  const t = HILLY_FINISH_8189_TUNING;
  return t.profiles.includes(route.profile_type) && route.finale_type !== null && t.finales.includes(route.finale_type);
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function finishKmOf(route: Pick<RouteV2, "distance_km" | "segments">): number {
  return Number.isFinite(route.distance_km) && route.distance_km > 0 ? route.distance_km : route.segments[route.segments.length - 1]?.to_km ?? 0;
}

/**
 * Dagens haardhed (0-1): de kategoriserede stigninger (blokke af sammenhaengende stignings-
 * segmenter, staerkeste kategori i blokken), vaegtet efter kategori og naerhed til maal.
 * Monotont ikke-faldende: en ekstra eller haardere stigning, eller en stigning taettere paa maal,
 * goer aldrig dagen lettere.
 */
export function hillyFinish8189Hardness(route: Pick<RouteV2, "distance_km" | "segments">): number {
  const t = HILLY_FINISH_8189_TUNING;
  const segs = route.segments;
  const finishKm = finishKmOf(route);
  let sum = 0;
  let blockWeight = 0;
  let blockEnd = 0;
  const flush = () => {
    if (blockWeight <= 0) return;
    const toGo = Math.max(0, finishKm - blockEnd);
    const span = t.farFinishKm - t.nearFinishKm;
    const far = span > 0 ? clamp01((toGo - t.nearFinishKm) / span) : toGo > t.nearFinishKm ? 1 : 0;
    sum += blockWeight * (1 - (1 - t.farWeight) * far);
    blockWeight = 0;
  };
  for (const seg of segs) {
    if (seg.kind !== "climb") {
      flush();
      continue;
    }
    const w = seg.category ? t.categoryWeight[String(seg.category)] ?? 0 : 0;
    blockWeight = Math.max(blockWeight, w);
    blockEnd = seg.to_km;
  }
  flush();
  const range = t.hardnessFull - t.hardnessFloor;
  return range > 0 ? clamp01((sum - t.hardnessFloor) / range) : sum >= t.hardnessFull ? 1 : 0;
}

function appliesOn(on: boolean | undefined, route: RouteLike): boolean {
  return on === true && hillyFinish8189Applies(route);
}

// Udbrudsleddene gaelder kun kuperet. Paa boelget ejer #6804 P2's aktive kontrol (flad/boelget)
// udbruddets forspring; maalt 26/11 flyttede jagt- og lad-gaa-knapper der intet.

/** Udbruddet: faktor paa sprinterholdenes etapeinteresse (1 = uaendret). */
export function hillyFinish8189ChaseScale(on: boolean | undefined, route: RouteLike): number {
  if (!appliesOn(on, route) || route.profile_type !== "hilly") return 1;
  return Math.max(0, 1 - HILLY_FINISH_8189_TUNING.chaseInterestCut * hillyFinish8189Hardness(route));
}

/** Udbruddet: faktor paa lad-gaa-loftet (1 = uaendret). */
export function hillyFinish8189LetGoScale(on: boolean | undefined, route: RouteLike): number {
  if (!appliesOn(on, route) || route.profile_type !== "hilly") return 1;
  return 1 + HILLY_FINISH_8189_TUNING.letGoGain * hillyFinish8189Hardness(route);
}

/** Chancen for det sene angreb paa en kuperet spurtetape (undefined = lateAttack.ts' egen regel). */
export function hillyFinish8189LateAttackChance(on: boolean | undefined, route: RouteLike): number | undefined {
  if (!appliesOn(on, route) || route.profile_type !== "hilly") return undefined;
  const c = HILLY_FINISH_8189_TUNING.lateAttackChanceAtFull * hillyFinish8189Hardness(route);
  return c > 0 ? c : undefined;
}

/**
 * Reduceret spurt: placerings-kravet for en reduceret spurt: tabel-vektoren for flad spurt med en andel af
 * sprint-vaegten flyttet til udholdenhed og punch efter haardheden. null = uaendret.
 */
export function hillyFinish8189Demand(
  on: boolean | undefined,
  route: RouteLike,
  base: Partial<Record<AbilityKey, number>> | undefined,
): Partial<Record<AbilityKey, number>> | null {
  if (!appliesOn(on, route) || !base) return null;
  const t = HILLY_FINISH_8189_TUNING;
  const sprint = base.sprint ?? 0;
  const shift = Math.min(sprint, Math.max(0, t.sprintShiftAtFull) * hillyFinish8189Hardness(route));
  if (!(shift > 0)) return null;
  const toDurability = shift * clamp01(t.shiftToDurability);
  const out: Partial<Record<AbilityKey, number>> = { ...base, sprint: sprint - shift };
  out.durability = (out.durability ?? 0) + toDurability;
  out.punch = (out.punch ?? 0) + (shift - toDurability);
  return out;
}
