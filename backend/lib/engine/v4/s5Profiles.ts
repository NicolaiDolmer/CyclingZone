// backend/lib/engine/v4/s5Profiles.ts
// #6363 (Spor 2, epic #6369): S5-etapeprofilernes motor bag regel-revisionen
// s5_profiles_v1 (SLUKKET, taendes kun paa ejerens ordrette go).
// Spec: docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md §1-§5.
//
// Ét sted bestemmer hvordan S5-ordforraadet (medium_mountain, flat_sprint,
// uphill_sprint, wall_finish) og den afskaffede udbrudsfinale naar mekanikkerne:
//
//   - Under s5_profiles_v1 beholder de nye finaler deres egne navne (finale.ts,
//     breakaway.ts og tuning.ts har raekker for dem), og en "breakaway"-finale
//     bliver terraenets egen finale: udbrud er motorens adfaerd, ikke en finale
//     (spec §3, #6368).
//   - Under ALLE aeldre revisioner oversaettes de nye finaler til den gamle finale
//     de afloeser (flad spurt -> massespurt, stigende spurt -> reduceret spurt,
//     mur -> punch). Saa kan en S5-kalender koere paa en slukket revision uden at
//     motoren moeder et ord den ikke kender (byg-plan §5 risiko 3).
//   - Mellembjerg koerer i begge tilfaelde i motorens terraen-bucket (kuperet,
//     eller bjerg naar etapen ender paa toppen), saa alle profil-tabeller i
//     mekanikkerne gaelder uden en ny raekke.
//
// Under s5_profiles_v1 kan ruten desuden faa en segmentgraense 5-15 km fra maal, saa
// det sene angreb (#6368) har et segment at ske paa (withLateAttackBoundary).
//
// En rute uden S5-ord under en aeldre revision returneres som SAMME objekt:
// alle eksisterende loeb er byte-identiske (s5Profiles6363.test.ts).
//
// REN: ingen IO, ingen rng. Muterer aldrig input.

import { isS5ProfilesV1OrLater } from "../../raceEngineRulesRevision.ts";
import { S5_PROFILES_TUNING } from "./tuning.ts";
import { lateAttackChance, lateAttackSegmentIndex } from "./mechanics/lateAttack.ts";
import type { AbilityKey, FinaleType, ProfileType, RouteV2, Segment, StageInput } from "./types.ts";

/** De nye S5-finaler og den gamle finale hver af dem afloeser (aeldre revisioner). */
export const S5_LEGACY_FINALE: Readonly<Record<"flat_sprint" | "uphill_sprint" | "wall_finish", FinaleType>> = Object.freeze({
  flat_sprint: "bunch_sprint",
  uphill_sprint: "reduced_sprint",
  wall_finish: "punch",
});

/**
 * Terraenets finale naar dagen var maerket "breakaway" (samme kort som
 * finale.ts's FIELD_FINALE_BY_PROFILE, med S5's flade spurt). Kun S5.
 */
const S5_TERRAIN_FINALE: Readonly<Partial<Record<ProfileType, FinaleType>>> = Object.freeze({
  flat: "flat_sprint",
  rolling: "punch",
  hilly: "punch",
  medium_mountain: "punch",
  classic: "punch",
  mountain: "long_climb",
  high_mountain: "long_climb",
  cobbles: "reduced_sprint",
  gravel: "reduced_sprint",
});

function isS5Finale(finale: FinaleType | null): finale is keyof typeof S5_LEGACY_FINALE {
  return finale === "flat_sprint" || finale === "uphill_sprint" || finale === "wall_finish";
}

/** Mellembjergets plads i motorens terraen-bucket (alle revisioner). */
export function mediumMountainBucket(finale: FinaleType | null): ProfileType {
  return finale === "long_climb" ? S5_PROFILES_TUNING.mediumMountainSummitBucket : S5_PROFILES_TUNING.mediumMountainBucket;
}

/**
 * Ruten som mekanikkerne skal se den under `revision`. Samme objekt naar intet
 * skal oversaettes (alle eksisterende loeb), ellers en kopi med kun
 * profile_type/finale_type aendret (og under S5 evt. én ekstra segmentgraense).
 */
export function routeForRulesRevision(route: RouteV2, revision: unknown): RouteV2 {
  const s5 = isS5ProfilesV1OrLater(revision);
  let finale = route.finale_type;
  if (s5) {
    if (finale === "breakaway") finale = S5_TERRAIN_FINALE[route.profile_type] ?? null;
  } else if (isS5Finale(finale)) {
    finale = S5_LEGACY_FINALE[finale];
  }
  const profile = route.profile_type === "medium_mountain" ? mediumMountainBucket(finale) : route.profile_type;
  const typed = profile === route.profile_type && finale === route.finale_type ? route : { ...route, profile_type: profile, finale_type: finale };
  return s5 ? withLateAttackBoundary(typed) : typed;
}

/**
 * #6368 (KUN S5): det sene angreb sker paa et segment der slutter 5-15 km fra maal
 * (mechanics/lateAttack.ts). Har ruten ingen segmentgraense dér (et langt fladt
 * eller rullende stykke ind til maal), deles det stykke `splitAtKmToGo` fra maal.
 * Kun naar terraenet giver angrebet; ellers samme objekt.
 */
