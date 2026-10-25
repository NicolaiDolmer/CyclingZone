// backend/lib/raceSelection.sharedCaptain5981.test.js
// #5981 + #6321 (ejer 25/10): validering af holdudtagelsen og etape-rollerne.
//   - hoejst én delt kaptajn pr. hold, kun med en kaptajn, kun i loeb paa s5_profiles_v3+
//   - et hold maa stille op med kun en spurtkaptajn som leder (ogsaa for sprinttoget)
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, roleFor, raceAllowsCoCaptain } from "./raceSelection.js";
import { validateStageRoleOverrides } from "./raceStageRolesApi.js";
import { CURRENT_RACE_RULES_REVISION, isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { buildV4StageInput } from "./raceEngineV4Bridge.js";
import { resolveStageEntrants } from "./raceStageRoles.js";

const base = {
  riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  captainId: "r1",
  sprintCaptainId: null,
  hunterId: null,
  teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]),
  injuredRiderIds: new Set(),
  sizeRule: { min: 6, max: 8 },
};

test("#6321: kun en spurtkaptajn som leder er en gyldig udtagelse", () => {
  assert.deepEqual(validateSelection({ ...base, captainId: null, sprintCaptainId: "r2" }), { ok: true, errors: [] });
});

test("#6321: uden kaptajn OG uden spurtkaptajn kraeves stadig en leder", () => {
  assert.ok(validateSelection({ ...base, captainId: null }).errors.includes("selection_captain_required"));
});

test("#6321: en spurtkaptajn uden for truppen er stadig en fejl", () => {
  assert.ok(validateSelection({ ...base, captainId: null, sprintCaptainId: "r7" }).errors.includes("selection_role_not_selected"));
});

test("#5981: delt kaptajn er gyldig i et loeb der kender rollen, med en kaptajn", () => {
  assert.deepEqual(validateSelection({ ...base, coCaptainId: "r2", coCaptainAllowed: true }), { ok: true, errors: [] });
});

test("#5981: delt kaptajn afvises i et aeldre loeb (rollen findes ikke dér)", () => {
  assert.ok(validateSelection({ ...base, coCaptainId: "r2" }).errors.includes("selection_co_captain_not_available"));
  assert.ok(validateSelection({ ...base, coCaptainId: "r2", coCaptainAllowed: false }).errors.includes("selection_co_captain_not_available"));
});

test("#5981: delt kaptajn kraever en kaptajn (en spurtkaptajn er ikke nok)", () => {
  const r = validateSelection({ ...base, captainId: null, sprintCaptainId: "r3", coCaptainId: "r2", coCaptainAllowed: true });
  assert.ok(r.errors.includes("selection_co_captain_requires_captain"));
});

test("#5981: delt kaptajn maa ikke overlappe en anden rolle og skal vaere i truppen", () => {
  assert.ok(validateSelection({ ...base, coCaptainId: "r1", coCaptainAllowed: true }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, coCaptainId: "r7", coCaptainAllowed: true }).errors.includes("selection_role_not_selected"));
  assert.ok(validateSelection({ ...base, coCaptainId: "r2", freeRoleIds: ["r2"], coCaptainAllowed: true }).errors.includes("selection_role_overlap"));
});

test("#5981: roleFor giver co_captain kun naar id'et er sat (uaendret uden)", () => {
  const ids = { captainId: "r1", sprintCaptainId: null, hunterId: null, freeRoleIdSet: new Set() };
  assert.equal(roleFor("r2", ids), "helper");
  assert.equal(roleFor("r2", { ...ids, coCaptainId: "r2" }), "co_captain");
  assert.equal(roleFor("r1", { ...ids, coCaptainId: "r2" }), "captain");
});

test("#5981: raceAllowsCoCaptain foelger loebets revision (bundet eller aktuel), fail-closed", () => {
  assert.equal(raceAllowsCoCaptain({ stages_completed: 0, engine_rules_revision: "s5_profiles_v3" }), true);
  assert.equal(raceAllowsCoCaptain({ stages_completed: 0, engine_rules_revision: "s5_profiles_v2" }), false);
  assert.equal(raceAllowsCoCaptain({ stages_completed: 3, engine_rules_revision: "s5_profiles_v3" }), true);
  assert.equal(raceAllowsCoCaptain({ stages_completed: 0, engine_rules_revision: "noget_ukendt" }), false);
  assert.equal(raceAllowsCoCaptain(null), isS5ProfilesV3OrLater(CURRENT_RACE_RULES_REVISION), "et ubundet loeb faar den aktuelle revision");
});

// ── Broen: AI-holdets delte kaptajn naar motoren ─────────────────────────────

