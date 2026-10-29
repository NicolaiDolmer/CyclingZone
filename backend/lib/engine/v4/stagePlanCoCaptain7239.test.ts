// #7239: etapeplanen behandler den delte kaptajn (#5981) som kaptajn, ikke som fri rolle.
// Ingen balance-tal: kun regler.
import test from "node:test";
import assert from "node:assert/strict";
import type { EngineState, Entrant, RaceGroup, RouteV2, TeamOrder } from "./types.ts";
import { STAGE_PLAN_ORDER_KIND, createStagePlanRuntime, isRiderDropped } from "../../stagePlanEngine.ts";
import { stagePlanRouteFromRaw, suggestStagePlan, validateStagePlanLegs } from "../../stagePlan.ts";

function entrant(id: string, team: string, role: Entrant["role"]): Entrant {
  return { rider_id: id, abilities: {} as Entrant["abilities"], role, effort: "normal", condition: 1, team_id: team };
}

function stateWith(groups: RaceGroup[], out: string[] = []): EngineState {
  const riders: EngineState["riders"] = {};
  for (const g of groups) for (const id of g.rider_ids) {
    riders[id] = { rider_id: id, group_id: g.id, cp: 1, wprimeMax: 1, wprime: 1, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
  }
  for (const id of out) riders[id] = { ...riders[id], status: "abandoned" };
  return { km: 50, groups, riders, virtual_gc: {} };
}

const MOUNTAIN = stagePlanRouteFromRaw({
  distance_km: 160,
  profile_type: "mountain",
  climbs: [{ name: "A", crest_km: 70, category: "2" }, { name: "B", crest_km: 120, category: "1" }],
});
const FLAT = stagePlanRouteFromRaw({ distance_km: 160, profile_type: "flat", climbs: [] });

test("#7239: delt kaptajn har kaptajnens opgaver (foelg angreb ja, grupetto og hjaelperarbejde nej)", () => {
  for (const route of [MOUNTAIN, FLAT]) {
    for (const task of ["follow_moves", "attack", "ride_for_result", "stay_sheltered", "breakaway", "ride_in"] as const) {
      assert.equal(validateStagePlanLegs([{ task }], "co_captain", route), validateStagePlanLegs([{ task }], "captain", route), task);
    }
    assert.equal(validateStagePlanLegs([{ task: "grupetto" }], "co_captain", route), "stage_plan_task_not_for_role");
    assert.equal(validateStagePlanLegs([{ task: "shelter_leader" }], "co_captain", route), "stage_plan_task_not_for_role");
    assert.equal(validateStagePlanLegs([{ task: "sprint_train" }], "co_captain", route), "stage_plan_task_not_for_role");
  }
});

test("#7239: assistenten foreslaar kaptajnens plan til den delte kaptajn", () => {
  for (const route of [MOUNTAIN, FLAT]) {
    for (const teamHasSprintCaptain of [false, true]) {
      assert.deepEqual(
        suggestStagePlan({ role: "co_captain", route, teamHasSprintCaptain }),
        suggestStagePlan({ role: "captain", route, teamHasSprintCaptain }),
      );
    }
  }
});

test("#7239: motoren tager imod en lederplan for den delte kaptajn og afviser en hjaelperplan", () => {
  const route = { distance_km: 160, profile_type: "flat", waypoints: [] } as unknown as RouteV2;
  const entrants = { cap: entrant("cap", "A", "captain"), co: entrant("co", "A", "co_captain"), h: entrant("h", "A", "helper") };
  const order = (legs: unknown): TeamOrder => ({ team_id: "A", kind: STAGE_PLAN_ORDER_KIND, params: { riders: [{ rider_id: "co", legs }] } });
  assert.ok(createStagePlanRuntime([order([{ task: "follow_moves" }])], route, entrants)?.legs.has("co"));
  assert.equal(createStagePlanRuntime([order([{ task: "shelter_leader" }])], route, entrants), null);
});

test("#7239: er kaptajnen ude, er hjaelperen sat i forhold til den delte kaptajn", () => {
  const entrants = { cap: entrant("cap", "A", "captain"), co: entrant("co", "A", "co_captain"), h: entrant("h", "A", "helper"), x: entrant("x", "B", "captain") };
  const front: RaceGroup = { id: "p0", kind: "peloton", rider_ids: ["x"], gap_seconds: 0, cohesion: 1 };
  const mid: RaceGroup = { id: "c1", kind: "chase", rider_ids: ["co", "h"], gap_seconds: 30, cohesion: 1 };
  // Med kaptajnen i forreste gruppe er hjaelperen sat.
  const withCap = stateWith([{ ...front, rider_ids: ["x", "cap"] }, mid]);
  assert.equal(isRiderDropped("h", withCap, entrants), true);
  // Kaptajnen er udgaaet: holdet koerer for den delte kaptajn, og hjaelperen er ved ham.
  const capOut = stateWith([{ ...front, rider_ids: ["x", "cap"] }, mid], ["cap"]);
  assert.equal(isRiderDropped("h", capOut, entrants), false);
});
