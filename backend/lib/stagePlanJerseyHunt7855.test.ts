// #7855: troejejagtens opgaver i etapeplanens kontrakt (stagePlan.ts) og frontendens kopi.
import test from "node:test";
import assert from "node:assert/strict";
import * as backend from "./stagePlan.ts";
import * as frontend from "../../frontend/src/components/race/StagePlanModel.ts";
import { STAGE_PLAN_HUNT_FALLBACK_EVENT, STAGE_PLAN_ORDER_KIND, advanceStagePlan, advanceStagePlanAtFinish, createStagePlanRuntime, stagePlanCurrentTasks, stagePlanHuntWindows7855, stagePlanLoadEfforts, stagePlanOrderFromRow, stagePlanRouteFromV4 } from "./stagePlanEngine.ts";
import { withStagePlan } from "./stagePlanApi.js";
import { jerseyHuntersForPassage7855 } from "./engine/v4/mechanics/jerseyHunt7855.ts";
import type { EngineState, Entrant, RouteV2, Segment, TeamOrder } from "./engine/v4/types.ts";

const RAW = {
  distance_km: 170,
  profile_type: "mountain",
  climbs: [{ name: "Col B", crest_km: 60, category: "1" }, { name: "Col C", crest_km: 110, category: "1" }, { name: "Top", crest_km: 170, category: "1", summit_finish: true }],
  sprints: [{ name: "Spurt", km: 85, kind: "intermediate" }, { name: "Maal", km: 170, kind: "finish" }],
};
const OFF = backend.stagePlanRouteFromRaw(RAW);
const ON = backend.withJerseyHunt7855(OFF, true);

test("#7855 slukket: opgaverne er ukendte, og ruten uden spurter har samme form som foer", () => {
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }], "helper", OFF), "stage_plan_unknown_task");
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_kom" }], "helper", OFF), "stage_plan_unknown_task");
  assert.equal(backend.withJerseyHunt7855(OFF, false), OFF);
  const noSprints = backend.stagePlanRouteFromRaw({ distance_km: 170, profile_type: "mountain", climbs: RAW.climbs });
  assert.equal("sprints" in noSprints, false);
  assert.deepEqual(OFF.sprints, [{ index: 0, km: 85, name: "Spurt" }], "kun indlagte spurter foer maal");
});

test("#7855 taendt: valgbar kun paa en straekning med en spurt hhv. en kategoriseret stigning", () => {
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }], "helper", ON), null);
  // #7855 valg 1 (ejer 13/11, "Kun sammen med udbrud"): bjergjagt vaelges paa udbrudsleddet, ikke som eget led.
  assert.equal(backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }], "helper", ON), null);
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_kom" }], "helper", ON), "stage_plan_unknown_task");
  // Point efter Col C: spurten (85) er passeret.
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_points", from: { at: "kom", kom_index: 1 } }], "helper", ON), "stage_plan_hunt_no_sprint");
  // Bjergpoint efter Col C: kun topankomsten er tilbage (den afgoeres af maalordenen).
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_kom", from: { at: "kom", kom_index: 1 } }], "helper", ON), "stage_plan_hunt_no_climb");
  // Bjergpoint efter Col B: Col C ligger paa straekningen, men et eget bjergjagt-led efter en top kan
  // ikke vaelges efter valg 1 (dommerens S1 er et aabent ejer-valg).
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }], "helper", ON), "stage_plan_unknown_task");
  // Straekningen slutter ved naeste leds rutepunkt: point frem til Col B (60) har ingen spurt.
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }], "helper", ON), "stage_plan_hunt_no_sprint");
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }], "helper", ON), null);
  // "Sat" er ikke et rutepunkt: straekningen gaar til maal.
  assert.equal(backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }, { task: "ride_in", from: { at: "dropped" } }], "helper", ON), null); // valg 1: paa udbrudsleddet
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_kom", from: { at: "dropped" } }], "helper", ON), "stage_plan_hunt_after_dropped");
});

