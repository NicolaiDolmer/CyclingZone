// backend/lib/engine/v4/index.ts
// Race Engine v4 F2 (#4030): orkestrering — init -> segment-loop -> finale -> emission.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §2.
//
// Én deterministisk funktion: samme input => byte-identisk output (§2 invariant 1).
// REN — ingen import fra oevrigt backend.

import type {
  MechanicHooks,
  RiderLoad,
  StageIncident,
  StageInput,
  StageOutput,
  StageResult,
  TimelineEvent,
} from "./types.ts";
import { runSegmentLoop, type SegmentLoopResult } from "./segmentLoop.ts";
import { climbSelectionHook } from "./mechanics/climbSelection.ts";
import { descentHook } from "./mechanics/descent.ts";
import { breakawayHook } from "./mechanics/breakaway.ts";
import { applyThreeKmRuleToResults, incidentHook } from "./mechanics/incidents.ts";
import { cobblesHook } from "./mechanics/cobbles.ts";
import { teamPlayHook } from "./mechanics/teamPlay.ts";
import { finaleHook } from "./finale.ts";
import { sortTimeline } from "./timeline.ts";
// M15 (#2582, ejer-beslutning 6/9): tidsgraensen. Se wiring-blokken i
// simulateStageV4 nedenfor for hvorfor den koeres netop dér.
import { applyTimeLimit } from "./mechanics/timeLimit.ts";

// Fase C-wiring (#4030) + F3-wiring (#4615, #2944, #3855): de rigtige
// M2/M3/M4/M5/M8/M10-
// implementeringer. M6 (leadout) kaldes inde fra finaleHook, M14 (AI-taktik)
// producerer ordrer OPSTROEMS og naar kernen som `StageInput.orders` — der er
// derfor ikke et hook for hver mekanik, kun for dem der raekker ind i
// segment-loopet. Harness/tests kan stadig injicere egne hooks via
// runSegmentLoop direkte.
//
// FASEAFGRAENSNING (opdateret 6/9, #2944 + #3855). Audit'en 5/9 talte otte
// faerdige mekanikker uden ét eneste kaldssted. M10 (incidents) og M8
// (brosten/grus) er nu KOBLET IND og staar altsaa ikke laengere paa den liste.
// Stadig bygget-men-ikke-kaldt: M9 (bonussekunder), M11 (vejr), M12 (effort)
// og holdtidskoerslen. (M7 blev wiret 6/9 i segmentLoop's riderCpForSegment;
// M16/holdspillet er wiret her nedenfor og gav samtidig `Entrant.team_id`,
// forudsaetningen for at holdtidskoerslen kan kobles ind.)
const LIVE_MECHANIC_HOOKS: MechanicHooks = {
  climbSelection: climbSelectionHook,
  descent: descentHook,
  finale: finaleHook,
  breakaway: breakawayHook,
  incidents: incidentHook,
  // M8 (#3855, ejer-beslutning 6/9): brosten-/grus-sektorer. Kaldes paa
  // cobbles-segmenter af segmentLoop.ts.
  cobbles: cobblesHook,
  // M16 (#4246, ejer-beslutning 1 5/9): holdspillet — kaptajnen beskyttes,
  // hjaelperen betaler. Kaldes paa HVERT segment af segmentLoop.ts, som det
  // foerste hook. Kraever `Entrant.team_id`; en startliste uden hold-id
  // (fixtures, haandbyggede testlister) koerer bit-uaendret.
  teamPlay: teamPlayHook,
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

  // #2944: en UDGAAET rytter sorterer altid EFTER alle der gennemfoerte.
  // Han faar stadig en placering (invariant 6, #4615: resultatet er en komplet
  // permutation 1..N af startlisten), men han kan aldrig staa foran nogen der
  // koerte over stregen — uanset hvilken tid hans gruppe endte med.
  const finishedFirst = (statusValue: string): number => (statusValue === "abandoned" ? 1 : 0);

  const sorted = Object.values(state.riders).sort(
    (a, b) =>
      finishedFirst(a.status) - finishedFirst(b.status) ||
      a.time_seconds - b.time_seconds ||
      tieBreak(a.rider_id) - tieBreak(b.rider_id) ||
      a.rider_id.localeCompare(b.rider_id),
  );

  // #2944: skadedage pr. rytter. KUN styrt kan saette dem (#4520) — det er
  // allerede haandhaevet i mechanics/incidents.ts's resolveIncident; her
  // spejles blot den vaerdi protokollen baerer. Flere styrt paa samme etape
  // (muligt: hooket kaldes pr. segment) => den LAENGSTE skade taeller.
  const injuryDaysByRider = new Map<string, number>();
  for (const incident of state.stage_incidents ?? []) {
    if (incident.injury_days == null) continue;
    const current = injuryDaysByRider.get(incident.rider_id) ?? 0;
    if (incident.injury_days > current) injuryDaysByRider.set(incident.rider_id, incident.injury_days);
  }

  return sorted.map((rider, index) => ({
    rider_id: rider.rider_id,
    rank: index + 1,
    time_seconds: round2(rider.time_seconds),
    group_id: rider.group_id,
    // 'racing' -> 'finished' ved etapens slutning. Kun M10's trin 3 (alvorligt
    // styrt) kan saette 'abandoned' undervejs; alle andre krydser stregen.
    status: rider.status === "abandoned" ? ("abandoned" as const) : ("finished" as const),
    injury_days: injuryDaysByRider.get(rider.rider_id) ?? null,
  }));
}

