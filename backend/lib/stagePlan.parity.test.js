// #7003: frontendens kopi af etapeplanens kontrakt (StagePlanModel.ts) skal give
// samme svar som SSOT'en (stagePlan.ts) over et gitter af roller, ruter og kaeder.
import test from "node:test";
import assert from "node:assert/strict";
import * as backend from "./stagePlan.ts";
import * as frontend from "../../frontend/src/components/race/StagePlanModel.ts";

const ROLES = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];
const PROFILES = ["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles", "itt", null];
const CLIMB_SETS = [
  [],
  [{ name: "A", crest_km: 50, category: "2" }],
  [{ name: "A", crest_km: 50, category: "2" }, { name: "B", crest_km: 120, category: "1" }],
  [{ name: "A", crest_km: 40, category: "3" }, { name: "B", crest_km: 90, category: "HC" }, { name: "C", crest_km: 150, category: "1", summit_finish: true }],
  [{ name: "Late", crest_km: 145, category: "4" }, { name: "Early", crest_km: 20, category: "3" }],
];

test("#7003: samme ordforraad, indsats, roller og loft", () => {
  assert.deepEqual([...frontend.STAGE_PLAN_TASKS], [...backend.STAGE_PLAN_TASKS]);
  assert.deepEqual({ ...frontend.TASK_EFFORT }, { ...backend.TASK_EFFORT });
  assert.deepEqual(JSON.parse(JSON.stringify(frontend.TASK_ROLES)), JSON.parse(JSON.stringify(backend.TASK_ROLES)));
  assert.deepEqual([...frontend.TERMINAL_TASKS].sort(), [...backend.TERMINAL_TASKS].sort());
  assert.equal(frontend.STAGE_PLAN_MAX_LEGS, backend.STAGE_PLAN_MAX_LEGS);
  assert.equal(frontend.STAGE_PLAN_FINAL_KM, backend.STAGE_PLAN_FINAL_KM);
});

test("#7003: samme rute, samme forslag og samme validering over gitteret", () => {
  for (const profile_type of PROFILES) {
    for (const climbs of CLIMB_SETS) {
      const raw = { distance_km: 160, profile_type, climbs };
      const route = backend.stagePlanRouteFromRaw(raw);
      assert.deepEqual(frontend.stagePlanRouteFromRaw(raw), route);
      const triggers = [undefined, ...frontend.allTriggers(route), { at: "kom", kom_index: 99 }, { at: "soon" }];
      for (const role of ROLES) {
        for (const teamHasSprintCaptain of [false, true]) {
          for (const luxuryHelper of [false, true]) { // #5982: luksushjaelperens standardplan
            assert.deepEqual(
              frontend.suggestStagePlan({ role, route, teamHasSprintCaptain, luxuryHelper }),
              backend.suggestStagePlan({ role, route, teamHasSprintCaptain, luxuryHelper }),
              `${role} ${profile_type} ${luxuryHelper}`,
            );
          }
        }
        // Alle to-leds-kaeder: opgave x opgave x skift-punkt.
        for (const a of backend.STAGE_PLAN_TASKS) {
          assert.equal(frontend.validateStagePlanLegs([{ task: a }], role, route), backend.validateStagePlanLegs([{ task: a }], role, route));
          for (const b of backend.STAGE_PLAN_TASKS) {
            for (const from of triggers) {
              const legs = [{ task: a }, from === undefined ? { task: b } : { task: b, from }];
              assert.equal(frontend.validateStagePlanLegs(legs, role, route), backend.validateStagePlanLegs(legs, role, route), JSON.stringify([role, legs]));
            }
          }
        }
      }
    }
  }
});
