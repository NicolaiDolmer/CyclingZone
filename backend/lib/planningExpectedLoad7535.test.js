// #7535 (ejervalg 16/11, punkt 5): "Belastning" er et ord fra motorens egen etapebelastning, og
// intet tal forlader serveren.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedLoad7535, expectedLoadWord, loadExpectedLoad7535, EXPECTED_LOAD_WORDS } from "./planningExpectedLoad7535.js";
import { stageLoadV2 } from "./conditionModelV2.js";

const STAGES = [
  { stage_number: 1, profile_type: "flat", distance_km: 180 },
  { stage_number: 2, profile_type: "mountain", distance_km: 160 },
  { stage_number: 3, profile_type: "itt", distance_km: 30 },
];

test("the word follows the sum of the engine's own stage loads at normal effort", () => {
  const seasonRaceDaysByRider = new Map([["a", 12]]);
  const out = expectedLoad7535({ riderIds: ["a"], stages: STAGES, seasonRaceDaysByRider });
  const total = STAGES.reduce((sum, s, k) => sum + stageLoadV2({ profileType: s.profile_type, distanceKm: s.distance_km, stageNumber: s.stage_number, effort: "normal", seasonRaceDays: 12 + k + 1, rulesRevision: null }), 0);
  assert.equal(out.a, expectedLoadWord(total));
});

test("only words leave the function, never a number", () => {
  const out = expectedLoad7535({ riderIds: ["a", "b"], stages: STAGES });
  for (const value of Object.values(out)) assert.ok(EXPECTED_LOAD_WORDS.includes(value));
});

test("words are ordered: a one-day flat race is lighter than a long mountain race", () => {
  const flat = expectedLoad7535({ riderIds: ["a"], stages: [STAGES[0]] }).a;
  const long = expectedLoad7535({
    riderIds: ["a"],
    stages: Array.from({ length: 6 }, (_, i) => ({ stage_number: i + 1, profile_type: "mountain", distance_km: 180 })),
  }).a;
  assert.equal(flat, "light");
  assert.equal(long, "hard");
  assert.ok(EXPECTED_LOAD_WORDS.indexOf(flat) < EXPECTED_LOAD_WORDS.indexOf(long));
});

test("stage order does not matter, and stages already ridden are skipped", () => {
  const shuffled = [STAGES[2], STAGES[0], STAGES[1]];
  assert.deepEqual(expectedLoad7535({ riderIds: ["a"], stages: shuffled }), expectedLoad7535({ riderIds: ["a"], stages: STAGES }));
  assert.deepEqual(expectedLoad7535({ riderIds: ["a"], stages: STAGES, stagesCompleted: 3 }), {});
});

test("expectedLoadWord: unknown is no word", () => {
  assert.equal(expectedLoadWord(Number.NaN), null);
  assert.equal(expectedLoadWord(undefined), null);
});

test("loader: condition model off = disabled, nothing read", async () => {
  let reads = 0;
  const supabase = { from: () => { reads += 1; throw new Error("must not read"); } };
  const res = await loadExpectedLoad7535({ supabase, teamId: "t", raceId: "r", deps: { isConditionModelV2Enabled: async () => false } });
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

test("loader: a word for each of the team's riders, no numbers in the body", async () => {
  const supabase = fakeSupabase({
    races: [{ id: "r", season_id: "s", status: "scheduled", stages_completed: 0, engine_rules_revision: null }],
    riders: [{ id: "a" }, { id: "b" }],
    race_stage_profiles: STAGES,
  });
  const res = await loadExpectedLoad7535({
    supabase, teamId: "t", raceId: "r",
    deps: { isConditionModelV2Enabled: async () => true, loadSeasonRaceDaysByRider: async () => new Map([["a", 4]]) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  assert.deepEqual(Object.keys(res.body.riders).sort(), ["a", "b"]);
  assert.doesNotMatch(JSON.stringify(res.body), /\d/);
});

test("loader: unknown race is a 404", async () => {
  const supabase = fakeSupabase({ races: [] });
  const res = await loadExpectedLoad7535({ supabase, teamId: "t", raceId: "r", deps: { isConditionModelV2Enabled: async () => true } });
  assert.equal(res.status, 404);
});
