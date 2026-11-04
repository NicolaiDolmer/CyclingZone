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
  observeGroups7635,
  isRiderBehindFront7635,
  type Front7635State,
  type StagePlanRuntime,
} from "./stagePlanEngine.ts";
import { STAGE_PLAN_DROPPED_7635_TUNING } from "./engine/v4/tuning.ts"; // #7635
import { STAGE_PLAN_FINAL_KM, type StagePlanLeg } from "./stagePlan.ts";
import { splitAtFinalKm7383 } from "./engine/v4/adapters/finalKmBoundary7383.ts"; // #7383

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
  assert.equal(finale.events[0].params.at_finish, true, "Codex-review: visningen ved at skiftet kun gaelder finalen");
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

test("#7383 (kontakten): med en graense paa punktet skifter alle opgaver praecis dér, uden finaleundtagelsen", () => {
  const unsplit = twoClimbRoute(106);
  const route: RouteV2 = { ...unsplit, segments: [...splitAtFinalKm7383(unsplit.segments, unsplit.distance_km)] };
  const finalKm = route.distance_km - STAGE_PLAN_FINAL_KM;
  assert.equal(route.segments.length, unsplit.segments.length + 1, "fixturen: punktet laa midt i sidste segment");
  for (const task of ["tempo", "follow_moves", "attack", "ride_for_result"] as const) {
    const riderId = task === "tempo" ? "h1" : "cap";
    const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task, from: { at: "final_km" } }];
    const rt = createStagePlanRuntime([planOrder(riderId, legs)], route, ENTRANTS)!;
    const { events } = rideRoute(rt, route);
    assert.deepEqual(events.map((e) => [e.km, e.params.task, e.params.reason, e.params.at_finish]), [[finalKm, task, "final_km", undefined]], task);
  }
  // To taette skift: begge led koeres, hvert fra sit eget punkt.
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 1 } }, { task: "attack", from: { at: "final_km" } }];
  const rt = createStagePlanRuntime([planOrder("cap", legs)], route, ENTRANTS)!;
  assert.deepEqual(rideRoute(rt, route).events.map((e) => [e.km, e.params.leg]), [[100, 1], [finalKm, 2]]);
});

// ── #7635 (kontakten stage_plan_dropped_front_7635): "sat" kun bag en rigtig front ──
// Kontrakter, ingen balance-tal: afstandene i testene regnes fra tuningen.

const E7635: Record<string, Entrant> = {
  cap: entrant("cap", "A", "captain"),
  h1: entrant("h1", "A", "helper"),
  x: entrant("x", "B", "captain"),
  y: entrant("y", "B", "helper"),
  z: entrant("z", "C", "captain"),
  p: entrant("p", "C", "helper"),
  q: entrant("q", "C", "helper"),
};
const GAP = STAGE_PLAN_DROPPED_7635_TUNING.minGapSeconds;

