// #7003: etapeplanen i ordre-API'et. Gate, validering mod rute + effektiv rolle,
// og bagudkompatibel normalisering (de gamle felter udledes af kaeden).
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTeamOrder, validateTeamOrder } from "./raceTeamOrdersApi.js";
import {
  STAGE_PLAN_FLAG_KEY,
  isStagePlanEnabled,
  loadStagePlanContext,
  orderHasStagePlan,
  stagePlanRevisionOk,
  validateRiderPlans,
  withStagePlan,
} from "./stagePlanApi.js";
import { stagePlanRouteFromRaw } from "./stagePlan.ts";

const ROUTE = stagePlanRouteFromRaw({
  distance_km: 150,
  profile_type: "mountain",
  climbs: [{ name: "Col A", crest_km: 60, category: "2" }, { name: "Col B", crest_km: 110, category: "1" }],
});
const STAGE_PLAN = { route: ROUTE, roleByRider: new Map([["h1", "helper"], ["c1", "captain"]]), hasRoute: true };
const BASE = {
  raceCompleted: false,
  stageNumber: 2,
  stageCount: 3,
  stagesCompleted: 0,
  scheduledAt: null,
  teamRiderIds: new Set(["h1", "c1"]),
  intentionEnabled: true,
};
const HELPER_PLAN = [
  { task: "shelter_leader" },
  { task: "tempo", from: { at: "kom", kom_index: 0 } },
  { task: "grupetto", from: { at: "dropped" } },
];

test("#7003: uden plan-kontekst er `plan` stadig et ukendt felt (flag off = som i dag)", () => {
  const order = { riders: [{ rider_id: "h1", effort: "normal", try_break: false, leadout: false, plan: HELPER_PLAN }] };
  assert.deepEqual(validateTeamOrder({ ...BASE, order }).errors, ["team_orders_unknown_field"]);
  assert.equal(validateTeamOrder({ ...BASE, order, stagePlan: STAGE_PLAN }).ok, true);
});

test("#7003: planen valideres mod rytterens effektive rolle og etapens rute", () => {
  const bad = { riders: [{ rider_id: "c1", effort: "normal", plan: [{ task: "grupetto" }] }] };
  assert.deepEqual(validateTeamOrder({ ...BASE, order: bad, stagePlan: STAGE_PLAN }).errors, ["stage_plan_task_not_for_role"]);
  const unknownClimb = { riders: [{ rider_id: "h1", effort: "normal", plan: [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 7 } }] }] };
  assert.deepEqual(validateTeamOrder({ ...BASE, order: unknownClimb, stagePlan: STAGE_PLAN }).errors, ["stage_plan_unknown_climb"]);
  assert.equal(validateRiderPlans([{ rider_id: "h1", plan: HELPER_PLAN }], { ...STAGE_PLAN, hasRoute: false }), "stage_plan_no_route");
  assert.equal(validateRiderPlans([{ rider_id: "h1", plan: null }], STAGE_PLAN), null, "plan: null = ingen plan");
});

test("#7003: gem udleder de gamle felter af kaeden og gemmer kaeden kanonisk", () => {
  const order = {
    breakaway_stance: "neutral",
    riders: [
      { rider_id: "h1", effort: "all_out", try_break: true, leadout: true, plan: HELPER_PLAN },
      { rider_id: "c1", effort: "save", try_break: false, leadout: false },
    ],
  };
  const normalized = normalizeTeamOrder(order);
  assert.deepEqual(normalized.riders[0], { rider_id: "h1", effort: "normal", try_break: false, leadout: false, plan: HELPER_PLAN });
  assert.deepEqual(normalized.riders[1], { rider_id: "c1", effort: "save", try_break: false, leadout: false }, "rytter uden plan er uaendret");
  assert.deepEqual(withStagePlan({ rider_id: "x" }, { plan: null }), { rider_id: "x" });
});

test("#7003: planen kraever s5_profiles_v3 (gemt revision, ellers den aktuelle for et ikke-startet loeb)", () => {
  assert.equal(stagePlanRevisionOk({ engine_rules_revision: "s5_profiles_v3", stages_completed: 1 }), true);
  assert.equal(stagePlanRevisionOk({ engine_rules_revision: "s5_profiles_v2", stages_completed: 0 }), false);
  assert.equal(stagePlanRevisionOk({ engine_rules_revision: null, stages_completed: 3 }), false);
  assert.equal(orderHasStagePlan({ riders: [{ rider_id: "a" }] }), false);
  assert.equal(orderHasStagePlan({ riders: [{ rider_id: "a", plan: null }] }), true);
});

function flagClient(value) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) };
}

test("#7003: stage_plan_v1 er slukket som default; on aabner for alle, beta kun for beta-testere", async () => {
  assert.equal(STAGE_PLAN_FLAG_KEY, "stage_plan_v1");
  assert.equal(await isStagePlanEnabled(flagClient(undefined)), false, "manglende raekke = off");
  assert.equal(await isStagePlanEnabled(flagClient("off")), false);
  assert.equal(await isStagePlanEnabled(flagClient("on")), true);
  assert.equal(await isStagePlanEnabled(flagClient("beta")), false);
  assert.equal(await isStagePlanEnabled(flagClient("beta"), { isBetaTester: true }), true);
});

function fakeSupabase({ profile, stageRoles }) {
  return {
    from(table) {
      const q = {
        select() { return q; },
        eq() { return q; },
        in() { return Promise.resolve({ data: stageRoles, error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === "race_stage_profiles" ? profile : null, error: null }); },
      };
      return q;
    },
  };
}

test("#7003: konteksten bruger etape-rollen foran holdudtagelsens rolle", async () => {
  const ctx = await loadStagePlanContext({
    supabase: fakeSupabase({
      profile: { distance_km: 150, profile_type: "mountain", climbs: [{ crest_km: 60, category: "2" }] },
      stageRoles: [{ rider_id: "h1", race_role: "hunter" }, { rider_id: "c1", race_role: null }],
    }),
    raceId: "r",
    stageNumber: 2,
    baseRoleByRider: new Map([["h1", "helper"], ["c1", "captain"], ["z", null]]),
  });
  assert.deepEqual([...ctx.roleByRider], [["h1", "hunter"], ["c1", "captain"], ["z", "free_role"]]);
  assert.equal(ctx.route.climbs.length, 1);
  assert.equal(ctx.hasRoute, true);
});
