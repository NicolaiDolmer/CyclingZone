import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_TYPE_KEYS,
  FINALE_TYPE_KEYS,
  profileShape,
  profileLabelKey,
  finaleLabelKey,
} from "./stageProfileConfig.js";

// Kontrakt-guard: profile/finale-nøglerne her SKAL matche CHECK-constrainten i
// database/2026-06-06-race-stage-profiles.sql (= PROFILE_TYPES/FINALE_TYPES i
// backend/lib/raceStageProfileGenerator.js). Hardkodet kopi, så testen fanger drift.
const DB_PROFILE_TYPES = [
  "flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "ttt", "cobbles", "classic",
];
const DB_FINALE_TYPES = [
  "bunch_sprint", "reduced_sprint", "punch", "long_climb", "descent", "solo_tt", "breakaway",
];

test("PROFILE_TYPE_KEYS matcher DB-constrainten", () => {
  assert.deepEqual([...PROFILE_TYPE_KEYS], DB_PROFILE_TYPES);
});

test("FINALE_TYPE_KEYS matcher DB-constrainten", () => {
  assert.deepEqual([...FINALE_TYPE_KEYS], DB_FINALE_TYPES);
});

test("profileShape giver en gyldig polyline for hvert kendt terræn", () => {
  for (const key of PROFILE_TYPE_KEYS) {
    const shape = profileShape(key);
    assert.equal(shape.width, 100);
    assert.equal(shape.height, 24);
    assert.ok(typeof shape.points === "string" && shape.points.length > 0, `tom points for ${key}`);
    // Hvert punkt er "x,y" med x i [0,100] og y i [0,24].
    const pts = shape.points.split(" ").map((p) => p.split(",").map(Number));
    for (const [x, y] of pts) {
      assert.ok(x >= 0 && x <= 100, `x udenfor viewBox for ${key}: ${x}`);
      assert.ok(y >= 0 && y <= 24, `y udenfor viewBox for ${key}: ${y}`);
    }
  }
});

test("profileShape er deterministisk (samme input → samme output)", () => {
  assert.equal(profileShape("mountain").points, profileShape("mountain").points);
});

test("ukendt profile_type falder tilbage til flat-silhuetten", () => {
  assert.equal(profileShape("does_not_exist").points, profileShape("flat").points);
  assert.equal(profileShape(null).points, profileShape("flat").points);
  assert.equal(profileShape(undefined).points, profileShape("flat").points);
});

test("flade og bjerg-terræn har synligt forskellige silhuetter", () => {
  // Sanity: en bjerg-etape topper højere (lavere min-y) end en flad.
  const minY = (key) =>
    Math.min(...profileShape(key).points.split(" ").map((p) => Number(p.split(",")[1])));
  assert.ok(minY("high_mountain") < minY("flat"), "high_mountain burde toppe højere end flat");
  assert.ok(minY("mountain") < minY("flat"), "mountain burde toppe højere end flat");
});

test("profileLabelKey returnerer races-namespace-nøgle for kendte typer, null ellers", () => {
  assert.equal(profileLabelKey("mountain"), "profileType.mountain");
  assert.equal(profileLabelKey("flat"), "profileType.flat");
  assert.equal(profileLabelKey("nope"), null);
  assert.equal(profileLabelKey(null), null);
});

test("finaleLabelKey returnerer nøgle for kendte typer, null for ukendt/tom", () => {
  assert.equal(finaleLabelKey("bunch_sprint"), "finaleType.bunch_sprint");
  assert.equal(finaleLabelKey("long_climb"), "finaleType.long_climb");
  assert.equal(finaleLabelKey("nope"), null);
  assert.equal(finaleLabelKey(null), null);
  assert.equal(finaleLabelKey(undefined), null);
});
