// #7535 (ejervalg 16/11, punkt 5): "Belastning" er et ord fra motorens egen etapebelastning, og
// intet tal forlader serveren.
//
// #8294 (hard rule 17): graenserne mellem ordene bor kun i private_config. Testene bruger INJICEREDE,
// OPDIGTEDE testgraenser (FAKE_THRESHOLDS), afledt af motorens egne etapebelastninger her i testen,
// aldrig de rigtige vaerdier og aldrig den rigtige kilde.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expectedLoad7535, expectedLoadWord, loadExpectedLoad7535, readPlanningExpectedLoadThresholds,
  EXPECTED_LOAD_WORDS, PLANNING_EXPECTED_LOAD_KEY,
} from "./planningExpectedLoad7535.js";
import { validatePlanningExpectedLoadThresholds } from "./planningExpectedLoad7535Params.js";
import { PRIVATE_CONFIG_KEYS, clearPrivateConfigCache } from "./privateConfig.ts";
import { stageLoadV2 } from "./conditionModelV2.js";

const STAGES = [
  { stage_number: 1, profile_type: "flat", distance_km: 180 },
  { stage_number: 2, profile_type: "mountain", distance_km: 160 },
  { stage_number: 3, profile_type: "itt", distance_km: 30 },
];
const LONG_MOUNTAIN = Array.from({ length: 6 }, (_, i) => ({ stage_number: i + 1, profile_type: "mountain", distance_km: 180 }));

function engineTotal(stages, baseDays = 0) {
  return stages.reduce((sum, s, k) => sum + stageLoadV2({
    profileType: s.profile_type, distanceKm: s.distance_km, stageNumber: s.stage_number,
    effort: "normal", seasonRaceDays: baseDays + k + 1, rulesRevision: null,
  }), 0);
}

// TESTVAERDIER (opdigtede): tredjedele mellem et fladt endagsloeb og et langt bjergloeb.
const FLAT_TOTAL = engineTotal([STAGES[0]]);
const LONG_TOTAL = engineTotal(LONG_MOUNTAIN);
const FAKE_THRESHOLDS = Object.freeze({
  lightBelow: FLAT_TOTAL + (LONG_TOTAL - FLAT_TOTAL) / 3,
  hardFrom: FLAT_TOTAL + (2 * (LONG_TOTAL - FLAT_TOTAL)) / 3,
});

test("test thresholds are well-formed (a flat one-day race is lighter than a long mountain race)", () => {
  assert.ok(FLAT_TOTAL < LONG_TOTAL);
  assert.deepEqual(validatePlanningExpectedLoadThresholds(FAKE_THRESHOLDS), FAKE_THRESHOLDS);
});

test("the word follows the sum of the engine's own stage loads at normal effort", () => {
  const seasonRaceDaysByRider = new Map([["a", 12]]);
  const out = expectedLoad7535({ riderIds: ["a"], stages: STAGES, seasonRaceDaysByRider, thresholds: FAKE_THRESHOLDS });
  assert.equal(out.a, expectedLoadWord(engineTotal(STAGES, 12), FAKE_THRESHOLDS));
});

test("only words leave the function, never a number", () => {
  const out = expectedLoad7535({ riderIds: ["a", "b"], stages: STAGES, thresholds: FAKE_THRESHOLDS });
  assert.deepEqual(Object.keys(out).sort(), ["a", "b"]);
  for (const value of Object.values(out)) assert.ok(EXPECTED_LOAD_WORDS.includes(value));
});

test("words are ordered: a one-day flat race is lighter than a long mountain race", () => {
  const flat = expectedLoad7535({ riderIds: ["a"], stages: [STAGES[0]], thresholds: FAKE_THRESHOLDS }).a;
  const long = expectedLoad7535({ riderIds: ["a"], stages: LONG_MOUNTAIN, thresholds: FAKE_THRESHOLDS }).a;
  assert.equal(flat, "light");
  assert.equal(long, "hard");
  assert.equal(expectedLoadWord((FAKE_THRESHOLDS.lightBelow + FAKE_THRESHOLDS.hardFrom) / 2, FAKE_THRESHOLDS), "medium");
});

test("stage order does not matter, and stages already ridden are skipped", () => {
  const shuffled = [STAGES[2], STAGES[0], STAGES[1]];
  const args = { riderIds: ["a"], thresholds: FAKE_THRESHOLDS };
  assert.deepEqual(expectedLoad7535({ ...args, stages: shuffled }), expectedLoad7535({ ...args, stages: STAGES }));
  assert.deepEqual(expectedLoad7535({ ...args, stages: STAGES, stagesCompleted: 3 }), {});
});

test("expectedLoadWord: unknown total or missing thresholds is no word", () => {
  assert.equal(expectedLoadWord(Number.NaN, FAKE_THRESHOLDS), null);
  assert.equal(expectedLoadWord(undefined, FAKE_THRESHOLDS), null);
  assert.equal(expectedLoadWord(FLAT_TOTAL, null), null);
  assert.equal(expectedLoadWord(FLAT_TOTAL, undefined), null);
});