test("#7855 taendt: roller, pris og bagudkompatible ordre-felter", () => {
  for (const role of ["captain", "co_captain"] as const) {
    assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }], role, ON), "stage_plan_task_not_for_role");
    assert.equal(backend.validateStagePlanLegs([{ task: "hunt_kom" }], role, ON), "stage_plan_task_not_for_role");
  }
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }], "sprint_captain", ON), null);
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_kom" }], "sprint_captain", ON), "stage_plan_task_not_for_role");
  assert.equal(backend.TASK_EFFORT.hunt_points, "protect");
  assert.equal(backend.TASK_EFFORT.hunt_kom, "protect");
  assert.deepEqual(backend.legacyOrderFromPlan([{ task: "hunt_kom" }]), { effort: "protect", try_break: false, leadout: false });
  // Assistenten foreslaar aldrig troejejagt.
  for (const role of ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"] as const) {
    const legs = backend.suggestStagePlan({ role, route: ON, teamHasSprintCaptain: true }) ?? [];
    assert.ok(legs.every((l) => !backend.JERSEY_HUNT_TASKS[l.task]), role);
  }
});

test("#7855 motorens rute: samme spurter og kontakt som API'ets, og slukket uden dem", () => {
  const route = {
    distance_km: 170, profile_type: "mountain",
    waypoints: [
      { kind: "kom", index: 0, name: "Col B", km: 60, category: "1", summit_finish: false },
      { kind: "sprint", index: 0, name: "Spurt", km: 85 },
      { kind: "kom", index: 1, name: "Col C", km: 110, category: "1", summit_finish: false },
      { kind: "kom", index: 2, name: "Top", km: 170, category: "1", summit_finish: true },
      { kind: "finish", index: 0, name: "Finish", km: 170 },
    ],
  } as unknown as RouteV2;
  const off = stagePlanRouteFromV4(route);
  assert.equal("sprints" in off, false);
  assert.equal("jersey_hunt_7855" in off, false);
  const on = stagePlanRouteFromV4(route, { jerseyHunt7855: true });
  assert.deepEqual(on, ON);
});

test("#7855 planen uden jagt: resten staar, jagten bliver til laeet, og kaeden er altid gyldig (slukket)", () => {
  assert.deepEqual(backend.planWithoutJerseyHunt([{ task: "hunt_points" }]), [{ task: "stay_sheltered" }]);
  assert.deepEqual(
    backend.planWithoutJerseyHunt([{ task: "tempo" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }, { task: "ride_in", from: { at: "dropped" } }]),
    [{ task: "tempo" }, { task: "stay_sheltered", from: { at: "kom", kom_index: 0 } }, { task: "ride_in", from: { at: "dropped" } }],
  );
  // To ens led i traek bliver til ét (ellers en stage_plan_repeat_task).
  assert.deepEqual(
    backend.planWithoutJerseyHunt([{ task: "stay_sheltered" }, { task: "hunt_points", from: { at: "kom", kom_index: 0 } }, { task: "tempo", from: { at: "kom", kom_index: 1 } }]),
    [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }],
  );
  assert.equal(backend.planHasJerseyHunt([{ task: "tempo" }]), false);
  // Enhver plan der var gyldig med jagten, er gyldig uden den paa den slukkede rute (samme kode paa frontenden).
  const roles = ["sprint_captain", "helper", "hunter", "free_role"] as const;
  const triggers = [...frontend.allTriggers(ON)];
  for (const role of roles) {
    for (const a of backend.STAGE_PLAN_TASKS) {
      for (const b of backend.STAGE_PLAN_TASKS) {
        for (const from of triggers) {
          const legs = [{ task: a }, { task: b, from }] as backend.StagePlanLeg[];
          if (backend.validateStagePlanLegs(legs, role, ON) !== null || !backend.planHasJerseyHunt(legs)) continue;
          const out = backend.planWithoutJerseyHunt(legs);
          assert.equal(backend.validateStagePlanLegs(out, role, OFF), null, JSON.stringify([role, legs]));
          assert.deepEqual(frontend.planWithoutJerseyHunt(legs), out);
        }
      }
    }
  }
});

