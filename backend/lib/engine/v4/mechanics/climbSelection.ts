// backend/lib/engine/v4/mechanics/climbSelection.ts
// Race Engine v4 F2 (#4030): M2 - klatre-selektion.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §4
// punkt 3 + monotoni-implementeringen (samme §, sidste afsnit) + mor-spec
// §3.2/§4 M2 (docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random.
//
// Ryttere i en climb-gruppe splitter bagud naar W' rammer nul ELLER en
// klatre-underskud-score overstiger tuning.selection.splitThreshold.
// Selektions-score = deficit(climbing) + energiunderskud + stoej (stoej
// skalerer magnitude, ALDRIG fortegn — §2 invariant 3). Monotoni haandhaeves
// af en post-sortering rank-guard: sorteret efter den stoej-frie baseScore
// faldende (svageste/mest energi-udtoemte foerst), propageres "ikke-split"
// ALTID fremad mod stigende klatre-evne/lavere energi-underskud, saa en
// staerkere klatrer (samme energi) aldrig kan splitte foer en svagere.
//
// Lokale normaliserings-/gap-konstanter (GRADIENT_NORM_PCT osv.) er BEVIDST
// ikke lagt i tuning.ts: SelectionTuning (types.ts) er en frosset kontrakt
// for denne fase (byggeplan §8: kun arkitekten aendrer types.ts), og disse
// konstanter er rene skalerings-detaljer for M2's egen scoreformel — samme
// "intern implementeringsdetalje"-praecedens som segmentLoop.ts's egne
// clamp/round2-helpers (og TerrainTuning-kommentaren om at fog-gaten kun
// gaelder events[].params, ikke interne konstanter). tuning.selection's 4
// frosne felter (deficitWeight, energyDeficitWeight, noiseSdBase,
// splitThreshold) er de reelt kalibrerbare haandtag (head-to-head, 23-24/8).

