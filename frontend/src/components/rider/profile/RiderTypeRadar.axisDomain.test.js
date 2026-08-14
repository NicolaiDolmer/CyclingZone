// #3707 regression — radarens akse-domæne må aldrig klampe en ikke-maksimal
// rytter til "maksimal i alt".
//
// RiderTypeRadar.jsx indeholder ægte JSX (SVG-return), så `node --test` kan
// ikke importere modulet direkte (samme begrænsning som beskrevet øverst i
// lib/riderRating.js). Testen læser derfor AXIS_DOMAIN ud af kildeteksten med
// regex (samme mønster som RiderScoutingTab.confidence.test.js) og genskaber
// radiusFor()'s ÉN-linjes formel her, for at teste den mod ægte rating-tal fra
// den rigtige opskrift-motor (displayRecipes.js, ren .js, sikker at importere).
//
// Rod-årsagen (#3707): #3666 satte AXIS_DOMAIN=40 ud fra p90 for én rytters
// BEDSTE rolle — men radaren tegner otte akser, og en alsidig toprytter kan
// ligge over 40 på flere af dem samtidig. Målt mod prod 14/8 (n=8.763): 80
// ryttere fik alle otte akser klampet til randen. Aitor Iglesias (gc:
// climbing 91, time_trial 89, tempo 86 — ingen enkelt evne rører 99) er det
// konkrete eksempel testet her: med domæne 40 klampede alle otte af hans
// akser til fuld radius; med domæne 85 (spillets faktiske loft) gør ingen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ratingForRole } from "../../../lib/generated/displayRecipes.js";

const RADAR_ORDER = [
  "sprinter", "puncheur", "brostensrytter", "baroudeur",
  "rouleur", "tt", "gc", "climber",
];

function componentSource() {
  const path = fileURLToPath(new URL("./RiderTypeRadar.jsx", import.meta.url));
  return readFileSync(path, "utf8");
}

function readAxisDomain() {
  const match = componentSource().match(/const AXIS_DOMAIN = (\d+);/);
  assert.ok(match, "AXIS_DOMAIN-konstanten blev ikke fundet i RiderTypeRadar.jsx — regex er stale");
  return Number(match[1]);
}

// Speciler radiusFor()'s formel (frontend/src/components/rider/profile/RiderTypeRadar.jsx)
// som andel af R (0..1), så testen ikke afhænger af SVG-koordinaterne.
function fillFraction(rating, domain) {
  return Math.max(0, Math.min(domain, Number(rating) || 0)) / domain;
}

// Ægte prod-rytter (Aitor Iglesias, gc), målt read-only 14/8 — se kommentaren
// i RiderTypeRadar.jsx for den fulde måling. Ingen enkelt evne rører 99.
const ELITE_RIDER_ABILITIES = {
  climbing: 91, time_trial: 89, sprint: 59, punch: 59, endurance: 77,
  cobblestone: 63, acceleration: 70, recovery: 77, tactics: 76,
  positioning: 60, flat: 64, tempo: 86, durability: 69, descending: 56,
  aggression: 49,
};

test("#3707: AXIS_DOMAIN er spillets faktiske loft (85), ikke #3666's 40", () => {
  assert.equal(readAxisDomain(), 85);
});

test("#3707: en alsidig toprytter klampes IKKE til fuld radius på alle otte akser", () => {
  const domain = readAxisDomain();
  const fills = RADAR_ORDER.map((key) => fillFraction(ratingForRole(ELITE_RIDER_ABILITIES, key), domain));
  const clampedAxes = fills.filter((f) => f >= 1).length;

  assert.ok(
    clampedAxes < RADAR_ORDER.length,
    `alle ${RADAR_ORDER.length} akser klampet til fuld radius — polygonen tegner rytteren som "maksimal i alt" ` +
    `selvom ingen af hans 15 evner rører 99 (#3707)`,
  );
  // Reproducerer den gamle fejl eksplicit: med #3666's domæne (40) klampede
  // ALLE otte akser for netop denne rytter.
  const oldDomainFills = RADAR_ORDER.map((key) => fillFraction(ratingForRole(ELITE_RIDER_ABILITIES, key), 40));
  assert.equal(
    oldDomainFills.filter((f) => f >= 1).length, RADAR_ORDER.length,
    "test-riytteren reproducerer ikke længere #3666-regressionen ved domæne 40 — fixturen er stale",
  );
});

test("#3707: ingen akse kan klampes ud over spillets faktiske evne-loft (99)", () => {
  const domain = readAxisDomain();
  assert.ok(domain <= 99, "AXIS_DOMAIN over 99 er meningsløst — ratingForRole klampes selv til [0,99]");
  assert.ok(domain >= 85, "AXIS_DOMAIN under det målte prod-loft (85) risikerer at klampe en ikke-maksimal rytter igen");
});