/** Etapens uheldsprotokol i stabil (km, rider_id)-orden. */
function buildIncidents(state: SegmentLoopResult["state"]): StageIncident[] {
  return [...(state.stage_incidents ?? [])].sort(
    (a, b) => a.km - b.km || a.rider_id.localeCompare(b.rider_id),
  );
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

  // Hooks emitterer midt-segment-events (fx descent attack ved km 1,27) efter
  // loopets egne graense-events — stable-sort paa km genopretter #2410 §2.3's
  // monotoni uden at flytte raekkefoelgen inden for samme km. M10's uheldsevents
  // (#2944) emitteres inde i segment-loopet og ligger dermed allerede paa deres
  // egen km her.
  const sortedTimeline = sortTimeline(timeline);

  // M10's 3 km-regel er en PLACERINGS-konsekvens og kan derfor foerst paafoeres
  // naar rank eksisterer: efter buildResults, foer finish-eventet bygges paa
  // den endelige raekkefoelge (mechanics/incidents.ts's egen wiring-JSDoc).
  const resultsAfterThreeKmRule = applyThreeKmRuleToResults(buildResults(state), sortedTimeline);
  const loads = buildLoads(state);

  // ── M15: tidsgraensen (#2582, ejer-beslutning 6/9) ───────────────────────
  // Koeres HER og ikke i segment-loopet, fordi graensen maales mod VINDERTIDEN:
  // den findes foerst naar finale.ts har afgjort placeringerne og
  // runSegmentLoop's afsluttende applyGroupTimes har sat sluttiderne. Modulet
  // roerer kun `status` — rank, tid og raekkefoelge er uaendrede, saa
  // monotoni-invarianten (§3 punkt 3) og den laaste feltstoerrelse (§3 punkt 6)
  // er uberoerte per konstruktion.
  //
  // Den maaler paa resultatlisten EFTER M10's 3 km-regel (#2944): reglen giver
  // en styrtet rytter sin gruppes tid, og netop den tid er den graensen skal
  // doemme ham paa — ellers ville et styrt inden for de sidste 3 km foerst
  // blive neutraliseret og derefter alligevel udloese OTL. Udgaaede ryttere
  // (M10's trin 3) roerer M15 ikke: de har allerede en terminal udfaldsklasse.
  const timeLimit = applyTimeLimit({
    results: resultsAfterThreeKmRule,
    profileType: input.route.profile_type,
    distanceKm: input.route.distance_km,
    // Sammenhaengsvinduet er BEVIDST ikke tuning.groups.mergeThresholdSeconds:
    // finale.ts's placerings-tiers ligger per konstruktion mindst
    // mergeThresholdSeconds + margin fra hinanden, saa det vindue kunne aldrig
    // kaede to tiers til én grupetto. Modulet bruger sin egen ANKOMST-graense
    // (TIME_LIMIT_EXTRA_TUNING.grupettoCohesionWindowSeconds, se maalingen dér).
  });
  const results = timeLimit.results;
  const finishEvent = buildFinishEvent(results, input.route.distance_km);

  // M15's events ligger paa maalstregen og hoerer kronologisk EFTER
  // finish-eventet: tidsgraensen kan foerst afgoeres naar vinderen er i maal.
  // Samme km => stabil sortering bevarer den raekkefoelge (#2410 §2.3 regel 4).
  return {
    timeline: { timeline_version: 2, events: [...sortedTimeline, finishEvent, ...timeLimit.events] },
    results,
    loads,
    groupSnapshots,
    incidents: buildIncidents(state),
  };
}
