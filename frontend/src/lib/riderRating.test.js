import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAT_KEYS, riderStatRating,
  riderOverallRating, riderTypeRating, riderBlendedOutput,
  RATING_ALPHA, RATING_O_ELITE, RATING_O_MIN,
} from "./riderRating.js";

test("riderStatRating: snit af alle 15 evner, afrundet (#1009/#1529)", () => {
  const rider = {};
  STAT_KEYS.forEach((k, i) => {
    rider[k] = 60 + (i % 3); // 60/61/62-mønster
  });
  const expected = Math.round(
    STAT_KEYS.reduce((sum, k) => sum + rider[k], 0) / STAT_KEYS.length,
  );
  assert.equal(riderStatRating(rider), expected);
});

test("riderStatRating: manglende/ikke-numeriske evner ignoreres i snittet", () => {
  const rider = { climbing: 80, sprint: 70, time_trial: null, flat: "abc" };
  assert.equal(riderStatRating(rider), 75);
});

test("riderStatRating: ingen evner -> 0 (sorterer nederst)", () => {
  assert.equal(riderStatRating({}), 0);
  assert.equal(riderStatRating(null), 0);
  assert.equal(riderStatRating(undefined), 0);
});

test("riderStatRating: klampes til 0-99", () => {
  const maxed = Object.fromEntries(STAT_KEYS.map((k) => [k, 150]));
  assert.equal(riderStatRating(maxed), 99);
  const negative = Object.fromEntries(STAT_KEYS.map((k) => [k, -5]));
  assert.equal(riderStatRating(negative), 0);
});

test("STAT_KEYS: 15 unikke CZ-evne-noegler (#1529)", () => {
  assert.equal(STAT_KEYS.length, 15);
  assert.equal(new Set(STAT_KEYS).size, 15);
  for (const k of STAT_KEYS) assert.match(k, /^[a-z][a-z_]+$/);
});

// --- riderOverallRating (1-99, type-bevidst) — EPIC #2000 Slice 2 / #2006 ---

test("riderOverallRating: ankre — O_MIN -> 1, O_ELITE -> 99", () => {
  // En tt-rytter hvor speciale_output == snit == O (alle evner ens) gør O_best
  // == evne-niveauet, så vi kan ramme et præcist O og verificere map'en.
  const flat = (v) => ({
    primary_type: "tt",
    climbing: v, time_trial: v, flat: v, tempo: v, sprint: v, acceleration: v,
    punch: v, endurance: v, recovery: v, durability: v, descending: v,
    cobblestone: v, aggression: v,
  });
  // O_best for en flad profil = v (speciale=v, snit=v → 0.5v+0.5v=v).
  assert.equal(riderBlendedOutput(flat(RATING_O_MIN)), RATING_O_MIN);
  assert.equal(riderOverallRating(flat(RATING_O_MIN)), 1);
  assert.equal(riderOverallRating(flat(RATING_O_ELITE)), 99);
});

test("riderOverallRating: klampes til [1,99] (under gulv / over anker)", () => {
  const lo = { primary_type: "tt", time_trial: 0 };
  assert.equal(riderOverallRating(lo), 1);
  const hi = Object.fromEntries([
    "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
    "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "aggression",
  ].map((k) => [k, 99]));
  hi.primary_type = "gc";
  assert.equal(riderOverallRating(hi), 99);
});

test("riderOverallRating: ingen brugbare evner -> 0 (sorterer nederst)", () => {
  assert.equal(riderOverallRating({ primary_type: "gc" }), 0);
  assert.equal(riderOverallRating({}), 0);
  assert.equal(riderOverallRating(null), 0);
});

test("riderOverallRating: type-bevidst — speciale-evner vægter mod primary_type", () => {
  // Samme evner, forskellig primary_type → forskelligt O (speciale-leddet skifter).
  // En ren spurter-profil (høj sprint/accel, lav klatring): som 'sprinter' skal O
  // (og dermed rating) være højere end som 'climber'.
  const abilities = {
    climbing: 20, time_trial: 30, flat: 70, tempo: 25, sprint: 90, acceleration: 88,
    punch: 40, endurance: 55, recovery: 50, durability: 75, descending: 45,
    cobblestone: 40, aggression: 50,
  };
  const asSprinter = riderOverallRating({ ...abilities, primary_type: "sprinter" });
  const asClimber = riderOverallRating({ ...abilities, primary_type: "climber" });
  assert.ok(asSprinter > asClimber,
    `forventede sprinter (${asSprinter}) > climber (${asClimber}) for en spurter-profil`);
});

test("riderOverallRating: alpha=0.5 og ankre er de dokumenterede ejer-værdier", () => {
  assert.equal(RATING_ALPHA, 0.5);
  assert.equal(RATING_O_ELITE, 67.38);
  assert.equal(RATING_O_MIN, 2.04);
});

test("riderBlendedOutput: matcher 0.5*speciale + 0.5*snit for kendt profil", () => {
  // tt: speciale_output = snit af positive vægte = time_trial (eneste positive vægt).
  const rider = {
    primary_type: "tt",
    climbing: 40, time_trial: 80, flat: 50, tempo: 30, sprint: 20, acceleration: 25,
    punch: 35, endurance: 60, recovery: 55, durability: 45, descending: 40,
    cobblestone: 30, aggression: 50,
  };
  const keys = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
    "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "aggression"];
  const mean = keys.reduce((s, k) => s + rider[k], 0) / keys.length;
  const spec = rider.time_trial; // eneste positive tt-vægt
  const expected = 0.5 * spec + 0.5 * mean;
  assert.ok(Math.abs(riderBlendedOutput(rider) - expected) < 1e-9);
});

// --- riderTypeRating (per-type 1-99) — #2000 Part 2 / #918 -------------------

const PROFILE = {
  climbing: 20, time_trial: 30, flat: 70, tempo: 25, sprint: 90, acceleration: 88,
  punch: 40, endurance: 55, recovery: 50, durability: 75, descending: 45,
  cobblestone: 40, aggression: 50,
};

test("riderTypeRating: overall = rating for rytterens egen primary_type (ÉN model)", () => {
  // riderOverallRating MÅ være identisk med riderTypeRating(rider, primary_type) —
  // ellers findes der to overall-vurderinger (ejer-krav: kun én).
  for (const type of ["sprinter", "climber", "gc", "tt"]) {
    const rider = { ...PROFILE, primary_type: type };
    assert.equal(riderOverallRating(rider), riderTypeRating(rider, type),
      `overall != typeRating for ${type}`);
  }
});

test("riderTypeRating: type-bevidst — spurter-profil rates højere SOM sprinter end SOM climber", () => {
  // Uafhængigt af stored primary_type: vi spørger 'hvor god som X'.
  assert.ok(riderTypeRating(PROFILE, "sprinter") > riderTypeRating(PROFILE, "climber"),
    "spurter-profil skal rate højere som sprinter end som climber");
});

test("riderTypeRating: alle 8 typer giver en gyldig 1-99-rating for en rytter m. evner", () => {
  for (const type of ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"]) {
    const r = riderTypeRating(PROFILE, type);
    assert.ok(Number.isInteger(r) && r >= 1 && r <= 99, `${type} → ${r} udenfor [1,99]`);
  }
});

test("riderTypeRating: ingen brugbare evner -> 0", () => {
  assert.equal(riderTypeRating({}, "gc"), 0);
  assert.equal(riderTypeRating(null, "sprinter"), 0);
});