test("without thresholds no rider gets a word (fail-safe)", () => {
  assert.deepEqual(expectedLoad7535({ riderIds: ["a"], stages: STAGES }), {});
  assert.deepEqual(expectedLoad7535({ riderIds: ["a"], stages: STAGES, thresholds: null }), {});
});

test("validator: only two positive numbers with light below hard pass", () => {
  for (const bad of [null, "x", [], {}, { lightBelow: 1 }, { lightBelow: 2, hardFrom: 1 }, { lightBelow: 1, hardFrom: 1 },
    { lightBelow: -1, hardFrom: 1 }, { lightBelow: Number.NaN, hardFrom: 1 }, { lightBelow: "1", hardFrom: "2" }]) {
    assert.equal(validatePlanningExpectedLoadThresholds(bad), null, JSON.stringify(bad));
  }
});

test("the key is registered in private_config with the same validator", () => {
  const spec = PRIVATE_CONFIG_KEYS[PLANNING_EXPECTED_LOAD_KEY];
  assert.ok(spec);
  assert.equal(spec.private, true);
  assert.equal(spec.parse, validatePlanningExpectedLoadThresholds);
});

test("loader: condition model off = disabled, nothing read", async () => {
  let reads = 0;
  const supabase = { from: () => { reads += 1; throw new Error("must not read"); } };
  const res = await loadExpectedLoad7535({
    supabase, teamId: "t", raceId: "r",
    deps: { isConditionModelV2Enabled: async () => false, readThresholds: async () => { reads += 1; return FAKE_THRESHOLDS; } },
  });
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

const RACE_TABLES = {
  races: [{ id: "r", season_id: "s", status: "scheduled", stages_completed: 0, engine_rules_revision: null }],
  riders: [{ id: "a" }, { id: "b" }],
  race_stage_profiles: STAGES,
};

test("loader: a word for each of the team's riders, no numbers in the body", async () => {
  const res = await loadExpectedLoad7535({
    supabase: fakeSupabase(RACE_TABLES), teamId: "t", raceId: "r",
    deps: {
      isConditionModelV2Enabled: async () => true,
      readThresholds: async () => FAKE_THRESHOLDS,
      loadSeasonRaceDaysByRider: async () => new Map([["a", 4]]),
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  assert.deepEqual(Object.keys(res.body.riders).sort(), ["a", "b"]);
  assert.doesNotMatch(JSON.stringify(res.body), /\d/);
});

test("loader: missing or invalid thresholds = no word, same answer as a disabled model", async () => {
  let raceReads = 0;
  const supabase = { from: () => { raceReads += 1; throw new Error("must not read races"); } };
  const res = await loadExpectedLoad7535({
    supabase, teamId: "t", raceId: "r",
    deps: { isConditionModelV2Enabled: async () => true, readThresholds: async () => null },
  });
  assert.deepEqual(res, { status: 200, body: { enabled: false, riders: {} } });
  assert.equal(raceReads, 0);
});

test("loader: unknown race is a 404", async () => {
  const res = await loadExpectedLoad7535({
    supabase: fakeSupabase({ races: [] }), teamId: "t", raceId: "r",
    deps: { isConditionModelV2Enabled: async () => true, readThresholds: async () => FAKE_THRESHOLDS },
  });
  assert.equal(res.status, 404);
});

test("readPlanningExpectedLoadThresholds: valid row = the thresholds, missing/invalid = null with a number-free warning", async () => {
  clearPrivateConfigCache();
  const warnings = [];
  const log = { warn: (m) => warnings.push(String(m)) };
  let clock = 1_000_000_000;
  const now = () => clock;

  const ok = await readPlanningExpectedLoadThresholds({ supabase: fakeSupabase({ private_config: [{ value: FAKE_THRESHOLDS }] }), log, now });
  assert.deepEqual(ok, FAKE_THRESHOLDS);
  assert.equal(warnings.length, 0);

  const missing = await readPlanningExpectedLoadThresholds({ supabase: fakeSupabase({ private_config: [] }), log, now });
  assert.equal(missing, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(PLANNING_EXPECTED_LOAD_KEY));

  // Samme advarsel gentages ikke straks (et loeb der aabnes mange gange fylder ikke loggen).
  await readPlanningExpectedLoadThresholds({ supabase: fakeSupabase({ private_config: [] }), log, now });
  assert.equal(warnings.length, 1);

  const invalid = await readPlanningExpectedLoadThresholds({
    supabase: fakeSupabase({ private_config: [{ value: { lightBelow: FAKE_THRESHOLDS.hardFrom, hardFrom: FAKE_THRESHOLDS.lightBelow } }] }), log, now,
  });
  assert.equal(invalid, null);
  assert.equal(warnings.length, 2);

  for (const w of warnings) {
    assert.ok(!w.includes(String(FAKE_THRESHOLDS.lightBelow)) && !w.includes(String(FAKE_THRESHOLDS.hardFrom)), "the warning never names the values");
  }
  clearPrivateConfigCache();
});
