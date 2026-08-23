import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_TYPE_KEYS,
  FINALE_TYPE_KEYS,
  profileShape,
  profileLabelKey,
  finaleLabelKey,
  breakawayTendencyAllowed,
  finaleHintKey,
} from "./stageProfileConfig.js";

// Kontrakt-guard: profile/finale-nøglerne her SKAL matche CHECK-constrainten i
// database/2026-06-06-race-stage-profiles.sql (= PROFILE_TYPES/FINALE_TYPES i
// backend/lib/raceStageProfileGenerator.js). Hardkodet kopi, så testen fanger drift.
// #3546 D: itt_hilly tilføjet (migration database/2026-08-17-3546-itt-hilly-profile-type.sql,
// anvendes post-merge: se PR-body).
const DB_PROFILE_TYPES = [
  "flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "itt_hilly", "ttt", "cobbles", "classic",
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

test("enkeltstart (itt) og holdstart (ttt) har distinkte silhuetter — hverken lig flad eller hinanden (#1953)", () => {
  const itt = profileShape("itt").points;
  const ttt = profileShape("ttt").points;
  const flat = profileShape("flat").points;
  // Accept-kriterie: ITT må ikke ligne en flad sprint-etape.
  assert.notEqual(itt, flat, "itt burde ikke dele silhuet med flat");
  // Accept-kriterie: TTT (holdstart) skal skelnes fra ITT (enkeltstart).
  assert.notEqual(ttt, itt, "ttt burde ikke dele silhuet med itt");
  assert.notEqual(ttt, flat, "ttt burde ikke dele silhuet med flat");
  // Startrampen giver ITT/TTT en markant venstre-spids terrænet ikke har (lav min-y).
  const minY = (pts) => Math.min(...pts.split(" ").map((p) => Number(p.split(",")[1])));
  assert.ok(minY(itt) < minY(flat), "itt burde have en startrampe (spids) flat ikke har");
  assert.ok(minY(ttt) < minY(flat), "ttt burde have startramper (spidser) flat ikke har");
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

// #4106: ejer-direktiv 21/8 — ruteprofilen må ikke love et udbrud-facit FØR
// løbet, og slet ikke på monumenter. breakawayTendencyAllowed er fallback-
// gatet (intet breakaway-sandsynligheds-felt i profile-data).
test("breakawayTendencyAllowed: aldrig på monument-race_class, uanset terræn", () => {
  assert.equal(breakawayTendencyAllowed({ raceClass: "Monuments", profileType: "flat" }), false);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Monuments", profileType: "rolling" }), false);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Monuments", profileType: "cobbles" }), false);
});

test("breakawayTendencyAllowed: aldrig ved distance >= 250 km, uanset race_class", () => {
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "rolling", distanceKm: 260 }), false);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "rolling", distanceKm: 250 }), false);
  // Under tærsklen er distance ikke i sig selv en gate.
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "rolling", distanceKm: 249 }), true);
});

test("breakawayTendencyAllowed: kun fladt/bølget terræn uden for monument-gaten", () => {
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "flat" }), true);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "rolling" }), true);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "hilly" }), false);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "mountain" }), false);
  assert.equal(breakawayTendencyAllowed({ raceClass: "Class1", profileType: "cobbles" }), false);
});

test("breakawayTendencyAllowed: manglende felter degraderer sikkert (ingen kastede fejl, false)", () => {
  assert.equal(breakawayTendencyAllowed(), false);
  assert.equal(breakawayTendencyAllowed({}), false);
});

test("finaleHintKey: ikke-breakaway finale_type går uændret til finaleTypeHint-nøglen", () => {
  assert.equal(finaleHintKey("bunch_sprint", {}), "finaleTypeHint.bunch_sprint");
  assert.equal(finaleHintKey("long_climb", { raceClass: "Monuments", profileType: "high_mountain" }), "finaleTypeHint.long_climb");
});

test("finaleHintKey: breakaway grener til tendens- eller dæmpet nøgle ud fra gaten", () => {
  assert.equal(finaleHintKey("breakaway", { raceClass: "Class1", profileType: "rolling" }), "finaleTypeHint.breakaway");
  assert.equal(finaleHintKey("breakaway", { raceClass: "Monuments", profileType: "cobbles" }), "finaleTypeHint.breakawayUnlikely");
  assert.equal(finaleHintKey("breakaway", { raceClass: "Class1", profileType: "mountain" }), "finaleTypeHint.breakawayUnlikely");
});

test("finaleHintKey: ukendt/manglende finale_type → null (graceful degrade)", () => {
  assert.equal(finaleHintKey("nope", {}), null);
  assert.equal(finaleHintKey(null, {}), null);
  assert.equal(finaleHintKey(undefined, {}), null);
});
