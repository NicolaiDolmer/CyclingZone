// backend/lib/engine/v4/mechanics/jerseyHunt7855.ts
// #7855 (KUN s5_profiles_v3, slukket bag kontakten jersey_hunt_7855, ejer 7/11): troejejagten i
// etapeplanen. To opgaver: "Hent point i spurterne" (hunt_points) og "Hent bjergpoint" (hunt_kom).
// Designnote og maalt baseline: #7855 (tal privat i balance-internals/7855/).
//
// HVAD OPGAVEN AENDRER (og intet andet):
//   1. Hvem kaemper om passagen. En rytter hvis aktuelle opgave (etapeplanens led ved segmentets
//      start, ctx.stagePlanTasks) er jagten paa netop denne art passage, kaemper om den i den
//      gruppe han sidder i, ogsaa i feltet, og staar forrest blandt gruppens kaempere (samme
//      plads som bjergjaegeren fra #6937). Gruppen afgoer stadig foerst: et udbrud foran tager
//      pointene foran ham. Flere jaegere i samme gruppe afgoeres af evnen og passagens eksisterende
//      spredning (computePassageOrder). Ingen ny terning.
//   2. Prisen er ikke her: opgaven koeres paa indsatstrinnet "protect" (stagePlan.ts TASK_EFFORT),
//      saa den koster mere i loebet (indsatstrappen, effortCost.ts) og taeller som hans haardeste
//      indsats efter etapen (stagePlanEngine.stagePlanLoadEfforts, traethed).
//   3. Filmen: passagen faar `hunters` (jaegerne der koerte om netop den), saa loebsfilmen og
//      etapeplanens opsummering kan sige det samme som motoren gjorde.
//
// SLUKKET = bit-identisk: opgaverne findes kun paa en rute med `jersey_hunt_7855`
// (stagePlanEngine.createStagePlanRuntime), saa uden kontakten indeholder ctx.stagePlanTasks
// aldrig en jagt-opgave, og alt her returnerer tomt.
//
// REN: ingen IO, ingen rng, intet input muteres.

import type { StagePlanTask } from "../../../stagePlan.ts";

/** Opgaven der jager passagens art. */
export const JERSEY_HUNT_TASK_BY_KIND_7855: Readonly<Record<"sprint" | "kom", StagePlanTask>> = Object.freeze({
  sprint: "hunt_points",
  kom: "hunt_kom",
});

/**
 * Rytterne der i dette segment jager passager af arten `kind`, i rider_id-orden. Kun ryttere der
 * stadig er i loebet (udgaaede er ikke paa vejen). Tom uden plan eller uden jagt-opgaver.
 */
export function jerseyHuntersForPassage7855(
  stagePlanTasks: Readonly<Record<string, StagePlanTask>> | null | undefined,
  kind: "sprint" | "kom",
  isRacing: (riderId: string) => boolean,
  /** Passagens km og hver jaegers straekning: et jagt-led kaemper kun om passager paa sin egen straekning. */
  passage?: { km: number; windows: Readonly<Record<string, { fromKm: number; toKm: number }>> | undefined },
): string[] {
  if (!stagePlanTasks) return [];
  const task = JERSEY_HUNT_TASK_BY_KIND_7855[kind];
  const onStretch = (id: string) => {
    const window = passage?.windows?.[id];
    return !window || (passage!.km > window.fromKm && passage!.km <= window.toKm);
  };
  return Object.keys(stagePlanTasks)
    .filter((id) => stagePlanTasks[id] === task && isRacing(id) && onStretch(id))
    .sort();
}

/** Bjergjaegerne fra #6937 plus dagens jaegere med opgaven (samme forreste plads). */
export function withJerseyHunters7855(base: ReadonlySet<string> | undefined, hunters: readonly string[]): ReadonlySet<string> | undefined {
  if (hunters.length === 0) return base;
  return new Set([...(base ?? []), ...hunters]);
}

/**
 * Jaegerne der faktisk koerte om passagen og som passagen viser: dem af `hunters` der passerede
 * stregen (alle i loebet passerer; raekkefoelgen er passagens egen). Udeladt naar ingen jagede.
 */
export function passageHuntersField7855(hunters: readonly string[]): { hunters?: string[] } {
  return hunters.length ? { hunters: [...hunters] } : {};
}