// Et hold med en rytter og en rute hvor spurten ligger inde i et segment.
const HUNT_ROUTE = { distance_km: 100, profile_type: "flat", waypoints: [{ kind: "sprint", index: 0, name: "S", km: 75 }, { kind: "finish", index: 0, name: "F", km: 100 }] } as unknown as RouteV2;
const RIDER = { h: { team_id: "t", role: "helper", effort: "normal" } } as unknown as Record<string, Entrant>;
const ORDER = (legs: unknown, extra: Record<string, unknown> = {}) => [{ team_id: "t", kind: STAGE_PLAN_ORDER_KIND, params: { riders: [{ rider_id: "h", legs, ...extra }] } }] as unknown as TeamOrder[];
const STATE = { groups: [{ id: "g", rider_ids: ["h"], gap_seconds: 0, kind: "peloton" }], riders: { h: { rider_id: "h", status: "racing" } } } as unknown as EngineState;
const SEG = (from_km: number, to_km: number) => ({ from_km, to_km, kind: "flat" }) as unknown as Segment;
const FINAL_LEG = [{ task: "tempo" }, { task: "hunt_points", from: { at: "kom", kom_index: 0 } }];

test("#7855 reviewfund 1: planen med jagt falder tilbage paa planen uden jagt, naar kontakten er slukket", () => {
  const legs = [{ task: "hunt_points" }, { task: "ride_in", from: { at: "dropped" } }];
  const fallback = backend.planWithoutJerseyHunt(legs as backend.StagePlanLeg[]);
  const rt = createStagePlanRuntime(ORDER(legs, { fallback_legs: fallback }), HUNT_ROUTE, RIDER);
  assert.ok(rt, "planen droppes ikke");
  assert.equal(stagePlanCurrentTasks(rt)["h"], "stay_sheltered");
  const events = advanceStagePlan(rt, { state: STATE, segment: SEG(0, 50), segmentIndex: 0, entrants: RIDER });
  assert.deepEqual(events, [{ km: 0, type: STAGE_PLAN_HUNT_FALLBACK_EVENT, params: { rider_id: "h" } }], "motoren siger det, en gang");
  assert.deepEqual(advanceStagePlan(rt, { state: STATE, segment: SEG(50, 100), segmentIndex: 1, entrants: RIDER }), []);
  // Taendt koerer han jagten, og tilbagefaldet roeres ikke.
  const on = createStagePlanRuntime(ORDER(legs, { fallback_legs: fallback }), HUNT_ROUTE, RIDER, { jerseyHunt7855: true });
  assert.equal(stagePlanCurrentTasks(on!)["h"], "hunt_points");
  assert.equal(on!.huntFallback7855, undefined);
  // Uden gemt tilbagefald (raekker fra foer, en anden ugyldig plan): ignoreres helt, som hidtil.
  assert.equal(createStagePlanRuntime(ORDER(legs), HUNT_ROUTE, RIDER), null);
});

test("#7855 reviewfund 1: API'et gemmer tilbagefaldet kun for planer med jagt", () => {
  const rider = { rider_id: "h", effort: "normal", try_break: false, leadout: false };
  const hunt = withStagePlan(rider, { plan: [{ task: "hunt_points" }] });
  assert.deepEqual(hunt.plan_no_hunt, [{ task: "stay_sheltered" }]);
  assert.equal("plan_no_hunt" in withStagePlan(rider, { plan: [{ task: "tempo" }] }), false, "uden jagt: samme raekke som foer");
  const order = stagePlanOrderFromRow("t", { riders: [hunt] }, "s5_profiles_v3", () => true);
  assert.deepEqual((order?.params as { riders: unknown[] }).riders, [{ rider_id: "h", legs: [{ task: "hunt_points" }], fallback_legs: [{ task: "stay_sheltered" }] }]);
});

