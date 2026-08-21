// backend/lib/engine/v4/mechanics/cobbles.ts
// Race Engine v4 F3 (#4030): M8 - brosten-sektorer med reel vaegt.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M8 ("brosten-sektorer med reel vaegt (15-20% på udvalgte punch-etaper)")
// + §3.1 ("belgisk aabningsuge med brosten+punch (sektorer med reel vaegt
// 15-20 %, #3864)") + §3.2 ("brosten-kaos (sector-stars × cobblestone)" listet
// som splitaarsag ved siden af nedkoersels-angreb/klatre-selektion).
// f2-core-design.md §4 (M2's deficit+stoej+rank-guard-moenster genbruges her
// med egen tuning-flade — se tuning.ts's COBBLES_EXTRA_TUNING).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random. rng KUN
// via ctx.rngFor (seedet, per-rytter-hash). Muterer aldrig input-state (samme
// determinisme-krav som climbSelection.ts/descent.ts).
//
// SELEKTIONS-MODEL (spejler climbSelection.ts's M2-moenster 1:1, egen tuning-
// flade COBBLES_EXTRA_TUNING i stedet for tuning.selection, saa M8's
// kalibrering ikke deler haandtag med M2's): score = deficitWeight *
// cobblestoneDeficit01 * starWeight*(stars/5) + stoej. Stoej skalerer KUN
// magnitude, aldrig fortegn — samme rank-guard-bevis som climbSelection.ts's
// guardedSplitRiderIds (identisk logik, genbrugt her): sorteret efter
// stoej-fri baseScore faldende, "ikke-split" propageres ALTID fremad, saa en
// staerkere cobblestone-rytter (samme gruppe) aldrig kan ende splittet mens en
// svagere forbliver.
//
// "REEL VAEGT" 15-20 % (mor-spec §3.1/§4, task-brief): split-gap'et for en
// cobbles-sektor er BOUNDED til [15%, 20%] (COBBLES_EXTRA_TUNING.
// effectFractionBounds, ganget med punchFinaleMultiplier paa
// finale_type==='punch'-etaper — "udvalgte punch-etaper") af sektorens
// forventede krydsningstid (terrain.baseSpeedKmh.cobbles x sektor-laengde).
// Kun sektorer med stars >= minStarsForRealWeight kan udloese splits ELLER
// styrt-risiko — under taersklen er sektoren en kosmetisk passage, ingen
// event (samme "reel vaegt hvor det taeller"-praecedens som mor-spec's
// haandslebne monument-sektorer).
//
// RISIKO (M11-forbruger, weather.ts): HELE gruppens ryttere paa en reel-vaegt-
// sektor ruller en seedet styrt-risiko (COBBLES_EXTRA_TUNING.incidentRiskBase),
// vejr-forstaerket via weather.ts's weatherAdjustedRiskBase (mor-spec M11:
// "regn forstaerker ... brosten-risiko") og daempet af egen cobblestone-evne
// + "vejr-teknik"-proxy (weather.ts's weatherTechniqueProxy/-Dampening).
// Samme "ren information" F2-afgraensning som descent.ts's risiko-kobling:
// taeller incidents op og emitterer et event, paavirker IKKE gruppe-
// tilhoersforhold eller tid (monotoni-vaernet — held/uheld maa aldrig kunne
// invertere en evne-baseret rangordning). Risiko rulles for HELE gruppen
// (ikke kun de udvalgte til split), FOER splittet afgoeres, saa udfaldet er
// uafhaengigt af split-beslutningen.

