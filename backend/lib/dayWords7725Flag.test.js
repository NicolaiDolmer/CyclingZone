// #7725 (ejer 5/11): dagsformen i ord efter etapen, bag kontakten day_words_7725.
//
// Slukket = bit-identisk med merge-basen: __fixtures__/raceRunner7725FlagOff.json er
// skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier og
// genereres aldrig med den nye kode. Taendt = kun tidslinjen aendres: resultatraekker,
// run-identitet og motorens output er de samme. Kun hashes; syntetisk fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DAY_WORDS_7725_FLAG_KEY, evaluateDayWords7725Flag, isDayWords7725Enabled } from "./dayWords7725Flag.js";
import { resolveRaceEngineV4, v4DayWords7725Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { buildRaceStory } from "./raceStory.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7725, RACE_7725, computeOffDigests7725, digests7725, stageByStage7725, stages7725, wholeRace7725,
} from "./__fixtures__/raceRunner7725Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7725FlagOff.json", import.meta.url), "utf8"));

function configStub(value, { error = null, throws = false } = {}) {
  const seen = [];
  return {
    seen,
    from(table) {
      if (throws) throw new Error("boom");
      return {
        select: () => ({
          eq: (col, key) => {
            seen.push([table, col, key]);
            return { maybeSingle: async () => (error ? { data: null, error } : { data: value === undefined ? null : { value }, error: null }) };
          },
        }),
      };
    },
  };
}

const wordsOf = (timeline) => timeline.events.filter((e) => e.type === "day_word");

test("#7725 flag: kun den eksakte streng 'on' taender, fail-safe slukket ved fravaer og fejl", async () => {
  assert.equal(DAY_WORDS_7725_FLAG_KEY, "day_words_7725");
  assert.equal(evaluateDayWords7725Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateDayWords7725Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
  const on = configStub("on");
  assert.equal(await isDayWords7725Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "day_words_7725"]]);
  assert.equal(await isDayWords7725Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isDayWords7725Enabled(configStub("on", { error: { message: "x" } })), false, "opslagsfejl");
  assert.equal(await isDayWords7725Enabled(configStub("on", { throws: true })), false, "kast");
});

test("#7725 flag: registreret i stadie-kataloget", () => {
  assert.equal(isStageFlagKey(DAY_WORDS_7725_FLAG_KEY), true);
  assert.equal(findStageFlag(DAY_WORDS_7725_FLAG_KEY).area, "race-engine");
});

test("#7725 resolveRaceEngineV4: slukket/fejl = samme motor som foer; taendt = kun en markering", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7725, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
    checkStagePlanDroppedFront7635Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => false,
    checkSplitAttackCause7640Enabled: async () => false, checkLetGoOrder7557Enabled: async () => false,
  };
  assert.equal((await resolveRaceEngineV4({ ...base, checkDayWords7725Enabled: async () => false })).v4Engine, engine);
  assert.equal((await resolveRaceEngineV4({ ...base, checkDayWords7725Enabled: async () => { throw new Error("db"); } })).v4Engine, engine, "fejl = slukket");
  const on = await resolveRaceEngineV4({ ...base, checkDayWords7725Enabled: async () => true });
  assert.equal(on.v4Engine.dayWords7725, true);
  assert.equal("dayWords7725" in engine, false, "den indlaeste motor muteres aldrig");
});

test("#7725 v4DayWords7725Arg: kraever kontakten, dagsformen og s5_profiles_v3", () => {
  const on = { dayWords7725: true, dayForm6649: true };
  assert.deepEqual(v4DayWords7725Arg(on, "s5_profiles_v3"), { dayWords7725: true });
  assert.deepEqual(v4DayWords7725Arg({ dayWords7725: true }, "s5_profiles_v3"), {}, "uden dagsformen ville ordene lyve");
  assert.deepEqual(v4DayWords7725Arg({ dayForm6649: true }, "s5_profiles_v3"), {});
  assert.deepEqual(v4DayWords7725Arg(on, "s5_profiles_v2"), {});
  assert.deepEqual(v4DayWords7725Arg(null, "s5_profiles_v3"), {});
});