test("#7855 reviewfund 2: et jagt-led er aktivt i det segment, hans passage ligger i", () => {
  const climbRoute = { ...HUNT_ROUTE, waypoints: [{ kind: "kom", index: 0, name: "Top", km: 70, category: "3", summit_finish: false }, ...HUNT_ROUTE.waypoints] } as unknown as RouteV2;
  const on = () => createStagePlanRuntime(ORDER(FINAL_LEG), climbRoute, RIDER, { jerseyHunt7855: true })!;
  // Skift-punktet (70) ligger i segmentets anden halvdel, og spurten (75) i samme segment: han starter nu.
  const rt = on();
  advanceStagePlan(rt, { state: STATE, segment: SEG(0, 60), segmentIndex: 0, entrants: RIDER });
  const events = advanceStagePlan(rt, { state: STATE, segment: SEG(60, 76), segmentIndex: 1, entrants: RIDER });
  assert.equal(stagePlanCurrentTasks(rt)["h"], "hunt_points");
  assert.deepEqual(events.map((e) => e.params), [{ rider_id: "h", leg: 1, task: "hunt_points", reason: "kom" }]);
  assert.deepEqual(stagePlanHuntWindows7855(rt), { h: { fromKm: 70, toKm: Infinity } }, "straekningen er stadig fra hans punkt");
  // Ligger spurten i et senere segment, gaelder den naermeste graense, som for alle andre opgaver.
  const laterSprint = { ...climbRoute, waypoints: climbRoute.waypoints.map((w) => (w.kind === "sprint" ? { ...w, km: 90 } : w)) } as unknown as RouteV2;
  const later = createStagePlanRuntime(ORDER(FINAL_LEG), laterSprint, RIDER, { jerseyHunt7855: true })!;
  advanceStagePlan(later, { state: STATE, segment: SEG(0, 60), segmentIndex: 0, entrants: RIDER });
  assert.deepEqual(advanceStagePlan(later, { state: STATE, segment: SEG(60, 76), segmentIndex: 1, entrants: RIDER }), []);
  assert.equal(stagePlanCurrentTasks(later)["h"], "tempo");
  assert.equal(advanceStagePlan(later, { state: STATE, segment: SEG(76, 100), segmentIndex: 2, entrants: RIDER }).length, 1);
  assert.equal(stagePlanCurrentTasks(later)["h"], "hunt_points");
});

test("#7855 reviewfund 2: jagt-leddet slipper ikke foer segmentet med hans passage er koert", () => {
  const route = { ...HUNT_ROUTE, waypoints: [{ kind: "sprint", index: 0, name: "S", km: 55 }, { kind: "kom", index: 0, name: "Top", km: 58, category: "3", summit_finish: false }, { kind: "finish", index: 0, name: "F", km: 100 }] } as unknown as RouteV2;
  const legs = [{ task: "hunt_points" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }];
  const rt = createStagePlanRuntime(ORDER(legs), route, RIDER, { jerseyHunt7855: true })!;
  advanceStagePlan(rt, { state: STATE, segment: SEG(0, 50), segmentIndex: 0, entrants: RIDER });
  // Punktet (58) ligger i segmentets foerste halvdel, men spurten (55) kommer foer: han jager segmentet ud.
  assert.deepEqual(advanceStagePlan(rt, { state: STATE, segment: SEG(50, 100), segmentIndex: 1, entrants: RIDER }), []);
  assert.equal(stagePlanCurrentTasks(rt)["h"], "hunt_points");
  assert.deepEqual(stagePlanHuntWindows7855(rt), { h: { fromKm: 0, toKm: 58 } });
  // Slukket er der ingen jagt-led, og ingen straekninger.
  const off = createStagePlanRuntime(ORDER([{ task: "tempo" }]), route, RIDER)!;
  assert.equal(stagePlanHuntWindows7855(off), undefined);
});