function state7635(groups: RaceGroup[]): EngineState {
  const riders: EngineState["riders"] = {};
  for (const g of groups) {
    for (const id of g.rider_ids) {
      riders[id] = { rider_id: id, group_id: g.id, cp: 1, wprimeMax: 1, wprime: 1, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
    }
  }
  return { km: 0, groups, riders, virtual_gc: {} };
}

const g7635 = (id: string, rider_ids: string[], gap_seconds: number, extra: Partial<RaceGroup> = {}): RaceGroup =>
  ({ id, kind: "peloton", rider_ids, gap_seconds, cohesion: 1, ...extra });

/** Lederens plan fra #7635: foelg med, angrib efter Y, koer for resultatet naar han er sat. */
const CAPTAIN_PLAN: StagePlanLeg[] = [
  { task: "follow_moves" },
  { task: "attack", from: { at: "kom", kom_index: 1 } },
  { task: "ride_for_result", from: { at: "dropped" } },
];

/** Koer planen over de foerste segmentgraenser med en tilstand pr. graense (index 0 = start). */
function ride7635(on: boolean, states: EngineState[]): TimelineEvent[] {
  const route = twoClimbRoute();
  const rt = createStagePlanRuntime([planOrder("cap", CAPTAIN_PLAN)], route, E7635, on ? { droppedFront7635: true } : {})!;
  const events: TimelineEvent[] = [];
  states.forEach((state, segmentIndex) => {
    events.push(...advanceStagePlan(rt, { state, segment: route.segments[segmentIndex], segmentIndex, entrants: E7635 }));
  });
  return events;
}

const START = state7635([g7635("peloton-0", ["cap", "h1", "x", "y", "z"], 0)]);

test("#7635 slukket: runtime'en har praecis de samme felter som foer kontakten", () => {
  const rt = createStagePlanRuntime([planOrder("cap", CAPTAIN_PLAN)], twoClimbRoute(), E7635)!;
  assert.deepEqual(Object.keys(rt).sort(), ["current", "everInEscape", "legs", "ridden", "riderIds"]);
  assert.equal(createStagePlanRuntime([planOrder("cap", CAPTAIN_PLAN)], twoClimbRoute(), E7635, { droppedFront7635: false })!.front7635, undefined);
});

test("#7635: et nedkoerselsangreb faa sekunder foran goer aldrig feltet sat (slukket: den gamle fejl)", () => {
  const descent = state7635([
    g7635("breakaway-2000", ["x", "y", "z"], 0, { kind: "breakaway", origin: "descent" }),
    g7635("peloton-0", ["cap", "h1"], GAP / 3),
  ]);
  const legacy = ride7635(false, [START, descent]);
  assert.deepEqual(legacy.map((e) => [e.params.leg, e.params.reason]), [[2, "dropped"]], "slukket: som i #7635");
  const fixed = ride7635(true, [START, descent, descent, descent]);
  assert.deepEqual(fixed, [], "taendt: lederen er ikke sat, planen springer ikke");
});

test("#7635: et angreb uden oprindelse (finaleangreb) med stor afstand goer heller ikke feltet sat", () => {
  const attack = state7635([
    g7635("solo-1900", ["x"], 0, { kind: "solo" }),
    g7635("peloton-0", ["cap", "h1", "y", "z"], GAP * 3),
  ]);
  assert.deepEqual(ride7635(true, [START, attack, attack, attack]), []);
});

test("#7635: en rigtig opdeling med holdbar afstand giver 'sat', ved anden graense i traek", () => {
  const split = state7635([
    g7635("peloton-0", ["x", "y", "z"], 0),
    g7635("chase-2001", ["cap", "h1"], GAP * 3, { kind: "chase" }),
  ]);
  const events = ride7635(true, [START, split, split]);
  assert.deepEqual(events.map((e) => [e.km, e.params.leg, e.params.reason]), [[twoClimbRoute().segments[2].from_km, 2, "dropped"]]);
  assert.deepEqual(ride7635(true, [START, split]), [], "én graense er ikke nok");
});

test("#7635: en afstand der ikke holder, eller er for lille, giver ikke 'sat'", () => {
  const split = state7635([g7635("peloton-0", ["x", "y", "z"], 0), g7635("chase-2001", ["cap", "h1"], GAP * 3, { kind: "chase" })]);
  const back = state7635([g7635("peloton-0", ["cap", "h1", "x", "y", "z"], 0)]);
  assert.deepEqual(ride7635(true, [START, split, back, split]), [], "hentet igen: taelleren starter forfra");
  const small = state7635([g7635("peloton-0", ["x", "y", "z"], 0), g7635("chase-2001", ["cap", "h1"], GAP / 2, { kind: "chase" })]);
  assert.deepEqual(ride7635(true, [START, small, small, small]), []);
});

test("#7635: et hentet angreb, der beholder angrebets id, er derefter en rigtig front", () => {
  const attack = state7635([g7635("solo-1900", ["x"], 0, { kind: "solo" }), g7635("peloton-0", ["cap", "h1", "y", "z"], GAP * 3)]);
  const caught = state7635([g7635("solo-1900", ["cap", "h1", "x", "y", "z"], 0)]);
  const split = state7635([g7635("solo-1900", ["x", "y", "z"], 0), g7635("chase-3001", ["cap", "h1"], GAP * 3, { kind: "chase" })]);
  const events = ride7635(true, [START, attack, caught, split, split]);
  assert.deepEqual(events.map((e) => [e.params.leg, e.params.reason]), [[2, "dropped"]]);
});

test("#7635 (Codex-review): en lille rigtig gruppe der henter et stoerre angreb goer det til en rigtig front", () => {
  const start = state7635([g7635("peloton-0", ["cap", "h1", "x", "y", "z", "p", "q"], 0)]);
  const attack = state7635([
    g7635("chase-2900", ["x", "y", "z"], 0, { kind: "chase" }),
    g7635("peloton-0", ["cap", "h1", "p", "q"], GAP * 3),
  ]);
  // En rigtig opdeling bag angrebet: kaptajnen kun lidt bag p og q (ikke sat).
  const split = state7635([
    g7635("chase-2900", ["x", "y", "z"], 0, { kind: "chase" }),
    g7635("peloton-0", ["p", "q"], GAP * 3),
    g7635("gruppetto-3001", ["cap", "h1"], GAP * 3 + GAP / 4, { kind: "gruppetto" }),
  ]);
  // p og q (en lille rigtig gruppe) henter angrebet; angrebets id overlever.
  const caught = state7635([
    g7635("chase-2900", ["x", "y", "z", "p", "q"], 0, { kind: "peloton" }),
    g7635("gruppetto-3001", ["cap", "h1"], GAP * 3, { kind: "gruppetto" }),
  ]);
  const route = twoClimbRoute();
  const rt = createStagePlanRuntime([planOrder("cap", CAPTAIN_PLAN)], route, E7635, { droppedFront7635: true })!;
  const events = [start, attack, split, caught, caught].flatMap((state, segmentIndex) =>
    advanceStagePlan(rt, { state, segment: route.segments[segmentIndex], segmentIndex, entrants: E7635 }));
  assert.deepEqual([...rt.front7635!.attackGroups], [], "angrebets id baerer nu en rigtig gruppe");
  assert.deepEqual(events.map((e) => [e.params.leg, e.params.reason]), [[2, "dropped"]]);
});

test("#7635 (Codex-review 2): stigningen splitter feltet, og fronten henter angrebet i samme segment", () => {
  const f: Front7635State = { prevGroupOf: null, seen: new Set(), attackGroups: new Set(), streak: new Map() };
  const all = ["cap", "h1", "x", "y", "z", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  observeGroups7635(f, [g7635("peloton-0", all, 0)]);
  // Tre ryttere angriber vaek fra feltet.
  observeGroups7635(f, [g7635("chase-2900", ["x", "y", "z"], 0, { kind: "chase" }), g7635("peloton-0", ["cap", "h1", "p1", "p2", "p3", "p4", "p5", "p6", "p7"], GAP)]);
  assert.deepEqual([...f.attackGroups], ["chase-2900"]);
  // I samme segment: stigningen splitter feltet (fronten p1-p3 beholder peloton-0, resten faar
  // et nyt id), og fronten henter angrebet; merget beholder angrebets id. Feltets id er vaek.
  const merged = [
    g7635("chase-2900", ["x", "y", "z", "p1", "p2", "p3"], 0, { kind: "peloton" }),
    g7635("chase-3001", ["cap", "h1", "p4", "p5", "p6", "p7"], GAP * 3, { kind: "chase" }),
  ];
  observeGroups7635(f, merged);
  assert.deepEqual([...f.attackGroups], [], "den samlede front er en rigtig gruppe, ikke et angreb");
  const state = state7635(merged);
  assert.equal(isRiderBehindFront7635("cap", state, E7635, f.attackGroups), true, "kaptajnen i jagtgruppen er reelt sat");
});

test("#7635: en enkelt rytter der slutter sig til et angreb (kontraangreb) aendrer ikke angrebet", () => {
  const f: Front7635State = { prevGroupOf: null, seen: new Set(), attackGroups: new Set(), streak: new Map() };
  observeGroups7635(f, [g7635("peloton-0", ["cap", "h1", "x", "y", "z", "p", "q"], 0)]);
  observeGroups7635(f, [g7635("chase-2900", ["x", "y"], 0, { kind: "chase" }), g7635("peloton-0", ["cap", "h1", "z", "p", "q"], GAP * 3)]);
  assert.deepEqual([...f.attackGroups], ["chase-2900"]);
  observeGroups7635(f, [g7635("chase-2900", ["x", "y", "z"], 0, { kind: "chase" }), g7635("peloton-0", ["cap", "h1", "p", "q"], GAP * 3)]);
  assert.deepEqual([...f.attackGroups], ["chase-2900"]);
});

test("#7635: hjaelperen bag lederens rigtige front er sat; bag lederens angreb er han ikke", () => {
  const route = twoClimbRoute();
  const helperPlan: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }];
  const run = (states: EngineState[]) => {
    const rt = createStagePlanRuntime([planOrder("h1", helperPlan)], route, E7635, { droppedFront7635: true })!;
    return states.flatMap((state, segmentIndex) => advanceStagePlan(rt, { state, segment: route.segments[segmentIndex], segmentIndex, entrants: E7635 }));
  };
  const selection = state7635([g7635("peloton-0", ["cap", "x"], 0), g7635("chase-2001", ["h1", "y", "z"], GAP * 3, { kind: "chase" })]);
  assert.deepEqual(run([START, selection, selection]).map((e) => e.params.reason), ["dropped"]);
  const leaderAttack = state7635([g7635("solo-1900", ["cap"], 0, { kind: "solo" }), g7635("peloton-0", ["h1", "x", "y", "z"], GAP * 3)]);
  assert.deepEqual(run([START, leaderAttack, leaderAttack, leaderAttack]), []);
});

