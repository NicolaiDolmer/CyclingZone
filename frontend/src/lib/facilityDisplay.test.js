import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_ORDER, trackDisplayKey, roleDisplayKey, effectStatusKey, tierPips, formatTrackEffect,
} from "./facilityDisplay.js";

test("TRACK_ORDER er de 5 spor i fast rækkefølge", () => {
  assert.deepEqual(TRACK_ORDER, ["training", "scouting", "medical", "academy", "commercial"]);
});

test("trackDisplayKey/roleDisplayKey mapper til i18n-nøgler", () => {
  assert.equal(trackDisplayKey("training"), "tracks.training.name");
  assert.equal(roleDisplayKey("commercial"), "roles.commercial");
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

test("formatTrackEffect: academy = slots (heltal/1-decimal), øvrige = procent", () => {
  // academy: base 3 × fuld staff-util 1.0 = 3 → "+3" (ikke "+300.0%")
  assert.equal(formatTrackEffect("academy", 3), "+3");
  // academy: base 3 × ingen staff (0.5) = 1.5 → "+1.5"
  assert.equal(formatTrackEffect("academy", 1.5), "+1.5");
  // training: 0.165 → "+16.5%"
  assert.equal(formatTrackEffect("training", 0.165), "+16.5%");
  // commercial: lille bonus 0.012 → "+1.2%"
  assert.equal(formatTrackEffect("commercial", 0.012), "+1.2%");
});