test("#7855 reviewfund 2: jaegeren kaemper kun om passager paa sin egen straekning", () => {
  const tasks = { a: "hunt_points", b: "hunt_points" } as Record<string, backend.StagePlanTask>;
  const windows = { a: { fromKm: 50, toKm: Infinity }, b: { fromKm: 0, toKm: 40 } };
  const hunters = (km: number) => jerseyHuntersForPassage7855(tasks, "sprint", () => true, { km, windows });
  assert.deepEqual(hunters(30), ["b"]);
  assert.deepEqual(hunters(60), ["a"]);
  assert.deepEqual(hunters(45), []);
  assert.deepEqual(jerseyHuntersForPassage7855(tasks, "sprint", () => true), ["a", "b"], "uden straekninger: som foer");
});

// #7855 valg 3, hul 1 og 2 (ejer 13/11 "Samme pris", 14/11 "Som rent udbrud"): prisen foelger det,
// han faktisk koerte paa udbrudsleddet. Feltet er opdigtet: "h" er hjaelperen, "x" en anden rytter.
const HOLE_RIDERS = { h: { team_id: "t", role: "helper", effort: "normal" }, x: { team_id: "u", role: "hunter", effort: "normal" } } as unknown as Record<string, Entrant>;
const ESCAPE = (ids: string[]) => ({ id: "brk", rider_ids: ids, gap_seconds: 0, kind: "breakaway", origin: "breakaway" });
const FIELD = (ids: string[]) => ({ id: "pel", rider_ids: ids, gap_seconds: 60, kind: "peloton" });
const holeState = (groups: unknown[], passages: unknown[] = []) => ({
  groups,
  riders: { h: { rider_id: "h", status: "racing" }, x: { rider_id: "x", status: "racing" } },
  stage_passages: passages,
}) as unknown as EngineState;
const sprintAt = (km: number, hunters: string[]) => ({ kind: "sprint", index: 0, km, hunters });
const holeRoute = (sprintKm: number) => ({ distance_km: 100, profile_type: "flat", waypoints: [{ kind: "sprint", index: 0, name: "S", km: sprintKm }, { kind: "finish", index: 0, name: "F", km: 100 }] }) as unknown as RouteV2;
const holeRun = (legs: unknown, route: RouteV2) => createStagePlanRuntime(ORDER(legs), route, HOLE_RIDERS, { jerseyHunt7855: true })!;
const WHEN_DROPPED = { task: "ride_in", from: { at: "dropped" } };

test("#7855 hul 2: en tidlig spurt jaget fra feltet taeller, ogsaa naar han ved samme graense skifter til 'naar han er sat'", () => {
  const route = holeRoute(10);
  const ride = (legs: unknown, hunters: string[]) => {
    const rt = holeRun(legs, route);
    advanceStagePlan(rt, { state: holeState([FIELD(["h", "x"])]), segment: SEG(0, 50), segmentIndex: 0, entrants: HOLE_RIDERS });
    // Udbruddet gik uden ham; spurten ved km 10 er koert i feltet.
    advanceStagePlan(rt, { state: holeState([ESCAPE(["x"]), FIELD(["h"])], [sprintAt(10, hunters)]), segment: SEG(50, 100), segmentIndex: 1, entrants: HOLE_RIDERS });
    advanceStagePlanAtFinish(rt, { state: holeState([ESCAPE(["x"]), FIELD(["h"])], [sprintAt(10, hunters)]), segment: SEG(50, 100), entrants: HOLE_RIDERS });
    return rt;
  };
  const both = ride([{ task: "breakaway", hunt: "hunt_points" }, WHEN_DROPPED], ["h"]);
  assert.equal(stagePlanCurrentTasks(both)["h"], "ride_in", "han skiftede til leddet 'naar han er sat' ved samme graense");
  const alone = ride([{ task: "hunt_points" }, WHEN_DROPPED], ["h"]);
  assert.deepEqual(stagePlanLoadEfforts(both), stagePlanLoadEfforts(alone), "samme pris som 'Hent point' alene (ejer 13/11)");
  assert.equal(stagePlanLoadEfforts(both)["h"], backend.TASK_EFFORT.hunt_points, "aldrig billigere end Haard (ejer 7/11)");
  // Koerte han ikke efter spurten, er der ingen jagt fra feltet at prissaette.
  const noChase = ride([{ task: "breakaway", hunt: "hunt_points" }, WHEN_DROPPED], []);
  const plain = ride([{ task: "breakaway" }, WHEN_DROPPED], []);
  assert.deepEqual(stagePlanLoadEfforts(noChase), stagePlanLoadEfforts(plain), "ingen ny pris for noget, han ikke gjorde");
});