function bridgeInput(plan) {
  const modules = {
    route: { routeFromStageProfileRow: () => ({ profile_type: "mountain", finale_type: null, distance_km: 10, segments: [], waypoints: [] }) },
    entrants: { entrantFromAbilitiesRow: (row, opts) => ({ rider_id: opts.riderId, role: opts.role ?? "free_role" }) },
    tuning: { RACE_V4_TUNING: {} },
    orders: { buildStageOrderPlan: () => plan },
  };
  return buildV4StageInput({
    modules,
    entrants: [{ rider_id: "a", team_id: "T", race_role: "captain", abilities: {} }, { rider_id: "b", team_id: "T", race_role: "helper", abilities: {} }],
    stageProfile: { stage_number: 2, profile_type: "mountain", distance_km: 150 },
    seedString: "race:5981:2",
    stageNumber: 2,
    rulesRevision: "s5_profiles_v3",
  });
}

test("#5981 broen: planens aiRoleByRider giver motoren rollen; uden den er rollen uaendret", () => {
  const roles = (input) => Object.fromEntries(input.startlist.map((e) => [e.rider_id, e.role]));
  assert.deepEqual(roles(bridgeInput({ orders: [], aiEffortByRider: new Map() })), { a: "captain", b: "helper" });
  assert.deepEqual(roles(bridgeInput({ orders: [], aiEffortByRider: new Map(), aiRoleByRider: new Map([["b", "co_captain"]]) })), { a: "captain", b: "co_captain" });
});

// ── Etape-roller ─────────────────────────────────────────────────────────────

const STAGE_BASE = { stageCount: 5, stagesCompleted: 0, teamRiderIds: new Set(["r1", "r2", "r3"]), baseRoleByRider: new Map([["r1", "captain"]]) };

test("#5981: en etape-override til delt kaptajn kraever en kaptajn paa etapen", () => {
  const sprintOnly = validateStageRoleOverrides({
    ...STAGE_BASE,
    coCaptainAllowed: true,
    baseRoleByRider: new Map([["r1", "sprint_captain"]]),
    overrides: [{ stage_number: 1, rider_id: "r2", race_role: "co_captain", effort: "normal" }],
  });
  assert.ok(sprintOnly.errors.includes("stage_roles_co_captain_requires_captain"));
  const abandonedCaptain = validateStageRoleOverrides({
    ...STAGE_BASE,
    coCaptainAllowed: true,
    abandonedRiderIds: new Set(["r1"]),
    overrides: [{ stage_number: 1, rider_id: "r2", race_role: "co_captain", effort: "normal" }],
  });
  assert.deepEqual(abandonedCaptain, { ok: true, errors: [] }, "en udgaaet basis-kaptajn blokerer ikke arven");
});

test("#5981: ved afvikling vinder etapens delte kaptajn over basis-rollen (hoejst én effektiv)", () => {
  const entrants = [
    { rider_id: "r1", team_id: "T", race_role: "captain" },
    { rider_id: "r2", team_id: "T", race_role: "co_captain" },
    { rider_id: "r3", team_id: "T", race_role: "helper" },
  ];
  const { entrants: out } = resolveStageEntrants(entrants, new Map([["r3", { race_role: "co_captain", effort: "normal" }]]));
  const roles = Object.fromEntries(out.map((e) => [e.rider_id, e.race_role]));
  assert.equal(roles.r3, "co_captain");
  assert.notEqual(roles.r2, "co_captain");
});

test("#5981: en etape-override til co_captain afvises i et aeldre loeb", () => {
  const r = validateStageRoleOverrides({ ...STAGE_BASE, overrides: [{ stage_number: 1, rider_id: "r2", race_role: "co_captain", effort: "normal" }] });
  assert.ok(r.errors.includes("stage_roles_invalid_role"));
});

test("#5981: hoejst én delt kaptajn pr. etape", () => {
  const one = validateStageRoleOverrides({ ...STAGE_BASE, coCaptainAllowed: true, overrides: [{ stage_number: 1, rider_id: "r2", race_role: "co_captain", effort: "normal" }] });
  assert.deepEqual(one, { ok: true, errors: [] });
  const two = validateStageRoleOverrides({
    ...STAGE_BASE,
    coCaptainAllowed: true,
    overrides: [
      { stage_number: 1, rider_id: "r2", race_role: "co_captain", effort: "normal" },
      { stage_number: 1, rider_id: "r3", race_role: "co_captain", effort: "normal" },
    ],
  });
  assert.ok(two.errors.includes("stage_roles_role_overlap"));
  const withBase = validateStageRoleOverrides({
    ...STAGE_BASE,
    coCaptainAllowed: true,
    baseRoleByRider: new Map([["r3", "co_captain"]]),
    overrides: [{ stage_number: 1, rider_id: "r2", race_role: "co_captain", effort: "normal" }],
  });
  assert.ok(withBase.errors.includes("stage_roles_role_overlap"), "basis-rollen taeller med (#4344)");
});
