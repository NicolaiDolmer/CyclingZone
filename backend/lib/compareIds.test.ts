// #1857: the race engines must give the same output whatever the machine's
// default locale is. Before the fix, a Danish machine (da-DK, where "aa" is
// read as "å" and sorts last) reordered riders whose ids contain "aa", so a
// replay of a real prod stage did not match the stored output hash.
//
// The determinism tests record one stage's exact engine arguments through the
// real raceRunner path, then replay them (replayEngineInput → simulateStage →
// hashEngineOutput, the same functions prod and replayStage1857.mjs use) with
// the default locale forced to en-US and to da-DK. Both must equal a FROZEN
// hash written from the merge-base code under en-US (what Railway runs), so
// the fix is also proven not to move prod output. Synthetic fixture, no prod
// data.
import test from "node:test";
import assert from "node:assert/strict";

import { compareIds, ENGINE_COLLATION_LOCALE } from "./compareIds.ts";
import { buildStageRowsAccumulated } from "./raceRunner.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { buildSnapshotRows, createEngineInputRecorder, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";

// Written from merge-base 999558295 (before #1857) with the default locale
// forced to en-US. Never regenerate these from new code to make a test pass.
const FROZEN_EN_US = {
  "v4:s5_profiles_v3:1": "a6e52c96f48a0161ec36610dc4b1601b06bcf5b2deba21952ebc135eec1bb44e",
  "v4:s5_profiles_v3:2": "ba58e43526bd7001d3505338f09d3f4cf04328bcc4209c7c95bb273025ac8595",
  "v4:legacy:1": "46074c7a4cb871ef8614f0f892a12f876344666ebf83e1f4718454eb25d54365",
  "v4:legacy:2": "09fc4621b87cbfef64d4322c9956bd1aeb618770a30dbc807a3178db66f0420e",
  "v3:legacy:1": "753ae63fcdc9950610a5a2842124315b37804bf877bd94284be73eb1e0000be3",
  "v3:legacy:2": "406fc9e7bc3f803c51efa6fe34c28b34d86b31c970c7ac63ca00c4b520a76a61",
} as const;

// ── Default-locale emulation ───────────────────────────────────────────────

const nativeLocaleCompare = String.prototype.localeCompare;
const NativeCollator = Intl.Collator;

/**
 * Run `fn` as if the process default locale were `locale`: an argument-less
 * localeCompare or Intl.Collator falls back to it, an explicit locale is kept.
 */
async function withDefaultLocale<T>(locale: string, fn: () => Promise<T> | T): Promise<T> {
  String.prototype.localeCompare = function (this: string, that: string, locales?: string | string[], options?: Intl.CollatorOptions) {
    return nativeLocaleCompare.call(this, that, locales ?? locale, options);
  };
  const Patched = function (locales?: string | string[], options?: Intl.CollatorOptions) {
    return new NativeCollator(locales ?? locale, options);
  } as unknown as typeof Intl.Collator;
  Patched.supportedLocalesOf = NativeCollator.supportedLocalesOf;
  Intl.Collator = Patched;
  try {
    return await fn();
  } finally {
    String.prototype.localeCompare = nativeLocaleCompare;
    Intl.Collator = NativeCollator;
  }
}

// ── Fixture ────────────────────────────────────────────────────────────────

// Ids where en-US and da-DK disagree: "aa…" sorts first in en-US, last in
// da-DK. Every second rider and team gets one, so every id tie-break flips.
const idOf = (i: number, kind: string) => `${i % 2 === 0 ? "aa" : "ab"}${i.toString(16).padStart(6, "0")}-${kind}-4000-8000-1857`;

