// backend/lib/engine/v4/index.ts
// Race Engine v4 F2 (#4030): orkestrering — init -> segment-loop -> finale -> emission.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §2.
//
// Én deterministisk funktion: samme input => byte-identisk output (§2 invariant 1).
// REN — ingen import fra oevrigt backend.

import type { MechanicHooks, RiderLoad, StageInput, StageOutput, StageResult, TimelineEvent } from "./types.ts";
import { runSegmentLoop, type SegmentLoopResult } from "./segmentLoop.ts";
import { climbSelectionHook } from "./mechanics/climbSelection.ts";
import { descentHook } from "./mechanics/descent.ts";
import { breakawayHook } from "./mechanics/breakaway.ts";
import { finaleHook } from "./finale.ts";
import { sortTimeline } from "./timeline.ts";

// Fase C-wiring (#4030) + F3-wiring (#4615): de rigtige M2/M3/M4/M5-
// implementeringer. M6 (leadout) kaldes inde fra finaleHook, M14 (AI-taktik)
// producerer ordrer OPSTROEMS og naar kernen som `StageInput.orders` — der er
// derfor ikke et hook for hver mekanik, kun for dem der raekker ind i
// segment-loopet. Harness/tests kan stadig injicere egne hooks via
// runSegmentLoop direkte.
const LIVE_MECHANIC_HOOKS: MechanicHooks = {
  climbSelection: climbSelectionHook,
  descent: descentHook,
  finale: finaleHook,
  breakaway: breakawayHook,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildResults(state: SegmentLoopResult["state"]): StageResult[] {
  // Placerings-raekkefolge ved LIGE tid (#4615): et massespurt-opgoer giver
  // hele den ankomne gruppe samme tid, saa raekkefolgen kan ikke laeses af
  // tiden alene. finale.ts's `finish_order` baerer den; uden den (fx et
  // hook-loest testkald) falder vi tilbage til rider_id, som foer.
  const orderIndex = new Map<string, number>();
  (state.finish_order ?? []).forEach((riderId, index) => orderIndex.set(riderId, index));
  const tieBreak = (riderId: string): number => orderIndex.get(riderId) ?? Number.MAX_SAFE_INTEGER;

  const sorted = Object.values(state.riders).sort(
    (a, b) =>
      a.time_seconds - b.time_seconds ||
      tieBreak(a.rider_id) - tieBreak(b.rider_id) ||
      a.rider_id.localeCompare(b.rider_id),
  );
  return sorted.map((rider, index) => ({
    rider_id: rider.rider_id,
    rank: index + 1,
    time_seconds: round2(rider.time_seconds),
    group_id: rider.group_id,
    // 'racing' -> 'finished' ved etapens slutning: Fase A har ingen abandon-
    // mekanik (M10/incidents er F3-scope), saa alle der ikke er markeret
    // abandoned krydser maalstregen.
    status: rider.status === "abandoned" ? "abandoned" : "finished",
  }));
}

function buildLoads(state: SegmentLoopResult["state"]): RiderLoad[] {
  return Object.values(state.riders)
    .map((rider) => ({
      rider_id: rider.rider_id,
      wprime_depleted_j_norm: round2(Math.max(0, rider.wprimeMax - rider.wprime)),
      seconds_over_cp: round2(rider.seconds_over_cp),
      work_norm: round2(rider.work_norm),
    }))
    .sort((a, b) => a.rider_id.localeCompare(b.rider_id));
}

// F2-placeholder: M4 (finale.ts, Fase B) klassificerer det rigtige `win_type`
// (bunch_sprint/reduced_sprint/solo/...) via finale_type + placerings-opgoer.
// Uden en reel finale-mekanik (no-op hook i Fase A) er "group_finish" den
// eneste ærlige beskrivelse: vinderen er blot foerste rytter i sin gruppe.
const PLACEHOLDER_WIN_TYPE = "group_finish";

function buildFinishEvent(results: StageResult[], distanceKm: number): TimelineEvent {
  const winnerTime = results[0]?.time_seconds ?? 0;
  const top = results.slice(0, Math.min(10, results.length)).map((r) => ({
    rider_id: r.rider_id,
    rank: r.rank,
    gap: round2(r.time_seconds - winnerTime),
  }));
  return { km: round2(distanceKm), type: "finish", params: { top, win_type: PLACEHOLDER_WIN_TYPE } };
}

/**
 * Kerne-kontrakten (§2, frossen): route + startliste + ordrer + seed + tuning
 * -> tidslinje + resultater + belastninger + gruppe-snapshots.
 */
export function simulateStageV4(input: StageInput): StageOutput {
  const { state, timeline, groupSnapshots } = runSegmentLoop(input, LIVE_MECHANIC_HOOKS);
  const results = buildResults(state);
  const loads = buildLoads(state);
  const finishEvent = buildFinishEvent(results, input.route.distance_km);

  // Hooks emitterer midt-segment-events (fx descent attack ved km 1,27) efter
  // loopets egne graense-events — stable-sort paa km genopretter #2410 §2.3's
  // monotoni uden at flytte raekkefoelgen inden for samme km.
  return {
    timeline: { timeline_version: 2, events: [...sortTimeline(timeline), finishEvent] },
    results,
    loads,
    groupSnapshots,
  };
}
