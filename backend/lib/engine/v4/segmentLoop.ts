// backend/lib/engine/v4/segmentLoop.ts
// Race Engine v4 F2 (#4030): event-drevet segment-loop (designdoc §3 modul-
// layout, §4 segment-loop-beskrivelsen). Fase A leverer et FLAT-ONLY-verificeret
// skelet: loopet er GENERISK for alle segment-kinds (kalder climb/descent/finale-
// hooks paa de rigtige segmenter), men M2/M3/M4's REELLE mekanik-logik er Fase
// B-scope — her er hooks tomme default-implementeringer (DEFAULT_MECHANIC_HOOKS)
// der ingenting goer.
//
// REN — ingen import fra oevrigt backend. Alt tilstand er immutable (nyt
// objekt/array pr. skridt) saa determinisme-tests kan sammenligne deep-equal.
//
// Krav-tempo/hastigheds-model (segmentLoop-specifik implementeringsdetalje,
// IKKE en del af SS2's frosne kerne-kontrakt): pr. gruppe pr. segment beregnes
// en "kollektiv CP" fra de staerkeste (tuning.work.frontFraction) ryttere i
// gruppen (§4 punkt 1: "front-tempo afledes af ... stærkeste motorer i
// gruppen"). Kollektiv-CP'en styrer segmentets krydsningstid (tuning.terrain)
// og dermed hvor meget grupper trækker fra hinanden. De samme "front"-ryttere
// betaler tuning.work.frontWorkFactor i fysiologi-tick'et, resten betaler
// tuning.work.draftFactor (§4 punkt 1).
//
// #4030 (natboelge 21/8, fixture-fund): fysiologi-tick'et er SUB-DELT
// (physiology.tickPhysiologyOverSegment) i stedet for ét Euler-skridt over
// hele segmentets dtSeconds — se tuning.ts's PHYSIOLOGY_SUBTICK_TUNING-
// kommentar og physiology.ts's tickPhysiologyOverSegment-docblock for
// begrundelsen (eksponentiel genopladnings-ODE var naer-binaer ved ét stort
// skridt). cp/demand/rechargeRate forbliver konstante for hele segmentet
// (kun sub-tick-skridtstoerrelsen aendres) — segmentets krav-tempo/hastighed
// genberegnes fortsat kun pr. segment, ikke pr. sub-tick.

import type {
  Entrant,
  EngineState,
  EngineTuning,
  MechanicHooks,
  RaceGroup,
  RiderState,
  Segment,
  SegmentHookContext,
  SegmentHookResult,
  SegmentGroupSnapshot,
  SegmentKind,
  StageInput,
  TimelineEvent,
} from "./types.ts";
import { boundRngFor } from "./rng.ts";
import { deriveCp, deriveRechargeRate, tickPhysiologyOverSegment } from "./physiology.ts";
import { applyGroupTimes, buildGroupSnapshot, initGroups, initRiderStates, mergeGroups } from "./groups.ts";
import { GROUP_DRAFT_EXTRA_TUNING } from "./tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pushEvent(list: TimelineEvent[], km: number, type: TimelineEvent["type"], params: Record<string, unknown>): void {
  list.push({ km: round2(km), type, params });
}

// ── Default mekanik-hooks (Fase A no-op) ──────────────────────────────────────
// Identitets-funktion: samme state tilbage, ingen events. Fase B (climbSelection.ts/
// descent.ts/finale.ts) erstatter disse med de rigtige M2/M3/M4-implementeringer,
// bag SAMME (state, ctx) -> { state, events }-kontrakt.
function noopHook(state: EngineState, _ctx: SegmentHookContext): SegmentHookResult {
  return { state, events: [] };
}

export const DEFAULT_MECHANIC_HOOKS: MechanicHooks = {
  climbSelection: noopHook,
  descent: noopHook,
  finale: noopHook,
};

// ── Kollektiv-CP + hastighed ───────────────────────────────────────────────────