function abil(seed: number): Record<string, number> {
  const a: Record<string, number> = {};
  ABILITY_KEYS.forEach((k: string, i: number) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

function entrants(n = 24, teams = 4) {
  const perTeam = Math.ceil(n / teams);
  return Array.from({ length: n }, (_, i) => {
    const team = Math.floor(i / perTeam);
    return {
      rider_id: idOf(i, "r"),
      team_id: idOf(team, "t"),
      team_name: `Team ${team}`,
      rider_name: `Rider ${i}`,
      is_u25: i % 4 === 0,
      abilities: abil(i),
      form: 40 + (i % 30),
      fatigue: (i * 3) % 30,
      ...(i % perTeam === 0 ? { race_role: "captain" } : {}),
    };
  });
}

const RACE = { id: "race-1857-locale", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", stages: 2 };

const STAGES = [
  {
    stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    demand_vector: DEMAND_VECTORS.flat, distance_km: 180,
    climbs: [], sprints: [{ name: "Sprint", km: 90, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-1",
  },
  {
    stage_number: 2, profile_type: "mountain", finale_type: "long_climb",
    demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
    climbs: [{ name: "Col", crest_km: 158, category: "1", summit_finish: true }],
    sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
    race_id: RACE.id, id: "sp-2",
  },
];

/** The exact engine arguments of each stage, recorded under en-US. */
async function recordPayloads(engine: "v3" | "v4", rulesRevision: string) {
  return withDefaultLocale("en-US", async () => {
    const v4Engine = engine === "v4" ? await loadRaceEngineV4() : null;
    const payloads = [];
    for (let stageIndex = 0; stageIndex < STAGES.length; stageIndex++) {
      const recorder = createEngineInputRecorder({ raceId: RACE.id });
      buildStageRowsAccumulated({
        race: RACE, stagesSorted: STAGES, stageIndex, entrants: entrants(), pointsLookup: {},
        priorStageRows: [], v3: true, v4Engine, rulesRevision, engineInputRecorder: recorder,
      });
      const [row] = await buildSnapshotRows({ raceId: RACE.id, recorder });
      payloads.push(decodeSnapshot(row));
    }
    return payloads;
  });
}

async function hashesUnder(locale: string, engine: "v3" | "v4", rulesRevision: string) {
  const payloads = await recordPayloads(engine, rulesRevision);
  const out: Record<string, string> = {};
  for (const payload of payloads) {
    const { outputSha256 } = await withDefaultLocale(locale, () => replayEngineInput(payload));
    out[`${payload.engine}:${rulesRevision}:${payload.stageNumber}`] = outputSha256;
  }
  return out;
}

const frozenFor = (engine: string, rulesRevision: string) =>
  Object.fromEntries(Object.entries(FROZEN_EN_US).filter(([k]) => k.startsWith(`${engine}:${rulesRevision}:`)));

// ── compareIds ─────────────────────────────────────────────────────────────

test("compareIds is pinned to en-US, whatever the default locale", async () => {
  assert.equal(ENGINE_COLLATION_LOCALE, "en-US");
  const ids = ["aa1", "ab0", "a9", "daaceb55", "dc8a36e8", "B2", "b1"];
  const expected = [...ids].sort((a, b) => a.localeCompare(b, "en-US"));
  for (const locale of ["en-US", "da-DK", "sv-SE", "de-DE"]) {
    const sorted = await withDefaultLocale(locale, () => [...ids].sort(compareIds));
    assert.deepEqual(sorted, expected, locale);
  }
  assert.ok(compareIds("daaceb55", "dc8a36e8") < 0);
  assert.equal(compareIds("x", "x"), 0);
});

test("the emulation really switches the default locale (guards the tests below)", async () => {
  const daOrder = await withDefaultLocale("da-DK", () => ["aa1", "ab0", "a9"].sort((a, b) => a.localeCompare(b)));
  const enOrder = await withDefaultLocale("en-US", () => ["aa1", "ab0", "a9"].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(daOrder, ["a9", "ab0", "aa1"], "da-DK reads aa as å");
  assert.deepEqual(enOrder, ["a9", "aa1", "ab0"]);
  const ids = entrants().map((e) => e.rider_id);
  const en = await withDefaultLocale("en-US", () => [...ids].sort((a, b) => a.localeCompare(b)));
  const da = await withDefaultLocale("da-DK", () => [...ids].sort((a, b) => a.localeCompare(b)));
  assert.notDeepEqual(en, da, "the fixture ids sort differently in the two locales");
});

// ── Determinism: same hash under en-US and da-DK, equal to the frozen base ──

const CASES = [["v4", "s5_profiles_v3"], ["v4", "legacy"], ["v3", "legacy"]] as const;
for (const [engine, rulesRevision] of CASES) {
  test(`${engine} ${rulesRevision}: simulateStage gives the frozen en-US hash under en-US and da-DK`, async () => {
    const en = await hashesUnder("en-US", engine, rulesRevision);
    const da = await hashesUnder("da-DK", engine, rulesRevision);
    assert.deepEqual(da, en, "the default locale must not change the engine output");
    assert.deepEqual(en, frozenFor(engine, rulesRevision), "prod (en-US) output is unchanged from the merge-base");
  });
}
