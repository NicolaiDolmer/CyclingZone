// #7333/#7368: hvornaar etapeplanen skifter opgave. Kontrakter, ingen balance-tal (hard rule 17).
//  - et rutepunkt skifter ved den segmentgraense der ligger naermest punktet; maalstregen
//    er etapens sidste graense (finalen), saa "de sidste km" aldrig koeres fra starten af
//    et langt sidste segment;
//  - "efter stigning X" gaelder til planens naeste punkt, ikke til rutens naeste stigning.
import test from "node:test";
import assert from "node:assert/strict";

import type { EngineState, Entrant, RaceGroup, RouteV2, Segment, TeamOrder, TimelineEvent } from "./engine/v4/types.ts";
import {
  STAGE_PLAN_LEG_EVENT,
  STAGE_PLAN_ORDER_KIND,
  advanceStagePlan,
  advanceStagePlanAtFinish,
  createStagePlanRuntime,
  stagePlanEntrants,
  stagePlanFinalEfforts,
  type StagePlanRuntime,
} from "./stagePlanEngine.ts";
import { STAGE_PLAN_FINAL_KM, type StagePlanLeg } from "./stagePlan.ts";

function entrant(id: string, team: string, role: Entrant["role"]): Entrant {
  return { rider_id: id, abilities: {} as Entrant["abilities"], role, effort: "normal", condition: 1, team_id: team };
}

const ENTRANTS: Record<string, Entrant> = {
  cap: entrant("cap", "A", "captain"),
  h1: entrant("h1", "A", "helper"),
  x: entrant("x", "B", "captain"),
};

function peloton(): EngineState {
  const group: RaceGroup = { id: "p0", kind: "peloton", rider_ids: Object.keys(ENTRANTS), gap_seconds: 0, cohesion: 1 };
  const riders: EngineState["riders"] = {};
  for (const id of group.rider_ids) {
    riders[id] = { rider_id: id, group_id: group.id, cp: 1, wprimeMax: 1, wprime: 1, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
  }
  return { km: 0, groups: [group], riders, virtual_gc: {} };
}

function planOrder(riderId: string, legs: StagePlanLeg[]): TeamOrder {
  return { team_id: "A", kind: STAGE_PLAN_ORDER_KIND, params: { riders: [{ rider_id: riderId, legs }] } };
}

/** En rute med to stigninger og et langt fladt sidste stykke (som etapen i #7333). */
function twoClimbRoute(lastFromKm = 105): RouteV2 {
  const segments: Segment[] = [
    { kind: "rolling", from_km: 0, to_km: 45 },
    { kind: "climb", from_km: 45, to_km: 50, category: "3", avg_gradient: 6, top_elevation_m: 600 },
    { kind: "descent", from_km: 50, to_km: 55, technicality: 1 },
    { kind: "rolling", from_km: 55, to_km: 95 },
    { kind: "climb", from_km: 95, to_km: 100, category: "2", avg_gradient: 7, top_elevation_m: 900 },
    { kind: "descent", from_km: 100, to_km: lastFromKm, technicality: 1 },
    { kind: "flat", from_km: lastFromKm, to_km: 150 },
  ];
  return {
    distance_km: 150,
    profile_type: "hilly",
    finale_type: "flat_sprint",
    segments,
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [
      { kind: "kom", index: 0, name: "Climb X", km: 50, category: "3" },
      { kind: "kom", index: 1, name: "Climb Y", km: 100, category: "2" },
      { kind: "finish", index: 0, name: "Finish", km: 150 },
    ],
  };
}

/** Koer kun planens skift langs hele ruten (samme kald som segment-loopet). */
function rideRoute(rt: StagePlanRuntime, route: RouteV2): { events: TimelineEvent[]; effortBySegment: string[] } {
  const events: TimelineEvent[] = [];
  const effortBySegment: string[] = [];
  const state = peloton();
  route.segments.forEach((segment, segmentIndex) => {
    const isLastSegment = segmentIndex === route.segments.length - 1;
    events.push(...advanceStagePlan(rt, { state, segment, segmentIndex, isLastSegment, entrants: ENTRANTS }));
    effortBySegment.push(stagePlanEntrants(rt, ENTRANTS)["cap"].effort);
    if (isLastSegment) events.push(...(advanceStagePlanAtFinish(rt, { state, segment, entrants: ENTRANTS })?.events ?? []));
  });
  return { events, effortBySegment };
}

test("#7333: 'de sidste km' paa et langt sidste segment skifter ikke ved segmentets start, men i finalen", () => {
  const route = twoClimbRoute(106);
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "final_km" } }];
  const rt = createStagePlanRuntime([planOrder("cap", legs)], route, ENTRANTS)!;
  const last = route.segments[route.segments.length - 1];
  const finalKm = route.distance_km - STAGE_PLAN_FINAL_KM;
  assert.ok(finalKm - last.from_km > (last.to_km - last.from_km) / 2, "fixturen: punktet ligger i segmentets anden halvdel");

  // Ved segmentets start: intet skift (den gamle regel skiftede her, mange km for tidligt).
  assert.deepEqual(advanceStagePlan(rt, { state: peloton(), segment: last, segmentIndex: 6, isLastSegment: true, entrants: ENTRANTS }), []);
  assert.equal(stagePlanEntrants(rt, ENTRANTS)["cap"].effort, "save", "segmentet koeres i laeet");

  // Finalen: skiftet sker, paa punktets km, og finalen ser opgavens indsats.
  const finale = advanceStagePlanAtFinish(rt, { state: peloton(), segment: last, entrants: ENTRANTS });
  assert.ok(finale);
  assert.deepEqual(finale.events.map((e) => [e.km, e.type, e.params.task, e.params.reason]), [[finalKm, STAGE_PLAN_LEG_EVENT, "follow_moves", "final_km"]]);
  assert.equal(finale.entrants["cap"].effort, "protect");
  assert.equal(finale.entrants["x"], ENTRANTS["x"], "ryttere uden plan er samme objekt");
  assert.equal(stagePlanFinalEfforts(rt)["cap"], "protect", "juryen ser sidste leds indsats");
  // Intet at skifte to gange.
  assert.equal(advanceStagePlanAtFinish(rt, { state: peloton(), segment: last, entrants: ENTRANTS }), null);
});

