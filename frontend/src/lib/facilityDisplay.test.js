import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_ORDER, trackDisplayKey, roleDisplayKey, formatSeasons, effectStatusKey, tierPips,
} from "./facilityDisplay.js";

test("TRACK_ORDER er de 5 spor i fast rækkefølge", () => {
  assert.deepEqual(TRACK_ORDER, ["training", "scouting", "medical", "academy", "commercial"]);
});

test("trackDisplayKey/roleDisplayKey mapper til i18n-nøgler", () => {
  assert.equal(trackDisplayKey("training"), "tracks.training.name");
  assert.equal(roleDisplayKey("commercial"), "roles.commercial");
});

test("formatSeasons: 1 decimal, håndterer null (max tier)", () => {
  assert.equal(formatSeasons(0.171), "0.2");
  assert.equal(formatSeasons(6.114), "6.1");
  assert.equal(formatSeasons(null), null);
});

test("effectStatusKey: live→active, ellers target", () => {
  assert.equal(effectStatusKey(true), "effect.live");
  assert.equal(effectStatusKey(false), "effect.target");
});

test("tierPips: array af 5 bool (filled op til tier)", () => {
  assert.deepEqual(tierPips(0), [false, false, false, false, false]);
  assert.deepEqual(tierPips(2), [true, true, false, false, false]);
  assert.deepEqual(tierPips(5), [true, true, true, true, true]);
});