test("#7855 hul 1: kommer han med i et sent dannet udbrud uden at jage fra feltet, betaler han som rent udbrud", () => {
  const legs = [{ task: "breakaway", hunt: "hunt_points" }];
  const ride = (sprintKm: number, plan: unknown = legs) => {
    const rt = holeRun(plan, holeRoute(sprintKm));
    advanceStagePlan(rt, { state: holeState([FIELD(["h", "x"])]), segment: SEG(0, 40), segmentIndex: 0, entrants: HOLE_RIDERS });
    // Ved km 40 er der endnu intet udbrud; han sidder i feltet.
    advanceStagePlan(rt, { state: holeState([FIELD(["h", "x"])], sprintKm <= 40 ? [sprintAt(sprintKm, ["h"])] : []), segment: SEG(40, 80), segmentIndex: 1, entrants: HOLE_RIDERS });
    // Ved km 80 ligger han i udbruddet.
    const passages = [sprintAt(sprintKm, ["h"])];
    advanceStagePlan(rt, { state: holeState([ESCAPE(["h"]), FIELD(["x"])], sprintKm <= 80 ? passages : []), segment: SEG(80, 100), segmentIndex: 2, entrants: HOLE_RIDERS });
    advanceStagePlanAtFinish(rt, { state: holeState([ESCAPE(["h"]), FIELD(["x"])], passages), segment: SEG(80, 100), entrants: HOLE_RIDERS });
    return stagePlanLoadEfforts(rt)["h"];
  };
  const pure = ride(90, [{ task: "breakaway" }]);
  assert.equal(pure, backend.TASK_EFFORT.breakaway);
  // Spurten koert fra udbruddet, efter det blev dannet: samme trin som rent udbrud (spurten selv koster oveni, valg C).
  assert.equal(ride(90), pure, "spurten efter han kom med");
  assert.equal(ride(80), pure, "spurten paa graensen, hvor han ligger i udbruddet");
  // Uden for ejerens svar (dommerens nye spoergsmaal): jagede han en spurt fra feltet, foer udbruddet
  // blev dannet, taeller jagten som foer.
  assert.equal(ride(30), backend.TASK_EFFORT.hunt_points, "en spurt jaget fra feltet, foer han kom med");
});

test("#7855 paritet: frontendens kopi giver samme svar, slukket og taendt", () => {
  assert.deepEqual(frontend.stagePlanRouteFromRaw(RAW), OFF);
  assert.deepEqual(frontend.withJerseyHunt7855(frontend.stagePlanRouteFromRaw(RAW), true), ON);
  assert.deepEqual({ ...frontend.JERSEY_HUNT_TASKS }, { ...backend.JERSEY_HUNT_TASKS });
  const triggers = [...frontend.allTriggers(ON), undefined];
  for (const route of [OFF, ON]) {
    for (const role of ["captain", "sprint_captain", "helper", "hunter", "free_role"] as const) {
      for (const a of backend.STAGE_PLAN_TASKS) {
        assert.equal(frontend.validateStagePlanLegs([{ task: a }], role, route), backend.validateStagePlanLegs([{ task: a }], role, route));
        for (const b of backend.STAGE_PLAN_TASKS) {
          for (const from of triggers) {
            const legs = [{ task: a }, from === undefined ? { task: b } : { task: b, from }];
            assert.equal(frontend.validateStagePlanLegs(legs, role, route), backend.validateStagePlanLegs(legs, role, route), JSON.stringify([role, legs, route.jersey_hunt_7855]));
          }
        }
      }
    }
  }
});