import type {
  ClimbSelectionHook,
  EngineState,
  GroupKind,
  RaceGroup,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { gaussian } from "../rng.ts";
import { makeGroupId, splitGroup } from "../groups.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Normaliseringsdenominatorer for "klatre-underskud × gradient × længde"
// (§4 punkt 3): en HC-agtig 15%/10km-referenceklatring giver
// climbDeficitScaled = 1 ved fuldt deficit (deficit01=1) — kalibreret saa
// tuning.selection.splitThreshold (0.12) rammes ved realistiske, ikke
// ekstreme, deficits paa almindelige stigninger.
const GRADIENT_NORM_PCT = 15;
const LENGTH_NORM_KM = 10;

// Split-gap-sekunder (hvor langt bagud den nye gruppe starter): base +
// skalering paa gennemsnitlig (stoej-fri) score blandt de splittede ryttere,
// clampet til et realistisk baand.
const SPLIT_GAP_BASE_SECONDS = 15;
const SPLIT_GAP_PER_SCORE_UNIT = 90;
const SPLIT_GAP_BOUNDS: readonly [number, number] = [10, 240];

type RiderSelection = {
  riderId: string;
  baseScore: number; // stoej-fri: deficitWeight*climbDeficitScaled + energyDeficitWeight*energyDeficit
  scoreTriggered: boolean; // (baseScore + stoej) > splitThreshold, FOER rank-guard
  wprimeForced: boolean; // wprime <= 0 — fysiologisk absolut, uafhaengig af rank-guard
};

/** Klatre-underskud (0-1, normaliseret) relativt til gruppens staerkeste klatrer. */
function climbDeficit01(referenceClimbing: number, climbing: number): number {
  return clamp((referenceClimbing - climbing) / 99, 0, 1);
}

/**
 * "klatre-underskud × gradient × længde" (§4 punkt 3), normaliseret mod
 * GRADIENT_NORM_PCT/LENGTH_NORM_KM saa produktet er sammenligneligt med
 * tuning.selection-vaegtene/-taersklen (alle ~0-1-skala).
 */
function climbDeficitScaled(deficit01: number, gradientPct: number, lengthKm: number): number {
  const gradientNorm = clamp(gradientPct, 0, 100) / GRADIENT_NORM_PCT;
  const lengthNorm = clamp(lengthKm, 0, 1000) / LENGTH_NORM_KM;
  return deficit01 * gradientNorm * lengthNorm;
}

function energyDeficit01(wprime: number, wprimeMax: number): number {
  if (wprimeMax <= 0) return 0;
  return clamp(1 - wprime / wprimeMax, 0, 1);
}

/**
 * Selektions-info pr. rytter i en climb-gruppe (§4 punkt 3 + monotoni-afsnittet).
 * baseScore er stoej-fri (bruges af rank-guarden); scoreTriggered inkluderer
 * stoej (den faktiske split-beslutning FOER guard).
 */
function computeSelections(
  group: RaceGroup,
  state: EngineState,
  ctx: SegmentHookContext,
  gradientPct: number,
  lengthKm: number,
): RiderSelection[] {
  const { entrants, tuning, rngFor } = ctx;
  const { deficitWeight, energyDeficitWeight, noiseSdBase, splitThreshold } = tuning.selection;

  let referenceClimbing = 0;
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    if (!entrant) continue;
    referenceClimbing = Math.max(referenceClimbing, entrant.abilities.climbing);
  }

  const selections: RiderSelection[] = [];
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    const riderState = state.riders[riderId];
    if (!entrant || !riderState || riderState.status !== "racing") continue;

    const deficit01 = climbDeficit01(referenceClimbing, entrant.abilities.climbing);
    const deficitScaled = climbDeficitScaled(deficit01, gradientPct, lengthKm);
    const energyDeficit = energyDeficit01(riderState.wprime, riderState.wprimeMax);
    const baseScore = deficitWeight * deficitScaled + energyDeficitWeight * energyDeficit;

    const noise = gaussian(rngFor("climbSelection", riderId), 0, noiseSdBase * baseScore);
    const noisyScore = baseScore + noise;

    selections.push({
      riderId,
      baseScore,
      scoreTriggered: noisyScore > splitThreshold,
      wprimeForced: riderState.wprime <= 0,
    });
  }
  return selections;
}

/**
 * Rank-guard (§4 monotoni-afsnittet): sorteret efter baseScore faldende
 * (svageste/mest energi-udtoemte foerst), propageres "ikke-split" ALTID
 * fremad — saa en rytter med lavere baseScore (staerkere/friskere, samme
 * gruppe) aldrig kan ende splittet mens en med hoejere baseScore forbliver.
 * wprime-tvungne splits (fysiologisk absolut) er UNDTAGET guarden: de
 * paavirkes kun af selve energi-tilstanden, ikke af rangeringen.
 */
function guardedSplitRiderIds(selections: RiderSelection[]): string[] {
  const sorted = [...selections].sort((a, b) => b.baseScore - a.baseScore || a.riderId.localeCompare(b.riderId));
  let stillEligible = true;
  const split: string[] = [];
  for (const sel of sorted) {
    const guardedTriggered = stillEligible && sel.scoreTriggered;
    if (!sel.scoreTriggered) stillEligible = false;
    if (guardedTriggered || sel.wprimeForced) split.push(sel.riderId);
  }
  return split.sort();
}

function gapSecondsDeltaFor(selections: RiderSelection[], splitRiderIds: string[]): number {
  const splitSet = new Set(splitRiderIds);
  const chosen = selections.filter((s) => splitSet.has(s.riderId));
  if (chosen.length === 0) return SPLIT_GAP_BOUNDS[0];
  const avgBaseScore = chosen.reduce((sum, s) => sum + s.baseScore, 0) / chosen.length;
  return clamp(
    SPLIT_GAP_BASE_SECONDS + SPLIT_GAP_PER_SCORE_UNIT * avgBaseScore,
    SPLIT_GAP_BOUNDS[0],
    SPLIT_GAP_BOUNDS[1],
  );
}

