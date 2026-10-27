// #7003: etapeplanens kontrakt (stagePlan.ts). Ingen balance-tal: kun regler og ordforraad.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_PLAN_MAX_LEGS,
  STAGE_PLAN_TASKS,
  TASK_EFFORT,
  TASK_ROLES,
  legacyOrderFromPlan,
  normalizeStagePlanLegs,
  stagePlanRouteFromRaw,
  suggestStagePlan,
  validateStagePlanLegs,
  type StagePlanLeg,
  type StagePlanRole,
  type StagePlanRoute,
} from "./stagePlan.ts";

const ROLES: StagePlanRole[] = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];
const ROUTE: StagePlanRoute = stagePlanRouteFromRaw({
  distance_km: 160,
  profile_type: "mountain",
  climbs: [
    { name: "Col A", crest_km: 70, category: "2" },
    { name: "Col B", crest_km: 120, category: "1" },
    { name: "Bump", crest_km: 30, category: null },
    { name: "Top", crest_km: 160, category: "HC", summit_finish: true },
  ],
});

test("#7003: rutens skift-punkter er kun kategoriserede stigninger foer maal, i km-orden, med raa index", () => {
  assert.deepEqual(ROUTE.climbs.map((c) => [c.index, c.name]), [[0, "Col A"], [1, "Col B"]]);
  assert.equal(ROUTE.summit_finish, true);
});

test("#7003: alle opgaver har en indsats fra de fem trin og mindst en rolle", () => {
  for (const task of STAGE_PLAN_TASKS) {
    assert.ok(["grupetto", "save", "normal", "protect", "all_out"].includes(TASK_EFFORT[task]), task);
    assert.ok(TASK_ROLES[task].length > 0, task);
  }
  assert.ok(!TASK_ROLES.grupetto.includes("captain"), "kaptajnen koerer aldrig grupetto");
});

test("#7003: gyldige kaeder", () => {
  const ok: Array<[StagePlanRole, StagePlanLeg[]]> = [
    ["helper", [{ task: "shelter_leader" }]],
    ["helper", [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }, { task: "grupetto", from: { at: "dropped" } }]],
    ["captain", [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: 1 } }]],
    ["hunter", [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }]],
    ["helper", [{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "final_km" } }]],
    ["free_role", [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }, { task: "attack", from: { at: "final_km" } }]],
  ];
  for (const [role, legs] of ok) assert.equal(validateStagePlanLegs(legs, role, ROUTE), null, JSON.stringify(legs));
});

test("#7003: kun logiske skift (hver regel har sin fejlkode)", () => {
  const cases: Array<[StagePlanRole, unknown, string]> = [
    ["helper", [], "stage_plan_empty"],
    ["helper", "x", "stage_plan_empty"],
    ["helper", Array.from({ length: STAGE_PLAN_MAX_LEGS + 1 }, () => ({ task: "shelter_leader" })), "stage_plan_too_many_legs"],
    ["helper", [{ task: "fly" }], "stage_plan_unknown_task"],
    ["helper", [{ task: "shelter_leader", effort: "all_out" }], "stage_plan_invalid_leg"],
    ["captain", [{ task: "grupetto" }], "stage_plan_task_not_for_role"],
    ["helper", [{ task: "attack" }], "stage_plan_task_not_for_role"],
    ["hunter", [{ task: "shelter_leader" }, { task: "breakaway", from: { at: "final_km" } }], "stage_plan_breakaway_not_first"],
    ["helper", [{ task: "grupetto" }, { task: "shelter_leader", from: { at: "final_km" } }], "stage_plan_terminal_not_last"],
    ["helper", [{ task: "tempo" }, { task: "tempo", from: { at: "final_km" } }], "stage_plan_repeat_task"],
    ["helper", [{ task: "tempo", from: { at: "final_km" } }], "stage_plan_first_has_trigger"],
    ["helper", [{ task: "tempo" }, { task: "grupetto" }], "stage_plan_missing_trigger"],
    ["helper", [{ task: "tempo" }, { task: "grupetto", from: { at: "later" } }], "stage_plan_unknown_trigger"],
    ["helper", [{ task: "tempo" }, { task: "grupetto", from: { at: "kom", kom_index: 2 } }], "stage_plan_unknown_climb"],
    ["helper", [{ task: "shelter_leader" }, { task: "tempo", from: { at: "dropped" } }, { task: "grupetto", from: { at: "final_km" } }], "stage_plan_dropped_not_last"],
    ["helper", [{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "dropped" } }], "stage_plan_train_after_dropped"],
    // Kronologi: Col B (km 120) kan ikke komme foer Col A (km 70); de sidste km kan ikke komme foer en stigning.
    ["helper", [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }, { task: "grupetto", from: { at: "kom", kom_index: 0 } }], "stage_plan_not_chronological"],
    ["captain", [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "final_km" } }, { task: "attack", from: { at: "kom", kom_index: 1 } }], "stage_plan_not_chronological"],
  ];
  for (const [role, legs, code] of cases) assert.equal(validateStagePlanLegs(legs, role, ROUTE), code, JSON.stringify(legs));
  assert.equal(validateStagePlanLegs([{ task: "shelter_leader" }], "helper", { ...ROUTE, profile_type: "itt" }), "stage_plan_time_trial");
});