type GroupTempo = {
  collectiveCp: number;
  frontRiderIds: Set<string>;
  cpByRider: Map<string, number>;
  dtSeconds: number;
};

function riderCpForSegment(entrant: Entrant, riderState: RiderState, segment: Segment, tuning: EngineTuning): number {
  const baseCp = deriveCp(entrant.abilities, segment.kind, tuning.physiology.cpWeights);
  return Math.max(0, baseCp + riderState.dayform);
}

/**
 * Gruppe-lae-fart-gevinst (M1, #4604): den relative fart en gruppe paa
 * `riderCount` holder UD OVER en solo-rytter med samme kollektive CP.
 *
 * Eksporteret for property-testbarhed. Tre egenskaber testene laaser:
 *   1. `riderCount <= 1` giver praecis 0 — en solo-rytter faar aldrig laegevinst.
 *   2. Monotont ikke-faldende i `riderCount` (log-kurve, clampet til [0, 1]).
 *   3. Terraen-vaegten er `1 - draftFactor[kind]`, saa gevinsten er stoerst paa
 *      flad vej og mindst op ad bakke — samme rangorden som hjul-rabatten selv.
 *
 * Ren aritmetik: ingen RNG, ingen state. Paavirker KUN gruppe-tider (mellem
 * grupper), aldrig raekkefolgen inden for en gruppe — monotoni-invarianten
 * (SS2 §2 invariant 3) er derfor uberoert per konstruktion.
 */
export function groupDraftSpeedGain(riderCount: number, kind: SegmentKind, tuning: EngineTuning): number {
  if (!Number.isFinite(riderCount) || riderCount <= 1) return 0;
  const { maxSpeedGain, referenceSize } = GROUP_DRAFT_EXTRA_TUNING;
  const sizeFactor = clamp(Math.log(riderCount) / Math.log(referenceSize), 0, 1);
  const terrainShare = clamp(1 - tuning.work.draftFactor[kind], 0, 1);
  return maxSpeedGain * terrainShare * sizeFactor;
}

function computeSegmentSpeedKmh(
  collectiveCp: number,
  kind: SegmentKind,
  tuning: EngineTuning,
  riderCount: number,
): number {
  const baseSpeed = tuning.terrain.baseSpeedKmh[kind];
  const baseDemand = tuning.terrain.baseDemand[kind];
  const [lo, hi] = tuning.terrain.speedMultiplierBounds;
  const multiplier = clamp(1 + tuning.terrain.strengthSpeedGain * (collectiveCp - baseDemand), lo, hi);
  return baseSpeed * multiplier * (1 + groupDraftSpeedGain(riderCount, kind, tuning));
}

