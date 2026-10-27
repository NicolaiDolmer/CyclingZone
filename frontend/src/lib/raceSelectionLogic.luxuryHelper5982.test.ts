// #5982: luksushjaelperen i appen. Klientens regler spejler serverens (samme v3-gate,
// én rolle pr. rytter), et klik paa en rytter nulstiller ikke rollen, og etapeplanen
// foreslaar hans standardplan (genvejen).
import test from "node:test";
import assert from "node:assert/strict";
import * as logic from "./raceSelectionLogic.js";
import * as draft from "./raceSelectionDraft.js";
import { isLuxuryHelperRole, planRole, stagePlanRouteFromRaw, suggestStagePlan } from "../components/race/StagePlanModel.ts";

type Fn<R> = (...args: unknown[]) => R;
const toggleRider = logic.toggleRider as unknown as Fn<Record<string, unknown>>;
const validateSelectionClient = logic.validateSelectionClient as unknown as Fn<string[]>;
const reconcile = draft.reconcileSelectionDraft as unknown as Fn<Record<string, unknown>>;

const size = { min: 1, max: 8 };

test("#5982: luksushjaelperen er gyldig i et loeb der kender rollen og afvises ellers", () => {
  const sel = { riderIds: ["a", "b"], captainId: "a", sprintCaptainId: null, hunterId: null, luxuryHelperId: "b", size };
  assert.deepEqual(validateSelectionClient({ ...sel, sprintLeaderAllowed: true }), []);
  assert.ok(validateSelectionClient({ ...sel, sprintLeaderAllowed: false }).includes("selection_luxury_helper_not_available"));
});

test("#5982: én rolle pr. rytter (luksushjaelperen kan ikke ogsaa vaere kaptajn)", () => {
  const errors = validateSelectionClient({ riderIds: ["a"], captainId: "a", sprintCaptainId: null, hunterId: null, luxuryHelperId: "a", size, sprintLeaderAllowed: true });
  assert.ok(errors.includes("selection_role_overlap"));
});

test("#5982: et klik paa en anden rytter nulstiller ikke luksushjaelperen; fjernes han, ryger rollen", () => {
  const state = { riderIds: ["a", "b"], captainId: "a", sprintCaptainId: null, hunterId: null, luxuryHelperId: "b" };
  assert.equal(toggleRider(state, "c", 8).luxuryHelperId, "b");
  assert.equal(toggleRider(state, "b", 8).luxuryHelperId, null);
  assert.equal("luxuryHelperId" in toggleRider({ riderIds: ["a"], captainId: "a", sprintCaptainId: null, hunterId: null }, "c", 8), false, "uaendret form uden rollen");
});

test("#5982: udkastet holder kun luksushjaelperen mens han er udtaget", () => {
  const riders = [{ id: "a" }, { id: "b" }];
  assert.equal(reconcile({ riderIds: ["a", "b"], captainId: "a", luxuryHelperId: "b", freeRoleIds: [] }, riders).luxuryHelperId, "b");
  assert.equal(reconcile({ riderIds: ["a"], captainId: "a", luxuryHelperId: "b", freeRoleIds: [] }, riders).luxuryHelperId, null);
});

test("#5982: etapeplanen ser luksushjaelperen som hjaelper og foreslaar hans standardplan", () => {
  assert.equal(planRole("luxury_helper"), "helper");
  assert.ok(isLuxuryHelperRole("luxury_helper") && !isLuxuryHelperRole("helper"));
  const route = stagePlanRouteFromRaw({ distance_km: 180, profile_type: "mountain", climbs: [{ name: "A", crest_km: 70, category: "2" }, { name: "B", crest_km: 175, category: "HC" }] });
  assert.deepEqual(suggestStagePlan({ role: "helper", route, teamHasSprintCaptain: false, luxuryHelper: true }), [
    { task: "stay_sheltered" },
    { task: "tempo", from: { at: "kom", kom_index: 0 } },
    { task: "ride_in", from: { at: "dropped" } },
  ]);
});
