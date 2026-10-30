// backend/lib/engine/v4/adapters/finalKmBoundary7383.ts
// #7383 (SLUKKET motorkontakt, KUN s5_profiles_v3): 10 km fra maal er altid en
// segmentgraense, saa etapeplanens skift ved "de sidste 10 km" sker praecist.
//
// Etapeplanen (backend/lib/stagePlanEngine.ts) skifter opgave ved en segmentgraense.
// Taktiksiden tilbyder to slags skiftepunkter: toppen af en stigning (allerede en
// graense) og "de sidste 10 km" (STAGE_PLAN_FINAL_KM), der ofte ligger midt i et
// segment, oftest etapens sidste. Med kontakten taendt deler motoren det segment der
// krydser punktet, saa hvert led skifter praecis dér, ogsaa to taette skift og
// holdarbejde paa sidste stykke.
//   - Fladt/rullende: segmentet deles i to almindelige stykker (samme moenster som
//     routeAdapter.splitLongOpenRoadSegments).
//   - Stigning eller brostenssektor: stykket deles med samme stejlhed/kategori/sektor,
//     og det er stadig EEN stigning/sektor: bjergtoppen, bjergpointene og kom_passage
//     kommer fra rutens vejpunkter (deles ikke), og blok-reglerne for sammenhaengende
//     stigningssegmenter (mountainSelection.finalClimbStartIndex,
//     allOutCrack6641.climbBlockOf, s5Profiles.priorCategorizedClimbs) ser de to stykker
//     som een stigning, som de allerede goer for en stigning motoren har delt i flere
//     segmenter. Selektionen koeres pr. stykke med rytterens indsats paa netop det
//     stykke (Codex-review: en angriber fra de sidste 10 km faar ikke angrebets
//     indsats paa hele stigningen).
//   - Nedkoersel: deles IKKE. Nedkoerselsfinalens tidsmodel (#6200: finishDescentIndexFor,
//     "kun aabne, aldrig lukke" paa sidste segment, finalens loft fra nedkoerslens start)
//     er bygget paa at nedkoerslen er eet segment. Her gaelder etapeplanens #7333-regel
//     uaendret, og taktiksiden siger det (StagePlanModel.ts stagePlanSwitchNotes).
// Slukket (eller under en aeldre revision) er ruten det SAMME objekt: motoren er
// bit-identisk med main. Taend = ejerens ordrette go i en egen PR; frontendens kopi
// (StagePlanModel.ts FINAL_KM_BOUNDARY_7383_ACTIVE) flippes i samme PR
// (finalKmBoundary7383.test.ts kraever at de to er ens).
//
// REN og inden for motorens renheds-graense: kun typer, etapeplanens konstant og
// regel-revisionen. routeAdapter.ts re-eksporterer den, segmentLoop.ts importerer den.

import { STAGE_PLAN_FINAL_KM } from "../../../stagePlan.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import type { RouteV2, Segment } from "../types.ts";

export const FINAL_KM_BOUNDARY_7383_ACTIVE: boolean = false;

let benchOverride7383: boolean | null = null;
/** KUN tests og dev-benches: taend/sluk kontakten. `null` nulstiller. Produktionskode kalder aldrig setteren. */
export function setFinalKmBoundary7383ForBench(active: boolean | null): void {
  benchOverride7383 = active === null ? null : active === true;
}
/** Er kontakten taendt (eller taendt af en bench)? */
export function finalKmBoundary7383Active(): boolean {
  return benchOverride7383 ?? FINAL_KM_BOUNDARY_7383_ACTIVE;
}
/** Er graensen i kraft for et loeb paa `revision`? */
export function isFinalKmBoundary7383On(revision: unknown): boolean {
  return finalKmBoundary7383Active() && isS5ProfilesV3OrLater(revision);
}

/** Under denne afstand ligger en eksisterende graense "paa" punktet (ingen ny deling). */
const BOUNDARY_EPS_KM = 0.01;

/** Segmenttyper der deles (nedkoerslen deles aldrig, se filens hoved). */
const SPLIT_KINDS: ReadonlySet<Segment["kind"]> = new Set(["flat", "rolling", "climb", "cobbles"]);

function roundKm(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Segmentlisten med en graense praecis `finalKm` fra maal. Samme array naar punktet
 * allerede er en graense (inden for 10 m), ligger uden for ruten, eller falder paa en
 * nedkoersel. Inputtet muteres ikke. Deterministisk, ingen rng.
 */
export function splitAtFinalKm7383(segments: readonly Segment[], distanceKm: number, finalKm: number = STAGE_PLAN_FINAL_KM): readonly Segment[] {
  const finishKm = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : segments[segments.length - 1]?.to_km ?? 0;
  const at = roundKm(finishKm - finalKm);
  if (!(at > 0)) return segments;
  if (segments.some((s) => Math.abs(s.from_km - at) < BOUNDARY_EPS_KM || Math.abs(s.to_km - at) < BOUNDARY_EPS_KM)) return segments;
  const index = segments.findIndex((s) => s.from_km < at && s.to_km > at);
  if (index < 0 || !SPLIT_KINDS.has(segments[index].kind)) return segments;
  const whole = segments[index];
  return [...segments.slice(0, index), { ...whole, to_km: at } as Segment, { ...whole, from_km: at } as Segment, ...segments.slice(index + 1)];
}

/** Ruten som segment-loopet koerer den paa `revision`. Samme objekt naar kontakten er slukket. */
export function routeWithFinalKmBoundary7383(route: RouteV2, revision: unknown): RouteV2 {
  if (!isFinalKmBoundary7383On(revision)) return route;
  const segments = splitAtFinalKm7383(route.segments, route.distance_km);
  return segments === route.segments ? route : { ...route, segments: segments as Segment[] };
}