import type {
  CobblesSegment,
  EngineState,
  GroupKind,
  RaceGroup,
  RouteV2,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { gaussian } from "../rng.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { COBBLES_EXTRA_TUNING, WEATHER_EXTRA_TUNING } from "../tuning.ts";
import { weatherAdjustedRiskBase, weatherTechniqueDampening, weatherTechniqueProxy } from "./weather.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// M8-only hook-signatur: spejler types.ts's ClimbSelectionHook/DescentHook
// ((state, ctx) -> SegmentHookResult) uden at kraeve en ny frosset type i
// types.ts (byggeplan §8's byggeregel: kun arkitekten aendrer types.ts) —
// EngineState/SegmentHookContext/SegmentHookResult er allerede eksporterede
// generiske kontrakter, saa denne alias er ren dokumentation for orkestratoren.
export type CobblesHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

type RiderCobblesSelection = {
  riderId: string;
  baseScore: number; // stoej-fri: deficitWeight * cobblestoneDeficit01 * starWeight*(stars/5)
  scoreTriggered: boolean; // (baseScore + stoej) > splitThreshold, FOER rank-guard
};

/** Cobblestone-underskud (0-1, normaliseret) relativt til gruppens staerkeste "brostens-rytter". */
function cobblestoneDeficit01(referenceCobblestone: number, cobblestone: number): number {
  return clamp((referenceCobblestone - cobblestone) / 99, 0, 1);
}

/** Sektorens forventede krydsningstid ved terraenets baseline-hastighed (sekunder) — anker for "15-20% effekt". */
function sectorTraversalSeconds(segment: CobblesSegment, baseSpeedKmhCobbles: number): number {
  const lengthKm = Math.max(0, segment.to_km - segment.from_km);
  if (baseSpeedKmhCobbles <= 0) return 0;
  return (lengthKm / baseSpeedKmhCobbles) * 3600;
}

/** [lo,hi]-fraktionsbaand, ganget op paa "udvalgte punch-etaper" (finale_type==='punch'). Clampet til [0,1] uanset multiplikator. */
function effectFractionBoundsFor(route: Pick<RouteV2, "finale_type">): readonly [number, number] {
  const [lo, hi] = COBBLES_EXTRA_TUNING.effectFractionBounds;
  const multiplier = route.finale_type === "punch" ? COBBLES_EXTRA_TUNING.punchFinaleMultiplier : 1;
  return [clamp(lo * multiplier, 0, 1), clamp(hi * multiplier, 0, 1)];
}

/**
 * Selektions-info pr. rytter i en cobbles-gruppe. baseScore er stoej-fri
 * (bruges af rank-guarden); scoreTriggered inkluderer stoej (den faktiske
 * split-beslutning FOER guard) — samme opdeling som climbSelection.ts.
 */
function computeSelections(
  group: RaceGroup,
  state: EngineState,
  ctx: SegmentHookContext,
  segment: CobblesSegment,
): RiderCobblesSelection[] {
  const { entrants, rngFor } = ctx;
  const { deficitWeight, starWeight, noiseSdBase, splitThreshold } = COBBLES_EXTRA_TUNING;
  const starFraction = segment.stars / 5;

  let referenceCobblestone = 0;
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    if (!entrant) continue;
    referenceCobblestone = Math.max(referenceCobblestone, entrant.abilities.cobblestone);
  }

  const selections: RiderCobblesSelection[] = [];
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    const riderState = state.riders[riderId];
    if (!entrant || !riderState || riderState.status !== "racing") continue;

    const deficit01 = cobblestoneDeficit01(referenceCobblestone, entrant.abilities.cobblestone);
    const baseScore = deficitWeight * deficit01 * starWeight * starFraction;

    const noise = gaussian(rngFor("cobbles_selection", riderId), 0, noiseSdBase * baseScore);
    const noisyScore = baseScore + noise;

    selections.push({ riderId, baseScore, scoreTriggered: noisyScore > splitThreshold });
  }
  return selections;
}

/**
 * Rank-guard (identisk logik/bevis som climbSelection.ts's guardedSplitRiderIds):
 * sorteret efter baseScore faldende (svageste cobblestone-rytter foerst),
 * "ikke-split" propageres ALTID fremad mod stigende cobblestone-evne, saa en
 * staerkere rytter (samme gruppe) aldrig kan ende splittet mens en svagere
 * forbliver — monotoni-invarianten (SS2 §2 invariant 3, mor-spec §3.2).
 */