test("#7635 observeGroups7635: en rigtig opdeling er aldrig et angreb; et spring frem er", () => {
  const f: Front7635State = { prevGroupOf: null, seen: new Set(), attackGroups: new Set(), streak: new Map() };
  observeGroups7635(f, START.groups);
  observeGroups7635(f, [g7635("peloton-0", ["cap", "x"], 0), g7635("chase-2001", ["h1", "y"], GAP), g7635("solo-2900", ["z"], 0, { kind: "solo" })]);
  // solo-2900 ligger ikke foran feltet (samme gab): ikke et angreb. chase-2001 ligger bag.
  assert.deepEqual([...f.attackGroups], []);
  observeGroups7635(f, [g7635("solo-3900", ["x"], 0, { kind: "solo" }), g7635("peloton-0", ["cap"], GAP), g7635("chase-2001", ["h1", "y"], GAP * 2), g7635("solo-2900", ["z"], GAP * 2)]);
  assert.deepEqual([...f.attackGroups], ["solo-3900"]);
  // Splittes en angriber ud af et angreb, er han stadig et angreb.
  observeGroups7635(f, [g7635("solo-3900", ["x"], 0, { kind: "solo" }), g7635("peloton-0", ["cap", "h1", "y", "z"], GAP)]);
  assert.deepEqual([...f.attackGroups], ["solo-3900"]);
});
