// backend/lib/engine/v4/adapters/finalKmBoundary7383.ts
// #7383 (KUN s5_profiles_v3): 10 km fra maal er altid en segmentgraense, saa
// etapeplanens skift ved "de sidste 10 km" sker praecist.
//
// Etapeplanen (backend/lib/stagePlanEngine.ts) skifter opgave ved en segmentgraense.
// Taktiksiden tilbyder to slags skiftepunkter: toppen af en stigning (allerede en
// graense) og "de sidste 10 km" (STAGE_PLAN_FINAL_KM), der ofte ligger midt i et
// segment, oftest etapens sidste. Under s5_profiles_v3 deler motoren det segment der
// krydser punktet, saa hvert led skifter praecis dér, ogsaa to taette skift og
// holdarbejde paa sidste stykke.
//   - Fladt/rullende: segmentet deles i to almindelige stykker (samme moenster som
//     routeAdapter.splitLongOpenRoadSegments).
//   - Stigning eller brostenssektor: stykket deles med samme stejlhed/kategori/sektor,
//     og det er stadig EEN stigning/sektor: bjergtoppen, bjergpointene og kom_passage
//     kommer fra rutens vejpunkter (deles ikke), og blok-reglerne for sammenhaengende
//     stigningssegmenter (mountainSelection.finalClimbStartIndex,
//     allOutCrack6641.climbBlockOf, s5Profiles.priorCategorizedClimbs) ser de to stykker
//     som een stigning. Terraen-selektionen (klatring, brosten) koeres EEN gang, ved
//     halen (toppen/sektorens slutning), paa hele stykket, saa stigningen er praecis lige
//     saa selektiv som udelt. Tempo, kraefter og holdarbejde skifter derimod praecis ved
//     punktet. Selektionen ser den indsats rytteren koerte paa den LAENGSTE del af
//     stykket (Codex-review: et angreb fra de sidste 10 km paa en lang stigning faar
//     ikke angrebets indsats paa hele stigningen). For de fleste opgaver er det samme
//     indsats som etapeplanens naermeste-graense-regel gav den udelte stigning. Undtagelse:
//     holdarbejde (tempo, hold lederen fremme) paa en delt SLUTstigning: udelt skiftede det
//     ved sidste segments start (stagePlanEngine SEGMENT_WORK_TASKS), saa hele stigningens
//     selektion saa holdarbejdets indsats; delt ser selektionen hovedets indsats, naar
//     hovedet er den laengste del.
//   - Nedkoersel: deles IKKE. Nedkoerselsfinalens tidsmodel (#6200: finishDescentIndexFor,
//     "kun aabne, aldrig lukke" paa sidste segment, finalens loft fra nedkoerslens start)
//     er bygget paa at nedkoerslen er eet segment. Her gaelder etapeplanens #7333-regel
//     uaendret, og taktiksiden siger det (StagePlanModel.ts stagePlanSwitchNotes).
//   - Det sene angreb (#6368, mechanics/lateAttack.ts) ser de to stykker som EET segment
//     (alle delte typer, ogsaa fladt/rullende) og vaelger angrebs-segment som paa den
//     udelte rute (finalKmUndivided7383): graensen ved 10 km giver aldrig et angreb paa
//     en etape der ikke havde et, og flytter det aldrig ind midt i en stigning/sektor.
//     Er det delte stykke selv angrebs-segmentet, sker angrebet paa halen (samme slut-km).
// Under en aeldre revision er ruten det SAMME objekt, saa de revisioner koerer uroert.
// Taendt 31/10 paa ejerens go; kodekontakten er fjernet (krav 5), og taktiksiden
// (StagePlanModel.ts stagePlanSwitchNotes) regner med graensen uden egen kopi.
//
// REN og inden for motorens renheds-graense: kun typer, etapeplanens konstant og
// regel-revisionen. routeAdapter.ts re-eksporterer den, segmentLoop.ts importerer den.

import { STAGE_PLAN_FINAL_KM } from "../../../stagePlan.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import type { RouteV2, Segment } from "../types.ts";

/** Under denne afstand ligger en eksisterende graense "paa" punktet (ingen ny deling). */
const BOUNDARY_EPS_KM = 0.01;

/** Segmenttyper der deles (nedkoerslen deles aldrig, se filens hoved). */
const SPLIT_KINDS: ReadonlySet<Segment["kind"]> = new Set(["flat", "rolling", "climb", "cobbles"]);
/** Segmenttyper der deles, men stadig er eet stykke terraen (een selektion). */
const ONE_FEATURE_KINDS: ReadonlySet<Segment["kind"]> = new Set(["climb", "cobbles"]);

/** Et stykke af en delt stigning/sektor. `headLonger`: hovedet er den laengste del. */
export type FinalKmTerrainPiece7383 = { part: "head" | "tail"; whole: Segment; headLonger: boolean };

// Noeglet paa selve segment-objektet, saa intet nyt felt kommer paa Segment (types.ts,
// snapshots, tidslinje).
const TERRAIN_PIECES = new WeakMap<object, FinalKmTerrainPiece7383>();
/** Hovedet af ENHVER delt type -> det udelte segment og halen (det sene angreb, finalKmUndivided7383). */
const SPLIT_HEADS = new WeakMap<object, { whole: Segment; tail: Segment }>();

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
  const head = { ...whole, to_km: at } as Segment;
  const tail = { ...whole, from_km: at } as Segment;
  if (ONE_FEATURE_KINDS.has(whole.kind)) {
    // Som etapeplanens naermeste graense: halen vinder ved lige lange dele.
    const headLonger = at - whole.from_km > whole.to_km - at;
    TERRAIN_PIECES.set(head, { part: "head", whole, headLonger });
    TERRAIN_PIECES.set(tail, { part: "tail", whole, headLonger });
  }
  SPLIT_HEADS.set(head, { whole, tail });
  return [...segments.slice(0, index), head, tail, ...segments.slice(index + 1)];
}

/**
 * Den udelte segmentliste bag en liste delt af splitAtFinalKm7383, og hovedets plads
 * (`headIndex`; halen ligger paa `headIndex + 1`). `null` naar intet er delt (ogsaa
 * hele motoren under en aeldre revision). Det sene angreb vaelger sit segment paa den
 * udelte liste, saa 10 km-graensen aldrig flytter eller skaber angrebet.
 */
export function finalKmUndivided7383(segments: readonly Segment[]): { segments: readonly Segment[]; headIndex: number } | null {
  for (let i = 0; i < segments.length - 1; i++) {
    const split = SPLIT_HEADS.get(segments[i]);
    if (split && segments[i + 1] === split.tail) return { segments: [...segments.slice(0, i), split.whole, ...segments.slice(i + 2)], headIndex: i };
  }
  return null;
}

/**
 * Stykket af en delt stigning/sektor som `segment` er, eller `undefined` (alle andre
 * segmenter, og hele motoren under en aeldre revision). segmentLoop.ts springer
 * terraen-selektionen over paa hovedet og koerer den paa halen med hele stykket.
 */
export function finalKmTerrainPiece7383(segment: Segment): FinalKmTerrainPiece7383 | undefined {
  return TERRAIN_PIECES.get(segment);
}

/** Ruten som segment-loopet koerer den paa `revision`. Samme objekt under en aeldre revision. */
export function routeWithFinalKmBoundary7383(route: RouteV2, revision: unknown): RouteV2 {
  if (!isS5ProfilesV3OrLater(revision)) return route;
  const segments = splitAtFinalKm7383(route.segments, route.distance_km);
  return segments === route.segments ? route : { ...route, segments: segments as Segment[] };
}