function guardedSplitRiderIds(selections: RiderCobblesSelection[]): string[] {
  const sorted = [...selections].sort((a, b) => b.baseScore - a.baseScore || a.riderId.localeCompare(b.riderId));
  let stillEligible = true;
  const split: string[] = [];
  for (const sel of sorted) {
    const guardedTriggered = stillEligible && sel.scoreTriggered;
    if (!sel.scoreTriggered) stillEligible = false;
    if (guardedTriggered) split.push(sel.riderId);
  }
  return split.sort();
}

/** Split-gap i sekunder: bounded til [fracLo,fracHi] af sektorens krydsningstid, skaleret paa gennemsnitlig (stoej-fri) score blandt de splittede ryttere. */
function gapSecondsDeltaFor(
  selections: RiderCobblesSelection[],
  splitRiderIds: string[],
  sectorSeconds: number,
  bounds: readonly [number, number],
): number {
  const [fracLo, fracHi] = bounds;
  const lo = fracLo * sectorSeconds;
  const hi = fracHi * sectorSeconds;
  const splitSet = new Set(splitRiderIds);
  const chosen = selections.filter((s) => splitSet.has(s.riderId));
  if (chosen.length === 0 || hi <= lo) return round2(lo);
  const avgBaseScore = chosen.reduce((sum, s) => sum + s.baseScore, 0) / chosen.length;
  const fraction = clamp(avgBaseScore, 0, 1);
  return round2(lo + fraction * (hi - lo));
}

/** Solo-split (én rytter) faar "solo"-kind; ellers "gruppetto" naar kilden er peloton (samme konvention som climbSelection.ts), ellers "chase". */
function splitKindFor(sourceKind: GroupKind, splitCount: number): GroupKind {
  if (splitCount === 1) return "solo";
  return sourceKind === "peloton" ? "gruppetto" : "chase";
}

/** Vejr-/evne-justeret styrt-sandsynlighed for ÉN rytter paa en reel-vaegt cobbles-sektor (M11-forbrug, se filens toppe-kommentar). */
function riderIncidentProbability(
  cobblestoneAbility: number,
  entrantAbilities: SegmentHookContext["entrants"][string]["abilities"],
  route: Pick<RouteV2, "weather">,
): number {
  const rawBase = weatherAdjustedRiskBase(COBBLES_EXTRA_TUNING.incidentRiskBase, route.weather, WEATHER_EXTRA_TUNING);
  const technique = weatherTechniqueProxy(entrantAbilities, WEATHER_EXTRA_TUNING.weatherTechniqueProxyWeights);
  const cobblestone = clamp(Number(cobblestoneAbility) || 0, 0, 99);
  return clamp(
    rawBase -
      COBBLES_EXTRA_TUNING.incidentRiskCobblestoneDampening * cobblestone -
      weatherTechniqueDampening(technique, WEATHER_EXTRA_TUNING),
    0,
    1,
  );
}

/**
 * M8-hook: kaldes paa cobbles-segmenter med stars >= minStarsForRealWeight
 * (segmentLoop.ts's wiring, se PR-notes for hook-punktet). Behandler hver
 * eksisterende gruppe uafhaengigt: (1) ruller styrt-risiko for HELE gruppen
 * (M11-forbrug), (2) splitter de udvalgte ryttere bagud i en ny gruppe
 * (>=2 ryttere), emitterer ét peloton_splits-event pr. ny gruppe. REN: intet
 * input muteres, samme (state, ctx) -> samme output.
 */