test("#7725 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7725.map((c) => c.key));
});

test("#7725 slukket: checksum, motor-input, output, resultater og tidslinjer er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7725();
  for (const c of OFF_DIGEST_CASES_7725) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
});

test("#7725 taendt under en aeldre revision: ingen effekt", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7725({ ...real, dayForm6649: true, dayWords7725: true }, "s5_profiles_v2");
  assert.deepEqual(await digests7725(on), FROZEN["wholeRace:s5_profiles_v2"]);
});

test("#7725 taendt: resultatet er uroert, kun tidslinjen faar ord; genafspilningen genskaber dem", async () => {
  const real = await loadRaceEngineV4();
  const on = wholeRace7725({ ...real, dayForm6649: true, dayWords7725: true }, "s5_profiles_v3");
  const digests = await digests7725(on);
  const frozen = FROZEN["wholeRace:s5_profiles_v3"];
  assert.equal(digests.resultRowsSha256, frozen.resultRowsSha256, "resultatraekkerne flytter sig ikke");
  assert.deepEqual(digests.inputChecksums, frozen.inputChecksums, "samme run-identitet");
  assert.notEqual(digests.timelinesSha256, frozen.timelinesSha256);
  const rows = await buildSnapshotRows({ raceId: RACE_7725.id, recorder: on.recorder });
  assert.equal(rows.length, stages7725().length);
  for (const row of rows) {
    const payload = decodeSnapshot(row);
    assert.equal(payload.args.dayWords7725, true);
    assert.equal((await replayEngineInput(payload)).outputSha256, row.output_sha256, `etape ${row.stage_number}: genafspilning bit-identisk`);
  }
});

test("#7725 taendt: ordene passer med motorens egen bad_day, staar foer maal og uden tal", async () => {
  const real = await loadRaceEngineV4();
  const { result } = wholeRace7725({ ...real, dayForm6649: true, dayWords7725: true }, "s5_profiles_v3");
  let good = 0;
  for (const timeline of result.timelines) {
    const words = wordsOf(timeline);
    const finish = timeline.events.findIndex((e) => e.type === "finish");
    for (const [i, e] of timeline.events.entries()) if (e.type === "day_word") assert.ok(i < finish, "foer maal");
    // Motorens bad_day er sandheden: samme rytter, samme aarsag. Beviser samme seed, rute og startliste.
    for (const bad of timeline.events.filter((e) => e.type === "bad_day")) {
      const word = words.find((e) => e.params.rider_id === bad.params.rider_id);
      assert.equal(word?.params.word, "bad", `${bad.params.rider_id} har ordet`);
      assert.equal(word.params.reason, bad.params.reason);
    }
    for (const e of words) {
      for (const v of Object.values(e.params)) assert.equal(typeof v, "string", "ingen tal");
      if (e.params.word !== "bad") { good += 1; assert.equal("reason" in e.params, false, "en god dag har ingen opdigtet aarsag"); }
    }
  }
  assert.ok(good > 0, "scenariet har en god dag, ellers beviser testen intet");
});

test("#7725 stage-by-stage: ordene kommer ogsaa med, og resultatet er uroert", async () => {
  const real = await loadRaceEngineV4();
  const on = stageByStage7725({ ...real, dayForm6649: true, dayWords7725: true }, "s5_profiles_v3", 1);
  assert.ok(wordsOf(on.result.timelines[0]).length > 0);
  assert.equal((await digests7725(on)).resultRowsSha256, FROZEN["stageByStage:s5_profiles_v3:stage2"].resultRowsSha256);
});

test("#7725 loebshistorien: ordene er ingen linje; historien er den samme med og uden", async () => {
  const real = await loadRaceEngineV4();
  const { result } = wholeRace7725({ ...real, dayForm6649: true, dayWords7725: true }, "s5_profiles_v3");
  for (const { events, timeline_version: timelineVersion } of result.timelines) {
    const without = events.filter((e) => e.type !== "day_word");
    assert.deepEqual(buildRaceStory({ events, timelineVersion }), buildRaceStory({ events: without, timelineVersion }));
  }
});
