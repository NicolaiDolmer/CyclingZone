// Simulate-before-ship: coverage-harness for udviklings-projektionen (#2100).
//
// Spørgsmålet: dækker det FUZZY projektions-bånd (bygget kun fra nu-rating + det
// maskerede loft-bånd + den offentlige alderskurve) den ryttarens FAKTISKE fremtidige
// udvikling (den ægte motor: developRiderSeason med potentiale-rate + træning=ingen)?
//
// Metode (ren simulering, ingen DB, ingen Math.random):
//   1. Deterministisk pseudo-population: type, potentiale (1-6), start-abilities.
//   2. "Nu" = udvikl hver rytter fra alder 18 op til sin nuværende alder med den ÆGTE
//      motor (så nu-positionen er realistisk delvist udviklet, ikke rå baseline).
//   3. Projektions-bånd = projectCeilingBand(now, maskeret ceilLo/ceilHi, age).
//   4. Sandhed = fortsæt den ÆGTE motor H sæsoner frem, re-rat primærtypen pr. sæson.
//   5. Coverage = andel af fremtidige sæsoner hvor sand rating ∈ [lo, hi].
//
// GATE: median per-rytter coverage ≥ COVERAGE_TARGET. En for-smal projektion (systematisk
// under sandheden) fejler her og skal bredes/kalibreres FØR ship.
//
// Kørsel: node scripts/developmentProjectionHarness.js  [--level N]

import { developRiderSeason, buildCaps, PROGRESSION_CONFIG } from "../lib/riderProgression.js";
import { buildTypeCeilingBands, ratingFromAbilities } from "../lib/scoutingReport.js";
import { SCOUTING_CONFIG, seededUnit } from "../lib/scouting.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { projectCeilingBand, MAX_PROJECTION_SEASONS } from "../lib/developmentProjection.js";

const N = 2000;
const HORIZON = 8;                 // sæsoner projiceret frem
const COVERAGE_TARGET = 0.75;      // median per-rytter coverage-gate
const levelArg = process.argv.indexOf("--level");
const SCOUT_LEVEL = levelArg !== -1 ? Number(process.argv[levelArg + 1]) : SCOUTING_CONFIG.maxLevel;

// Baseline-abilities for én syntetisk rytter: 35-63 pr. evne + signatur-boost på
// typens positivt-vægtede evner (så caps/loft varierer realistisk med type+potentiale).
function baselineAbilities(seed, primaryType) {
  const ab = {};
  for (const a of VISIBLE_ABILITIES) {
    ab[a] = 35 + Math.round(seededUnit(`base:${seed}:${a}`) * 28);
  }
  return ab;
}

const riders = Array.from({ length: N }, (_, i) => {
  const primary_type = RIDER_TYPE_KEYS[Math.floor(seededUnit(`type:${i}`) * RIDER_TYPE_KEYS.length)];
  const potentiale = 1 + seededUnit(`pot:${i}`) * 5;              // 1.0–6.0
  const age = 18 + Math.floor(seededUnit(`age:${i}`) * 14);       // 18–31
  return { id: `sim-r${i}`, primary_type, potentiale, age, baseline: baselineAbilities(i, primary_type) };
});

// Udvikl abilities fra alder 18 til targetAge med den ægte motor (ingen træning).
function developTo(rider, caps, targetAge) {
  let ab = { ...rider.baseline };
  for (let a = 18; a < targetAge; a++) {
    const r = developRiderSeason({ id: rider.id, primary_type: rider.primary_type, potentiale: rider.potentiale, age: a }, ab, caps, a);
    ab = r.next;
  }
  return ab;
}

const coverages = [];
let atLoftAlready = 0;

for (const rider of riders) {
  const caps = buildCaps(rider.baseline, rider.primary_type, rider.potentiale);
  // "Nu"-abilities: realistisk delvist udviklet frem til rytterens alder.
  const nowAb = developTo(rider, caps, rider.age);
  const now = ratingFromAbilities(nowAb, rider.primary_type);

  // Maskeret loft-bånd for primærtypen (som serveren udleverer). Egen rytter → maxLevel.
  const bands = buildTypeCeilingBands({
    nowAbilities: nowAb, caps, level: SCOUT_LEVEL, riderId: rider.id, teamId: "harness-team",
  });
  const row = bands.find((b) => b.key === rider.primary_type);
  const projBand = projectCeilingBand({ now, ceilLo: row.ceilLo, ceilHi: row.ceilHi, age: rider.age, seasons: HORIZON });

  // Sandhed: fortsæt den ægte motor H sæsoner frem.
  let ab = nowAb;
  let a = rider.age;
  const trueRatings = [];
  for (let s = 1; s <= HORIZON; s++) {
    const r = developRiderSeason({ id: rider.id, primary_type: rider.primary_type, potentiale: rider.potentiale, age: a }, ab, caps, 100 + s);
    ab = r.next;
    a += 1;
    trueRatings.push(ratingFromAbilities(ab, rider.primary_type));
  }

  // Coverage over de fremtidige sæsoner (season 1..H; projBand[0] = nu). Båndet er
  // allerede heltal (floor/ceil) — sammenlign den heltals-rating direkte.
  let hit = 0;
  for (let s = 1; s <= HORIZON; s++) {
    const band = projBand[s];
    if (trueRatings[s - 1] >= band.lo && trueRatings[s - 1] <= band.hi) hit++;
  }
  coverages.push(hit / HORIZON);
  if (row.ceilLo - now <= 1) atLoftAlready++;
}

const sorted = [...coverages].sort((x, y) => x - y);
const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
const mean = coverages.reduce((s, c) => s + c, 0) / coverages.length;
const fracFullCover = coverages.filter((c) => c >= 0.99).length / coverages.length;
const fracAbove75 = coverages.filter((c) => c >= 0.75).length / coverages.length;

const scorecard = {
  n: N,
  horizon: HORIZON,
  scoutLevel: SCOUT_LEVEL,
  maxProjectionSeasons: MAX_PROJECTION_SEASONS,
  medianCoverage: +q(0.5).toFixed(3),
  meanCoverage: +mean.toFixed(3),
  p10Coverage: +q(0.1).toFixed(3),
  fracRidersFullyCovered: +fracFullCover.toFixed(3),
  fracRidersAbove75: +fracAbove75.toFixed(3),
  atLoftAlreadyPct: +(atLoftAlready / N).toFixed(3),
  target: COVERAGE_TARGET,
};

if (q(0.5) < COVERAGE_TARGET) {
  console.error("FAIL: projektions-båndet dækker ikke den faktiske udvikling godt nok", scorecard);
  process.exit(1);
}
console.log("PASS", scorecard);