export const cobblesHook: CobblesHook = (state: EngineState, ctx: SegmentHookContext): SegmentHookResult => {
  const segment = ctx.segment;
  if (segment.kind !== "cobbles") return { state, events: [] };
  const cobblesSegment = segment as CobblesSegment;
  if (cobblesSegment.stars < COBBLES_EXTRA_TUNING.minStarsForRealWeight) return { state, events: [] };

  const events: TimelineEvent[] = [];
  const sectorSeconds = sectorTraversalSeconds(cobblesSegment, ctx.tuning.terrain.baseSpeedKmh.cobbles);
  const bounds = effectFractionBoundsFor(ctx.route);

  // Deterministisk behandlingsraekkefolge (id-sorteret) — paavirker ikke
  // resultatet (rngFor er noeglet pr. rytter, ikke pr. kalde-raekkefolge),
  // men holder ny-gruppe-id'ernes taeller stabil pr. run (samme moenster som
  // climbSelection.ts).
  const groupsSorted = [...state.groups].sort((a, b) => a.id.localeCompare(b.id));

  let nextState = state;
  let localSeq = 0;

  for (const group of groupsSorted) {
    // 1) Styrt-risiko for HELE gruppen (M11-forbrug), FOER split-beslutningen
    // — udfaldet er uafhaengigt af hvem der ender splittet.
    for (const riderId of [...group.rider_ids].sort()) {
      const entrant = ctx.entrants[riderId];
      const riderState = nextState.riders[riderId];
      if (!entrant || !riderState || riderState.status !== "racing") continue;

      const p = riderIncidentProbability(entrant.abilities.cobblestone, entrant.abilities, ctx.route);
      const rng = ctx.rngFor("cobbles_incident", riderId);
      const roll = rng();
      if (roll >= p) continue;
      const kmFrac = rng();
      const incidentKm = round2(cobblesSegment.from_km + kmFrac * (cobblesSegment.to_km - cobblesSegment.from_km));
      nextState = {
        ...nextState,
        riders: { ...nextState.riders, [riderId]: { ...riderState, incidents: riderState.incidents + 1 } },
      };
      events.push({ km: incidentKm, type: "incident", params: { rider_id: riderId, cause: "cobbles_sector" } });
    }

    // 2) Selektion/split.
    if (group.rider_ids.length < 2) continue;
    const selections = computeSelections(group, nextState, ctx, cobblesSegment);
    if (selections.length < 2) continue;

    const splitRiderIds = guardedSplitRiderIds(selections);
    // En gruppe kan aldrig splitte fra sig selv (samme vaern som
    // climbSelection.ts) — her simplere: ekstreme scores er ikke ventet
    // (ingen wprime-tvunget variant i M8), saa hele gruppen splittende
    // ignoreres frem for at forsoege at bevare en "bedste rytter" (climb-
    // selection-praecedensen), da det ville kraeve at genindfoere en rytter
    // uden nogen selektions-begrundelse.
    if (splitRiderIds.length === 0 || splitRiderIds.length >= group.rider_ids.length) continue;

    const kind = splitKindFor(group.kind, splitRiderIds.length);
    const seq = ctx.segmentIndex * 1000 + localSeq;
    localSeq += 1;
    const newGroupId = makeGroupId(kind, seq);
    const gapSecondsDelta = gapSecondsDeltaFor(selections, splitRiderIds, sectorSeconds, bounds);

    const groups = splitGroup(nextState.groups, group.id, splitRiderIds, {
      id: newGroupId,
      kind,
      gapSecondsDelta,
    });
    nextState = { ...nextState, groups };

    events.push({
      km: round2(cobblesSegment.to_km),
      type: "peloton_splits",
      params: {
        group_id: newGroupId,
        source_group_id: group.id,
        rider_ids: [...splitRiderIds],
        cause: "cobbles_sector",
        sector_name: cobblesSegment.sector_name,
        stars: cobblesSegment.stars,
        gap_seconds: round2(gapSecondsDelta),
      },
    });
  }

  return { state: nextState, events };
};
