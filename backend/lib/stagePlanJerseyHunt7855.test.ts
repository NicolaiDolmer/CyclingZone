// #7855: troejejagtens opgaver i etapeplanens kontrakt (stagePlan.ts) og frontendens kopi.
import test from "node:test";
import assert from "node:assert/strict";
import * as backend from "./stagePlan.ts";
import * as frontend from "../../frontend/src/components/race/StagePlanModel.ts";
import { stagePlanRouteFromV4 } from "./stagePlanEngine.ts";
import type { RouteV2 } from "./engine/v4/types.ts";

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
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_kom" }], "helper", ON), null);
  // Point efter Col C: spurten (85) er passeret.
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_points", from: { at: "kom", kom_index: 1 } }], "helper", ON), "stage_plan_hunt_no_sprint");
  // Bjergpoint efter Col C: kun topankomsten er tilbage (den afgoeres af maalordenen).
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_kom", from: { at: "kom", kom_index: 1 } }], "helper", ON), "stage_plan_hunt_no_climb");
  // Bjergpoint efter Col B: Col C ligger paa straekningen.
  assert.equal(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }], "helper", ON), null);
  // Straekningen slutter ved naeste leds rutepunkt: point frem til Col B (60) har ingen spurt.
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }], "helper", ON), "stage_plan_hunt_no_sprint");
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }], "helper", ON), null);
  // "Sat" er ikke et rutepunkt: straekningen gaar til maal.
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_kom" }, { task: "ride_in", from: { at: "dropped" } }], "helper", ON), null);
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