function computeGroupTempo(
  group: RaceGroup,
  riders: Record<string, RiderState>,
  entrantsById: Record<string, Entrant>,
  segment: Segment,
  tuning: EngineTuning,
): GroupTempo {
  const cpByRider = new Map<string, number>();
  for (const riderId of group.rider_ids) {
    const entrant = entrantsById[riderId];
    const riderState = riders[riderId];
    if (!entrant || !riderState) continue;
    cpByRider.set(riderId, riderCpForSegment(entrant, riderState, segment, tuning));
  }
  const ranked = [...cpByRider.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const frontCount = Math.max(1, Math.ceil(ranked.length * tuning.work.frontFraction));
  const frontSlice = ranked.slice(0, frontCount);
  const frontRiderIds = new Set(frontSlice.map(([id]) => id));
  const collectiveCp = frontSlice.length > 0 ? frontSlice.reduce((s, [, cp]) => s + cp, 0) / frontSlice.length : 0;
  const speedKmh = computeSegmentSpeedKmh(collectiveCp, segment.kind, tuning, ranked.length);
  const distanceSegmentKm = Math.max(0, segment.to_km - segment.from_km);
  const dtSeconds = speedKmh > 0 ? (distanceSegmentKm / speedKmh) * 3600 : 0;
  return { collectiveCp, frontRiderIds, cpByRider, dtSeconds };
}

function tickGroupRiders(
  group: RaceGroup,
  riders: Record<string, RiderState>,
  entrantsById: Record<string, Entrant>,
  segment: Segment,
  tempo: GroupTempo,
  tuning: EngineTuning,
): Record<string, RiderState> {
  const next: Record<string, RiderState> = {};
  const baseDemand = tuning.terrain.baseDemand[segment.kind];
  const segmentLengthKm = Math.max(0, segment.to_km - segment.from_km);
  for (const riderId of group.rider_ids) {
    const entrant = entrantsById[riderId];
    const riderState = riders[riderId];
    if (!entrant || !riderState) continue;
    const cp = tempo.cpByRider.get(riderId) ?? 0;
    const positionFactor = tempo.frontRiderIds.has(riderId)
      ? tuning.work.frontWorkFactor[segment.kind]
      : tuning.work.draftFactor[segment.kind];
    const demand = baseDemand * positionFactor;
    const rechargeRate = deriveRechargeRate(entrant.abilities, tuning.physiology);
    // #4030 fixture-fund: sub-tick i stedet for ét Euler-skridt over hele
    // segmentet (tuning.ts's PHYSIOLOGY_SUBTICK_TUNING, physiology.ts's
    // tickPhysiologyOverSegment-kommentar) — genopladning bliver gradvis
    // i stedet for naer-binaer; taering er vaerdimaessigt uaendret.
    const tick = tickPhysiologyOverSegment({
      cp,
      wprimeMax: riderState.wprimeMax,
      wprime: riderState.wprime,
      demand,
      dtSeconds: tempo.dtSeconds,
      rechargeRate,
      segmentLengthKm,
    });
    next[riderId] = {
      ...riderState,
      cp,
      wprime: tick.wprime,
      seconds_over_cp: riderState.seconds_over_cp + tick.secondsOverCp,
      work_norm: riderState.work_norm + tick.workNorm,
    };
  }
  return next;
}

/** Rebaseliner grupper saa den mindste gap_seconds altid er praecis 0 (fronten). */
function rebaselineGroups(groups: RaceGroup[]): RaceGroup[] {
  if (groups.length === 0) return groups;
  const minGap = groups.reduce((m, g) => Math.min(m, g.gap_seconds), groups[0].gap_seconds);
  if (minGap === 0) return groups;
  return groups.map((g) => ({ ...g, gap_seconds: Math.max(0, g.gap_seconds - minGap) }));
}

export type SegmentLoopResult = {
  state: EngineState;
  timeline: TimelineEvent[];
  groupSnapshots: SegmentGroupSnapshot[];
};

/**
 * Koerer hele segment-listen for én etape og returnerer sluttilstand + tidslinje
 * + gruppe-snapshots. `simulateStageV4` (index.ts) bygger StageOutput oven paa
 * dette (results/loads afledes af sluttilstanden, finish-eventet tilfoejes der).
 */
export function runSegmentLoop(input: StageInput, hooks: MechanicHooks = DEFAULT_MECHANIC_HOOKS): SegmentLoopResult {
  const { route, startlist, seed, tuning } = input;
  const entrantsById: Record<string, Entrant> = {};
  for (const entrant of startlist) entrantsById[entrant.rider_id] = entrant;

  const rngForFn = boundRngFor(seed);
  const virtualGc: Record<string, number> = {};
  for (const entrant of startlist) virtualGc[entrant.rider_id] = 0;

  let state: EngineState = {
    km: 0,
    groups: initGroups(startlist),
    riders: initRiderStates(startlist, tuning, seed),
    virtual_gc: virtualGc,
  };

  const timeline: TimelineEvent[] = [];
  const groupSnapshots: SegmentGroupSnapshot[] = [];
  const lastEmittedGap = new Map<string, number>();
  let frontElapsedSeconds = 0;

  pushEvent(timeline, 0, "stage_start", {
    field_count: startlist.length,
    profile_type: route.profile_type,
    distance_km: route.distance_km,
  });

  const segments = route.segments;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];

    // 1+2: krav-tempo + fysiologi-tick, pr. gruppe (baseret paa gruppe-strukturen
    // ved segmentets indgang).
    const tempoByGroup = new Map<string, GroupTempo>();
    let nextRiders: Record<string, RiderState> = { ...state.riders };
    for (const group of state.groups) {
      const tempo = computeGroupTempo(group, state.riders, entrantsById, segment, tuning);
      tempoByGroup.set(group.id, tempo);
      const patch = tickGroupRiders(group, state.riders, entrantsById, segment, tempo, tuning);
      nextRiders = { ...nextRiders, ...patch };
    }
    state = { ...state, riders: nextRiders };

    // 4a. Gap-bogfoering: fronten (mindste gap_seconds) er referencen; andre
    // gruppers gap opdateres med (dtGruppe - dtFront), floor 0.
    const frontGroup = state.groups.reduce((min, g) => (g.gap_seconds < min.gap_seconds ? g : min), state.groups[0]);
    const dtFront = tempoByGroup.get(frontGroup.id)?.dtSeconds ?? 0;
    let groups = state.groups.map((g) => {
      if (g.id === frontGroup.id) return g;
      const dtGroup = tempoByGroup.get(g.id)?.dtSeconds ?? dtFront;
      return { ...g, gap_seconds: Math.max(0, g.gap_seconds + (dtGroup - dtFront)) };
    });
    groups = rebaselineGroups(groups);
    state = { ...state, groups };

    // 3. Mekanik-hooks (M2 paa climb, M3 paa descent, M4 paa sidste segment).
    // Fase A: DEFAULT_MECHANIC_HOOKS er no-op, saa state/timeline er uaendret.
    const ctx: SegmentHookContext = {
      segment,
      segmentIndex,
      route,
      entrants: entrantsById,
      tuning,
      rngFor: rngForFn,
    };
    if (segment.kind === "climb") {
      const result = hooks.climbSelection(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    } else if (segment.kind === "descent") {
      const result = hooks.descent(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }
    const isLastSegment = segmentIndex === segments.length - 1;
    if (isLastSegment) {
      // M3-angreb paa selve finale-segmentet giver angrebsgruppen negativt gap
      // (den rykker FORAN kildegruppens 0). Finale-opgoerets frontPool-filter
      // (gap_seconds === 0) kraever rebaseline FOER kaldet — ellers falder
      // angriberne ud af opgoerelsen (fundet af golden fixture 4, 21/8).
      state = { ...state, groups: rebaselineGroups(state.groups) };
      const result = hooks.finale(state, ctx);
      state = result.state;
      timeline.push(...result.events);
    }
    state = { ...state, groups: rebaselineGroups(state.groups) };

    // 4b. Sammensmelt grupper der er kommet inden for merge-taerskel.
    const mergedGroups = mergeGroups(state.groups, tuning.groups.mergeThresholdSeconds);
    state = { ...state, groups: mergedGroups, km: segment.to_km };
    frontElapsedSeconds += dtFront;

    for (const g of mergedGroups) {
      if (g.gap_seconds === 0) continue;
      const last = lastEmittedGap.get(g.id);
      if (last === undefined || Math.abs(g.gap_seconds - last) >= tuning.groups.gapUpdateThresholdSeconds) {
        pushEvent(timeline, segment.to_km, "gap_update", { group_id: g.id, gap_seconds: round2(g.gap_seconds) });
        lastEmittedGap.set(g.id, g.gap_seconds);
      }
    }

    // 5. Snapshot pr. segment (beslutning 20).
    groupSnapshots.push(buildGroupSnapshot(segment.to_km, mergedGroups));
  }

  // Tid-tildeling: rent gruppe-princip (mor-spec SS3.2).
  state = { ...state, riders: applyGroupTimes(state.groups, state.riders, frontElapsedSeconds) };

  return { state, timeline, groupSnapshots };
}