test("#7003: de gamle ordre-felter udledes af kaeden (aeldre motor koerer foerste opgave)", () => {
  assert.deepEqual(legacyOrderFromPlan([{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }]), { effort: "normal", try_break: true, leadout: false });
  assert.deepEqual(legacyOrderFromPlan([{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "final_km" } }]), { effort: "normal", try_break: false, leadout: true });
  assert.deepEqual(legacyOrderFromPlan([{ task: "stay_sheltered" }]), { effort: "save", try_break: false, leadout: false });
});

test("#7003: normalisering fjerner fremmede noegler og foerste leds skift-punkt", () => {
  const legs = [{ task: "tempo", from: { at: "final_km" }, x: 1 }, { task: "grupetto", from: { at: "kom", kom_index: 1, y: 2 } }] as unknown as StagePlanLeg[];
  assert.deepEqual(normalizeStagePlanLegs(legs), [{ task: "tempo" }, { task: "grupetto", from: { at: "kom", kom_index: 1 } }]);
});

test("#7003: assistentens forslag er altid gyldigt, for alle roller og ruter", () => {
  const profiles = ["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles", "classic", "gravel", null];
  const climbSets = [
    [],
    [{ crest_km: 60, category: "3" }],
    [{ crest_km: 60, category: "3" }, { crest_km: 110, category: "1" }],
    [{ crest_km: 40, category: "2" }, { crest_km: 90, category: "1" }, { crest_km: 155, category: "HC", summit_finish: true }],
    [{ crest_km: 155, category: "4" }], // inde i de sidste km
  ];
  for (const profile_type of profiles) {
    for (const climbs of climbSets) {
      for (const distance_km of [160, 8]) {
        const route = stagePlanRouteFromRaw({ distance_km, profile_type, climbs });
        for (const role of ROLES) {
          for (const teamHasSprintCaptain of [false, true]) {
            const legs = suggestStagePlan({ role, route, teamHasSprintCaptain });
            assert.ok(legs, "et forslag paa en linjeetape");
            assert.equal(validateStagePlanLegs(legs, role, route), null, `${role} ${profile_type} ${JSON.stringify(climbs)} ${distance_km}`);
          }
        }
      }
    }
  }
  assert.equal(suggestStagePlan({ role: "captain", route: { ...ROUTE, profile_type: "itt" }, teamHasSprintCaptain: false }), null);
});

test("#7003: assistenten foelger rolle og rute (eksemplerne fra ejerens billede)", () => {
  assert.deepEqual(suggestStagePlan({ role: "helper", route: ROUTE, teamHasSprintCaptain: false }), [
    { task: "shelter_leader" },
    { task: "tempo", from: { at: "kom", kom_index: 1 } },
    { task: "grupetto", from: { at: "dropped" } },
  ]);
  assert.deepEqual(suggestStagePlan({ role: "captain", route: ROUTE, teamHasSprintCaptain: false }), [
    { task: "stay_sheltered" },
    { task: "attack", from: { at: "kom", kom_index: 1 } },
  ]);
  assert.deepEqual(suggestStagePlan({ role: "hunter", route: ROUTE, teamHasSprintCaptain: false }), [
    { task: "breakaway" },
    { task: "ride_in", from: { at: "dropped" } },
  ]);
  const flat = stagePlanRouteFromRaw({ distance_km: 180, profile_type: "flat", climbs: [] });
  assert.deepEqual(suggestStagePlan({ role: "helper", route: flat, teamHasSprintCaptain: true }), [
    { task: "shelter_leader" },
    { task: "sprint_train", from: { at: "final_km" } },
  ]);
});
