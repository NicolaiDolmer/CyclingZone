// #4105 — grus som etapetype: invarianter for den nye profile_type.
//
// TESTENE MÅLER MOD FORDELINGEN, IKKE MOD FASTE TAL (#4604's læring: et scorecard der
// hænger på et absolut tal måler feltstørrelsen, ikke mekanikken). Det der skal holde er
// RELATIONER: at brostensevnen dominerer grus lige så tydeligt som den dominerer brosten,
// at de samme ryttere er gode begge steder, og at grus altid har sektorer at hvile sin
// brostens-vægt på. Ingen af de tre ændrer sig hvis nogen tuner et enkelt tal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_TYPES, DEMAND_VECTORS, ARCHETYPE_PROFILES,
  generateRaceStageProfiles,
} from "./raceStageProfileGenerator.js";
import { buildSectors, makeRegionNamer } from "./raceRouteGenerator.js";
import { terrainScore, BREAKAWAY_BONUS } from "./raceSimulator.js";
import { terrainBucket } from "./raceTerrain.js";
import { calendarTerrainBucket } from "./raceCalendar.js";
import { compositionCategory } from "./calendarCompositionTargets.js";
import { makeRng } from "./fictionalRiderGenerator.js";

const ABILITIES = [
  "climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone",
  "acceleration", "recovery", "tactics", "positioning", "flat", "tempo",
  "durability", "aggression", "descending",
];

/** Deterministisk syntetisk rytterpopulation — samme form som rider_derived_abilities. */
function population(n, seed) {
  const rng = makeRng(seed);
  return Array.from({ length: n }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: Object.fromEntries(ABILITIES.map((k) => [k, Math.round(rng() * 99)])),
  }));
}

function topN(riders, demand, n) {
  return [...riders]
    .map((r) => ({ id: r.rider_id, s: terrainScore(r.abilities, demand) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((x) => x.id);
}

test("gravel er en kendt profiltype med en normaliseret demand-vektor", () => {
  assert.ok(PROFILE_TYPES.includes("gravel"));
  const sum = Object.values(DEMAND_VECTORS.gravel).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `demand_vector summer til ${sum}, ikke 1.0`);
});

test("brostensevnen dominerer grus lige så tydeligt som den dominerer brosten", () => {
  // RELATION, ikke tal: cobblestone skal være den TUNGESTE dimension i begge vektorer, og
  // grusens andel må ikke falde under to tredjedele af brostenens. Falder den under, er
  // det ikke længere "næsten samme type der er god til den slags løb" (ejer-ramme 3/9).
  const tungeste = (v) => Object.entries(v).filter(([k]) => k !== "randomness")
    .sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(tungeste(DEMAND_VECTORS.cobbles), "cobblestone");
  assert.equal(tungeste(DEMAND_VECTORS.gravel), "cobblestone");
  const forhold = DEMAND_VECTORS.gravel.cobblestone / DEMAND_VECTORS.cobbles.cobblestone;
  assert.ok(forhold >= 2 / 3 && forhold <= 1, `grus/brosten-forhold ${forhold.toFixed(2)}`);
});

test("de samme ryttere er gode på grus som på brosten — målt mod fordelingen", () => {
  // Overlappet mellem top-20 på grus og på brosten skal være stort, OG STØRRE end
  // overlappet mellem brosten og en kontrol-profil (flad). Begge tal er andele af samme
  // population, så testen er uafhængig af feltstørrelse og af de konkrete vægte.
  const riders = population(400, 4105);
  const brosten = topN(riders, DEMAND_VECTORS.cobbles, 20);
  const grus = topN(riders, DEMAND_VECTORS.gravel, 20);
  const flad = topN(riders, DEMAND_VECTORS.flat, 20);
  const del = (a, b) => a.filter((x) => b.includes(x)).length / a.length;

  const grusOverlap = del(brosten, grus);
  const fladOverlap = del(brosten, flad);
  assert.ok(grusOverlap >= 0.5, `grus/brosten-overlap ${grusOverlap}`);
  assert.ok(
    grusOverlap > fladOverlap * 2,
    `grus/brosten ${grusOverlap} skal være markant større end brosten/flad ${fladOverlap}`
  );
});

test("grus er IKKE en kopi af brosten — rangordenen skal kunne skille dem", () => {
  // Modstykket til testen ovenfor: var vektorerne ens, ville overlappet være 1.0 og
  // etapetypen være en etikette i stedet for en type.
  const riders = population(400, 3864);
  const brosten = topN(riders, DEMAND_VECTORS.cobbles, 20);
  const grus = topN(riders, DEMAND_VECTORS.gravel, 20);
  const overlap = brosten.filter((x) => grus.includes(x)).length / brosten.length;
  assert.ok(overlap < 1, "grus og brosten må ikke rangordne feltet identisk");
});

test("en grus-etape har ALTID sektorer (ejer-regel 3/9: brostensevnen tæller kun med brosten/grus)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = makeRng(seed);
    const namer = makeRegionNamer(rng, "it");
    const sektorer = buildSectors(rng, "gravel", 200, namer);
    assert.ok(sektorer.length > 0, `seed ${seed} gav en grus-etape uden sektorer`);
    for (const s of sektorer) assert.equal(s.kind, "gravel");
  }
});

test("brostens-etaper har fortsat brostens-sektorer, og profiler uden sektor-spec har ingen", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const cRng = makeRng(seed);
    const cobbles = buildSectors(cRng, "cobbles", 165, makeRegionNamer(cRng, "fr"));
    assert.ok(cobbles.length > 0);
    for (const s of cobbles) assert.equal(s.kind, "cobbles");

    for (const pt of ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt"]) {
      const rng = makeRng(seed);
      assert.deepEqual(buildSectors(rng, pt, 180, makeRegionNamer(rng, "es")), []);
    }
  }
});

test("gravel_classic-arketypen producerer en grus-etape", () => {
  const stages = generateRaceStageProfiles({
    id: "race-gravel", name: "Terre di Toscana", race_type: "single", stages: 1,
    external_id: "6ada4b5428dfd7b2", terrain_archetype: "gravel_classic",
    race_class: "OtherWorldTourB", season_id: "00000000-0000-0000-0000-000000000004",
  });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].profile_type, "gravel");
  assert.equal(stages[0].demand_vector.cobblestone, DEMAND_VECTORS.gravel.cobblestone);
  assert.ok(stages[0].sectors.length > 0, "grusklassikeren skal have grus-sektorer");
  for (const s of stages[0].sectors) assert.equal(s.kind, "gravel");
  assert.ok(ARCHETYPE_PROFILES.gravel_classic.kind === "single");
});

test("grus hører til brostens-familien overalt hvor et terræn buckettes", () => {
  assert.equal(terrainBucket("gravel"), "cobbles");          // kaptajn-prioriteter
  assert.equal(calendarTerrainBucket("gravel"), "cobbles");  // kalender-glyf
  assert.equal(compositionCategory("gravel"), "cobbles");    // §6-komposition
});

test("grus har en udbruds-bonus, og den er mindst brostenens", () => {
  // Løst underlag bryder feltet tidligere end brosten gør; bonussen må derfor ikke være
  // LAVERE. Relation frem for tal — begge sider kan tunes uden at testen bliver forkert.
  assert.ok(BREAKAWAY_BONUS.gravel);
  assert.ok(BREAKAWAY_BONUS.gravel.breakaway >= BREAKAWAY_BONUS.cobbles.breakaway);
});
