// backend/lib/raceSelection.luxuryHelper5982.test.js
// #5982 (ejer 26/10, S10): validering af luksushjaelperen i
// holdudtagelsen og etape-rollerne.
//   - hoejst én luksushjaelper pr. hold, kun i loeb paa s5_profiles_v3+ (samme gate som den delte kaptajn)
//   - én rolle pr. rytter
//   - et hold uden luksushjaelper gemmer og laeses praecis som foer
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, roleFor } from "./raceSelection.js";
import { validateStageRoleOverrides } from "./raceStageRolesApi.js";
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

test("#5982: luksushjaelper er gyldig i et loeb der kender rollen", () => {
  assert.deepEqual(validateSelection({ ...base, luxuryHelperId: "r2", luxuryHelperAllowed: true }), { ok: true, errors: [] });
});

test("#5982: luksushjaelper afvises i et aeldre loeb (rollen findes ikke dér)", () => {
  assert.ok(validateSelection({ ...base, luxuryHelperId: "r2" }).errors.includes("selection_luxury_helper_not_available"));
});

test("#5982: luksushjaelper skal vaere i truppen og maa ikke have en anden rolle", () => {
  assert.ok(validateSelection({ ...base, luxuryHelperId: "r7", luxuryHelperAllowed: true }).errors.includes("selection_role_not_selected"));
  for (const extra of [{ luxuryHelperId: "r1" }, { hunterId: "r2", luxuryHelperId: "r2" }, { freeRoleIds: ["r2"], luxuryHelperId: "r2" }, { coCaptainId: "r2", coCaptainAllowed: true, luxuryHelperId: "r2" }]) {
    const r = validateSelection({ ...base, luxuryHelperAllowed: true, ...extra });
    assert.ok(r.errors.includes("selection_role_overlap"), JSON.stringify(extra));
    assert.equal(r.errors.filter((e) => e === "selection_role_overlap").length, 1, "fejlkoden staar kun én gang");
  }
});

test("#5982: en delt kaptajn og en luksushjaelper kan staa paa samme hold", () => {
  assert.deepEqual(validateSelection({ ...base, coCaptainId: "r2", coCaptainAllowed: true, luxuryHelperId: "r3", luxuryHelperAllowed: true }), { ok: true, errors: [] });
});

test("#5982: uden luksushjaelper er valideringen uaendret", () => {
  assert.deepEqual(validateSelection(base), { ok: true, errors: [] });
  assert.deepEqual(validateSelection({ ...base, luxuryHelperAllowed: true }), { ok: true, errors: [] });
});

test("#5982: roleFor giver luxury_helper kun naar id'et er sat (uaendret uden)", () => {
  const ids = { captainId: "r1", sprintCaptainId: null, hunterId: null, freeRoleIdSet: new Set() };
  assert.equal(roleFor("r2", ids), "helper");
  assert.equal(roleFor("r2", { ...ids, luxuryHelperId: "r2" }), "luxury_helper");
  assert.equal(roleFor("r1", { ...ids, luxuryHelperId: "r2" }), "captain");
  assert.equal(roleFor("r3", { ...ids, luxuryHelperId: "r2" }), "helper");
});

// ── Etape-roller ─────────────────────────────────────────────────────────────

const STAGE_BASE = { stageCount: 5, stagesCompleted: 0, teamRiderIds: new Set(["r1", "r2", "r3"]), baseRoleByRider: new Map([["r1", "captain"]]) };

test("#5982: en etape-override til luksushjaelper er gyldig i et v3-loeb og afvises i et aeldre", () => {
  const override = [{ stage_number: 1, rider_id: "r2", race_role: "luxury_helper", effort: "normal" }];
  assert.deepEqual(validateStageRoleOverrides({ ...STAGE_BASE, coCaptainAllowed: true, overrides: override }), { ok: true, errors: [] });
  assert.ok(validateStageRoleOverrides({ ...STAGE_BASE, overrides: override }).errors.includes("stage_roles_invalid_role"));
});

test("#5982: hoejst én luksushjaelper pr. etape (basis-rollen taeller med)", () => {
  const two = validateStageRoleOverrides({
    ...STAGE_BASE,
    coCaptainAllowed: true,
    overrides: [
      { stage_number: 1, rider_id: "r2", race_role: "luxury_helper", effort: "normal" },
      { stage_number: 1, rider_id: "r3", race_role: "luxury_helper", effort: "normal" },
    ],
  });
  assert.ok(two.errors.includes("stage_roles_role_overlap"));
  const withBase = validateStageRoleOverrides({
    ...STAGE_BASE,
    coCaptainAllowed: true,
    baseRoleByRider: new Map([["r1", "captain"], ["r3", "luxury_helper"]]),
    overrides: [{ stage_number: 1, rider_id: "r2", race_role: "luxury_helper", effort: "normal" }],
  });
  assert.ok(withBase.errors.includes("stage_roles_role_overlap"));
});

test("#5982: ved afvikling vinder etapens luksushjaelper over basis-rollen (hoejst én effektiv)", () => {
  const entrants = [
    { rider_id: "r1", team_id: "T", race_role: "captain" },
    { rider_id: "r2", team_id: "T", race_role: "luxury_helper" },
    { rider_id: "r3", team_id: "T", race_role: "helper" },
  ];
  const { entrants: out } = resolveStageEntrants(entrants, new Map([["r3", { race_role: "luxury_helper", effort: "normal" }]]));
  const roles = Object.fromEntries(out.map((e) => [e.rider_id, e.race_role]));
  assert.equal(roles.r3, "luxury_helper");
  assert.equal(roles.r2, "helper", "den tidligere luksushjaelper bliver hjaelper paa etapen");
});