function causeFor(selections: RiderSelection[], splitRiderIds: string[]): string {
  const splitSet = new Set(splitRiderIds);
  const chosen = selections.filter((s) => splitSet.has(s.riderId));
  if (chosen.length === 0) return "climb_deficit";
  const allForced = chosen.every((s) => s.wprimeForced);
  const noneForced = chosen.every((s) => !s.wprimeForced);
  if (allForced) return "wprime_depleted";
  if (noneForced) return "climb_deficit";
  return "mixed";
}

function splitKindFor(sourceKind: GroupKind, splitCount: number): GroupKind {
  if (splitCount === 1) return "solo";
  return sourceKind === "peloton" ? "gruppetto" : "chase";
}

/**
 * M2-hook: kaldes paa climb-segmenter (segmentLoop.ts). Behandler hver
 * eksisterende gruppe uafhaengigt (>=2 ryttere), splitter de udvalgte
 * ryttere bagud i en ny gruppe og emitterer ét peloton_splits-event pr.
 * ny gruppe med en kategorisk aarsag (wprime_depleted/climb_deficit/mixed).
 * REN: intet input muteres, samme (state, ctx) -> samme output.
 */
export const climbSelectionHook: ClimbSelectionHook = (
  state: EngineState,
  ctx: SegmentHookContext,
): SegmentHookResult => {
  const { segment } = ctx;
  if (segment.kind !== "climb") return { state, events: [] };

  const gradientPct = Math.max(0, segment.avg_gradient);
  const lengthKm = Math.max(0, segment.to_km - segment.from_km);

  // Deterministisk behandlingsraekkefolge (id-sorteret) — paavirker ikke
  // resultatet (rngFor er noeglet pr. rytter, ikke pr. kalde-raekkefolge),
  // men holder ny-gruppe-id'ernes taeller stabil pr. run.
  const groupsSorted = [...state.groups].sort((a, b) => a.id.localeCompare(b.id));

  let nextState = state;
  const events: TimelineEvent[] = [];
  let localSeq = 0;

  for (const group of groupsSorted) {
    if (group.rider_ids.length < 2) continue;

    const selections = computeSelections(group, nextState, ctx, gradientPct, lengthKm);
    if (selections.length < 2) continue;

    let splitRiderIds = guardedSplitRiderIds(selections);
    if (splitRiderIds.length === 0) continue;
    if (splitRiderIds.length >= group.rider_ids.length) {
      // Ekstremt segment (fx laengere hele-etape-klatring i test-harnesset):
      // ALLE ryttere kan i princippet ramme wprime<=0 samtidig. En gruppe kan
      // aldrig splitte fra sig selv — behold altid mindst den bedst-
      // positionerede rytter (laveste baseScore) som gruppens fortsatte front,
      // saa selektionen stadig differentierer resten (climbDeficitScaled
      // adskiller ryttere ogsaa naar alle er wprime-tvungne).
      const bestRiderId = [...selections].sort(
        (a, b) => a.baseScore - b.baseScore || a.riderId.localeCompare(b.riderId),
      )[0].riderId;
      splitRiderIds = splitRiderIds.filter((id) => id !== bestRiderId);
    }
    if (splitRiderIds.length === 0) continue;

    const kind = splitKindFor(group.kind, splitRiderIds.length);
    const seq = ctx.segmentIndex * 1000 + localSeq;
    localSeq += 1;
    const newGroupId = makeGroupId(kind, seq);
    const gapSecondsDelta = gapSecondsDeltaFor(selections, splitRiderIds);

    const groups = splitGroup(nextState.groups, group.id, splitRiderIds, {
      id: newGroupId,
      kind,
      gapSecondsDelta,
    });
    nextState = { ...nextState, groups };

    events.push({
      km: round2(segment.to_km),
      type: "peloton_splits",
      params: {
        group_id: newGroupId,
        source_group_id: group.id,
        rider_ids: [...splitRiderIds],
        cause: causeFor(selections, splitRiderIds),
        gap_seconds: round2(gapSecondsDelta),
      },
    });
  }

  return { state: nextState, events };
};