function withLateAttackBoundary(route: RouteV2): RouteV2 {
  if (!(lateAttackChance(route) > 0) || lateAttackSegmentIndex(route) >= 0) return route;
  const finishKm = route.distance_km > 0 ? route.distance_km : route.segments[route.segments.length - 1]?.to_km ?? 0;
  const at = Math.round((finishKm - S5_PROFILES_TUNING.lateAttack.splitAtKmToGo) * 100) / 100;
  const index = route.segments.findIndex((s) => s.from_km < at - 1 && s.to_km > at + 1);
  const seg = index >= 0 ? route.segments[index] : undefined;
  if (!seg || (seg.kind !== "flat" && seg.kind !== "rolling")) return route;
  const segments = [...route.segments.slice(0, index), { ...seg, to_km: at }, { ...seg, from_km: at }, ...route.segments.slice(index + 1)];
  return { ...route, segments };
}

/** StageInput med ruten oversat til revisionen (samme objekt naar intet aendres). */
export function stageInputForRulesRevision(input: StageInput): StageInput {
  const route = routeForRulesRevision(input.route, input.rules_revision);
  return route === input.route ? input : { ...input, route };
}

/**
 * Er segmentet en del af finalestigningen paa en kort eksplosiv afslutning (mur,
 * bakke, stigende spurt: de finaler der har et S5-grundsaet), dvs. den sidste blok
 * af sammenhaengende stigninger naar etapen ender paa en stigning? Dér afgoeres
 * etapen af finalen (finale.ts, demand-vektoren), ikke af klatre-selektionen:
 * klatring indgaar ikke i mur-finalen (spec §4). Kun s5_profiles_v1 spoerger.
 */
export function isS5ExplosiveFinaleClimb(route: Pick<RouteV2, "finale_type" | "segments">, segmentIndex: number): boolean {
  const finale = route.finale_type;
  if (!finale || !S5_PROFILES_TUNING.finaleBase[finale]) return false;
  const segs = route.segments;
  if (segs.length === 0 || segs[segs.length - 1].kind !== "climb") return false;
  let start = segs.length - 1;
  while (start > 0 && segs[start - 1].kind === "climb") start--;
  return segmentIndex >= start && segs[segmentIndex]?.kind === "climb";
}

/**
 * Antal kategoriserede stigninger FOER finalen: stignings-segmenter der slutter
 * mindst `priorClimbMinKmBeforeFinish` foer maal (selve mur-/bakke-stigningen
 * taeller ikke). Segmenterne er motorens sandhed; waypoints kan mangle.
 */
export function priorCategorizedClimbs(route: Pick<RouteV2, "distance_km" | "segments">): number {
  const finishKm = Number.isFinite(route.distance_km) && route.distance_km > 0
    ? route.distance_km
    : route.segments[route.segments.length - 1]?.to_km ?? 0;
  const limit = finishKm - S5_PROFILES_TUNING.priorClimbMinKmBeforeFinish;
  return route.segments.filter((s: Segment) => s.kind === "climb" && s.to_km <= limit).length;
}

/**
 * Hybridens andel til durability (0-1) efter antal tidligere stigninger: 0 til og
 * med `hybridPunchMaxPriorClimbs`, lineaert op til 1 ved
 * `hybridDurabilityFullPriorClimbs`. Monotont ikke-faldende i antallet.
 */
export function hybridDurabilityShare(priorClimbs: number): number {
  const t = S5_PROFILES_TUNING;
  const n = Number.isFinite(priorClimbs) ? Math.max(0, priorClimbs) : 0;
  if (n <= t.hybridPunchMaxPriorClimbs) return 0;
  const span = t.hybridDurabilityFullPriorClimbs - t.hybridPunchMaxPriorClimbs;
  if (!(span > 0)) return 1;
  return Math.min(1, (n - t.hybridPunchMaxPriorClimbs) / span);
}

/**
 * S5-placerings-demand for en kort eksplosiv afslutning (mur, bakke, stigende
 * spurt): grundsaettet plus hybriden fordelt paa punch/durability efter etapens
 * haardhed. null = finalen har intet S5-grundsaet (brug tuning-tabellen).
 * Alle vaegte >= 0, saa finale-scorens monotoni i hver evne er uaendret.
 */
export function s5FinaleDemandVector(route: Pick<RouteV2, "finale_type" | "distance_km" | "segments">): Partial<Record<AbilityKey, number>> | null {
  const finale = route.finale_type;
  if (!finale) return null;
  const base = S5_PROFILES_TUNING.finaleBase[finale];
  if (!base) return null;
  const durability = S5_PROFILES_TUNING.hybridWeight * hybridDurabilityShare(priorCategorizedClimbs(route));
  const punch = S5_PROFILES_TUNING.hybridWeight - durability;
  const out: Partial<Record<AbilityKey, number>> = { ...base };
  if (punch > 0) out.punch = (out.punch ?? 0) + punch;
  if (durability > 0) out.durability = (out.durability ?? 0) + durability;
  return out;
}
