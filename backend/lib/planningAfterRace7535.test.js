// #7535 runde 3: "Efter loebet" skal vaere motorens egen model, aldrig en separat formel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterRaceFatigue7535, loadAfterRaceFatigue7535 } from "./planningAfterRace7535.js";
import { enteringFatigueV2, stageLoadV2 } from "./conditionModelV2.js";

const STAGES = [
  { stage_number: 1, profile_type: "flat", distance_km: 180 },
  { stage_number: 2, profile_type: "mountain", distance_km: 160 },
  { stage_number: 3, profile_type: "itt", distance_km: 30 },
];

test("same result as chaining the engine's own stage load and recovery", () => {
  const seasonRaceDaysByRider = new Map([["a", 12]]);
  const out = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 20, recovery: 70 }], stages: STAGES, seasonRaceDaysByRider, medicalBonus: 0.1, revision: null });
  const loads = STAGES.map((s, k) => stageLoadV2({ profileType: s.profile_type, distanceKm: s.distance_km, stageNumber: s.stage_number, effort: "normal", seasonRaceDays: 12 + k + 1, rulesRevision: null }));
  assert.equal(out.a, enteringFatigueV2({ openingFatigue: 20, priorLoadsToday: loads, recoveryAbility: 70, medicalBonus: 0.1 }));
});

test("stage order follows stage_number, and stages already ridden are skipped", () => {
  const shuffled = [STAGES[2], STAGES[0], STAGES[1]];
  const a = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 50 }], stages: shuffled });
  const b = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 50 }], stages: STAGES });
  assert.deepEqual(a, b);
  const rest = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 50 }], stages: STAGES, stagesCompleted: 3 });
  assert.deepEqual(rest, {});
});

test("a harder race leaves a rider more tired, and a better recoverer less", () => {
  const easy = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 50 }], stages: [STAGES[0]] }).a;
  const hard = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 50 }], stages: [STAGES[1]] }).a;
  assert.ok(hard > easy);
  const slow = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 10 }], stages: STAGES }).a;
  const fast = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 30, recovery: 95 }], stages: STAGES }).a;
  assert.ok(fast <= slow);
});

test("unknown fatigue gives no number", () => {
  const out = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: null }, { rider_id: "b", fatigue: 10 }], stages: STAGES });
  assert.equal("a" in out, false);
  assert.equal(typeof out.b, "number");
});

test("loader: condition model off = disabled, nothing read", async () => {
  let reads = 0;
  const supabase = { from: () => { reads += 1; throw new Error("must not read"); } };
  const res = await loadAfterRaceFatigue7535({ supabase, teamId: "t", raceId: "r", deps: { isConditionModelV2Enabled: async () => false } });
  assert.deepEqual(res, { status: 200, body: { enabled: false, riders: {} } });
  assert.equal(reads, 0);
});

function fakeSupabase(tables) {
  return {
    from(name) {
      const rows = tables[name] ?? [];
      const q = {
        select: () => q, eq: () => q, in: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

test("loader: computes for the team's riders from fatigue now", async () => {
  const supabase = fakeSupabase({
    races: [{ id: "r", season_id: "s", status: "scheduled", stages_completed: 0, engine_rules_revision: null }],
    riders: [{ id: "a" }, { id: "b" }],
    race_stage_profiles: STAGES,
    rider_condition: [{ rider_id: "a", fatigue: 10 }, { rider_id: "b", fatigue: null }],
    rider_derived_abilities: [{ rider_id: "a", recovery: 60 }],
  });
  const res = await loadAfterRaceFatigue7535({
    supabase, teamId: "t", raceId: "r",
    deps: {
      isConditionModelV2Enabled: async () => true,
      fatigueByRiderNow: async () => new Map([["a", 25], ["b", null]]),
      loadSeasonRaceDaysByRider: async () => new Map([["a", 4]]),
      loadTeamMedicalBonus: async () => 0,
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  const expected = afterRaceFatigue7535({ riders: [{ rider_id: "a", fatigue: 25, recovery: 60 }], stages: STAGES, seasonRaceDaysByRider: new Map([["a", 4]]), revision: "legacy" });
  assert.equal(typeof res.body.riders.a, "number");
  assert.equal("b" in res.body.riders, false);
  // Revisionen kommer fra routeMatchRevisionFor; tallet ligger i samme model uanset (normal indsats).
  assert.ok(Math.abs(res.body.riders.a - expected.a) <= 1);
});
