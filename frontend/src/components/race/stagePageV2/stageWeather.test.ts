// #6993 · etapens vejr: vis kun det, data kan bære.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRaceStory } from "../../../../../backend/lib/raceStory.js";
import { stageWeather, weatherWord } from "./stageWeather.ts";
import type { RaceStory } from "./raceStoryModel.ts";

function story(over: Partial<RaceStory> = {}, weatherKind: string | null = null): RaceStory {
  return {
    version: 1, timeline_version: 2, distance_km: 150, field_count: 100, precise_times: true, time_trial: false,
    leader_line: [], snapshots: [], checkpoints: [], group_spans: [], breakaway: null,
    moments: weatherKind
      ? [{ type: "weather", key: "story.weather", km: 0, race_time_s: 0, importance: "detail", data: { kind: weatherKind } }]
      : [],
    ...over,
  };
}

const road = (kind: string | null, profile_type = "flat") => ({ profile_type, weather: kind ? { kind, wind_exposure: 0.4 } : null });

test("weatherWord: sol og overskyet er tørt, ukendt er intet", () => {
  assert.equal(weatherWord("sun"), "dry");
  assert.equal(weatherWord("overcast"), "dry");
  assert.equal(weatherWord("rain"), "rain");
  assert.equal(weatherWord("wind"), "wind");
  assert.equal(weatherWord("snow"), null);
  assert.equal(weatherWord(undefined), null);
});

test("før etapen: profilens gemte vejr, aldrig en sætning", () => {
  assert.deepEqual(stageWeather(road("rain"), "before"), { word: "rain", mattered: false });
  assert.deepEqual(stageWeather(road("sun"), "before"), { word: "dry", mattered: false });
});

test("uden gemt vejr vises intet (motoren regner et fallback vi ikke kender)", () => {
  assert.equal(stageWeather(road(null), "before"), null);
  assert.equal(stageWeather(null, "before"), null);
});

test("holdtidskørslen kører uden vejr og viser intet", () => {
  assert.equal(stageWeather(road("rain", "ttt"), "before"), null);
  assert.equal(stageWeather(road("rain", "ttt"), "after", story({ time_trial: true })), null);
});

test("efter etapen: motorens vejr-hændelse giver ord og sætning", () => {
  assert.deepEqual(stageWeather(road("rain"), "after", story({}, "rain")), { word: "rain", mattered: true });
  assert.deepEqual(stageWeather(road("wind"), "after", story({}, "wind")), { word: "wind", mattered: true });
});

test("efter etapen: tørt uden hændelse er sandt, regn uden hændelse vises ikke", () => {
  assert.deepEqual(stageWeather(road("overcast"), "after", story()), { word: "dry", mattered: false });
  assert.equal(stageWeather(road("rain"), "after", story()), null);
  assert.equal(stageWeather(road("wind"), "after", story()), null);
});

test("efter etapen: hændelse og profil er uenige, så intet vises", () => {
  assert.equal(stageWeather(road("wind"), "after", story({}, "rain")), null);
  assert.equal(stageWeather(road("sun"), "after", story({}, "rain")), null);
});

test("efter etapen: kun v4's egen løbslog tæller", () => {
  assert.equal(stageWeather(road("sun"), "after", story({ timeline_version: 1 })), null);
  assert.equal(stageWeather(road("sun"), "after", null), null);
});

test("enkeltstart: ordet vises, sætningen aldrig (motoren logger ikke vejret der)", () => {
  assert.deepEqual(stageWeather(road("rain", "itt"), "after", story({ time_trial: true })), { word: "rain", mattered: false });
});

test("kontrakten: v4's weather-event når frem som moment med kind", () => {
  const built = buildRaceStory({
    timelineVersion: 2,
    events: [
      { km: 0, type: "stage_start", params: { profile_type: "flat", distance_km: 150, field_count: 2 } },
      { km: 0, type: "weather", params: { kind: "rain" } },
      { km: 150, type: "finish", params: { rider_ids: ["a"] } },
    ],
  }) as unknown as RaceStory;
  assert.deepEqual(stageWeather(road("rain"), "after", built), { word: "rain", mattered: true });
});