test("#7333: et punkt i den foerste halvdel af sidste segment skifter stadig ved segmentets start", () => {
  const route = twoClimbRoute(138);
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }];
  const rt = createStagePlanRuntime([planOrder("cap", legs)], route, ENTRANTS)!;
  const last = route.segments[route.segments.length - 1];
  const ev = advanceStagePlan(rt, { state: peloton(), segment: last, segmentIndex: 6, isLastSegment: true, entrants: ENTRANTS });
  assert.deepEqual(ev.map((e) => [e.km, e.params.task, e.params.reason]), [[last.from_km, "attack", "final_km"]]);
  assert.equal(advanceStagePlanAtFinish(rt, { state: peloton(), segment: last, entrants: ENTRANTS }), null);
});

test("#7333: en etape i ét segment koerer ikke 'de sidste km' fra start", () => {
  const route: RouteV2 = { ...twoClimbRoute(), segments: [{ kind: "flat", from_km: 0, to_km: 150 }], waypoints: [] };
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }];
  const rt = createStagePlanRuntime([planOrder("cap", legs)], route, ENTRANTS)!;
  const { events, effortBySegment } = rideRoute(rt, route);
  assert.deepEqual(effortBySegment, ["save"], "hele segmentet i laeet");
  assert.deepEqual(events.map((e) => [e.km, e.params.task]), [[route.distance_km - STAGE_PLAN_FINAL_KM, "attack"]]);
});

test("#7368: 'efter stigning X' gaelder til planens naeste punkt, ikke til rutens naeste stigning", () => {
  const route = twoClimbRoute();
  const legs: StagePlanLeg[] = [
    { task: "stay_sheltered" },
    { task: "follow_moves", from: { at: "kom", kom_index: 0 } },
    { task: "ride_for_result", from: { at: "final_km" } },
  ];
  const rt = createStagePlanRuntime([planOrder("cap", legs)], route, ENTRANTS)!;
  const { events, effortBySegment } = rideRoute(rt, route);
  assert.deepEqual(events.map((e) => [e.km, e.params.leg, e.params.task, e.params.reason]), [
    [50, 1, "follow_moves", "kom"], // fra toppen af X (segmentgraensen)
    [140, 2, "ride_for_result", "final_km"], // ikke ved toppen af Y
  ]);
  // Indsatsen pr. segment: i laeet til toppen af X, derefter "foelg" hele vejen over Y.
  assert.deepEqual(effortBySegment, ["save", "save", "protect", "protect", "protect", "protect", "protect"]);
});

test("#7333 (Codex-review): holdarbejde fra de sidste km koeres i sidste segment, ikke kun i finalen", () => {
  const route = twoClimbRoute(106);
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "final_km" } }];
  const rt = createStagePlanRuntime([planOrder("h1", legs)], route, ENTRANTS)!;
  const last = route.segments[route.segments.length - 1];
  const ev = advanceStagePlan(rt, { state: peloton(), segment: last, segmentIndex: 6, isLastSegment: true, entrants: ENTRANTS });
  assert.deepEqual(ev.map((e) => [e.km, e.params.task]), [[last.from_km, "tempo"]]);
  assert.equal(stagePlanEntrants(rt, ENTRANTS)["h1"].effort, "protect", "tempoet virker i segmentets holdarbejde");
  assert.equal(advanceStagePlanAtFinish(rt, { state: peloton(), segment: last, entrants: ENTRANTS }), null);
});
