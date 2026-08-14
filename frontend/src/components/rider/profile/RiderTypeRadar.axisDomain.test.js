// #3707 regression — radarens akse-skala har to krav der begge kan brydes
// uafhængigt af hinanden, og begge skal dækkes:
//   1) ingen rytter må klampes til fuld radius på en akse hun ikke er
//      maksimal på ("maksimal i alt"-bug'en, det oprindelige #3707-symptom)
//   2) en median-rytter skal stadig fylde en LÆSBAR andel af radius på sin
//      bedste akse (den bug et FLADT 0-85-domæne selv ville have indført,
//      opdaget i ejer-review af PR #3716 FØR merge)
//
// RiderTypeRadar.jsx indeholder ægte JSX (SVG-return), så `node --test` kan
// ikke importere modulet direkte (samme begrænsning som beskrevet øverst i
// lib/riderRating.js). Testen læser derfor AXIS_DOMAIN ud af kildeteksten med
// regex (samme mønster som RiderScoutingTab.confidence.test.js) og genskaber
// radiusFor()'s formel her, for at teste den mod ægte rating-tal fra den
// rigtige opskrift-motor (displayRecipes.js, ren .js, sikker at importere).
//
// Rod-årsagen (#3707, revideret): et FÆLLES LINEÆRT domæne kan ikke dække et
// spænd på faktor ~28 (spillets højeste akse 85, en typisk lav akse ~3) uden
// enten at klampe toppen (løgn, #3666's oprindelige 40-domæne) eller flade
// bunden (ulæseligt, hvis man bare havde hævet domænet til 85). Fixet er en
// ikke-lineær radius-mapping (sqrt), testet her mod to ÆGTE prod-ryttere:
//   - Koen Peeters (spillerejet topsprinter): beviser at ingen akse klampes
//   - Naoki S. Ikeda (spillerejet, bedste akse = medianens p50 for spillere,
//     21): beviser at han stadig fylder en læsbar andel af radius
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
  assert.ok(match, "AXIS_DOMAIN-konstanten blev ikke fundet i RiderTypeRadar.jsx, regex er stale");
  return Number(match[1]);
}

function readsSqrtMapping() {
  // Bekræfter at radiusFor() faktisk bruger sqrt og ikke er faldet tilbage
  // til det lineære udtryk (Math.min(AXIS_DOMAIN, v) / AXIS_DOMAIN uden rod).
  return /Math\.sqrt\(/.test(componentSource());
}

// Spejler radiusFor()'s formel (frontend/src/components/rider/profile/RiderTypeRadar.jsx)
// som andel af R (0..1), så testen ikke afhænger af SVG-koordinaterne.
function fillFractionLinear(rating, domain) {
  return Math.max(0, Math.min(domain, Number(rating) || 0)) / domain;
}
function fillFractionSqrt(rating, domain) {
  return Math.sqrt(Math.max(0, Math.min(domain, Number(rating) || 0)) / domain);
}

// Ægte prod-ryttere, hentet read-only 14/8 (execute_sql mod projektets DB).
// Koen Peeters: spillerejet topsprinter, alle otte rolle-ratings 47-72 (ingen
// rører hans egen skalas loft), tidligere klampet falsk ved domæne 40.
const KOEN_PEETERS_ABILITIES = {
  climbing: 44, time_trial: 61, sprint: 85, punch: 55, endurance: 47,
  cobblestone: 44, acceleration: 76, recovery: 49, tactics: 73,
  positioning: 58, flat: 65, tempo: 49, durability: 46, descending: 49,
  aggression: 44,
};
// Naoki S. Ikeda: spillerejet, bedste akse (sprinter=21) er nøjagtig p50 for
// bedste-akse blandt 3.585 spillerejede ryttere (målt 14/8).
const NAOKI_IKEDA_ABILITIES = {
  climbing: 1, time_trial: 12, sprint: 23, punch: 2, endurance: 2,
  cobblestone: 7, acceleration: 23, recovery: 5, tactics: 34,
  positioning: 13, flat: 24, tempo: 2, durability: 17, descending: 5,
  aggression: 10,
};

test("#3707: AXIS_DOMAIN er spillets faktiske loft (85), ikke #3666's 40", () => {
  assert.equal(readAxisDomain(), 85);
});

test("#3707: radiusFor() bruger en ikke-lineaer (sqrt) mapping, ikke lineaer klamp", () => {
  assert.ok(
    readsSqrtMapping(),
    "radiusFor() ser ikke ud til at bruge Math.sqrt() laengere, et lineaert domaene loeser klampningen men goer " +
    "median-ryttere ulaeselige (#3707 opfoelgning, ejer-review af PR #3716)",
  );
});

test("#3707 egenskab 1: en alsidig toprytter (Koen Peeters) klampes IKKE til fuld radius på nogen akse", () => {
  const domain = readAxisDomain();
  const fills = RADAR_ORDER.map((key) => fillFractionSqrt(ratingForRole(KOEN_PEETERS_ABILITIES, key), domain));
  const clampedAxes = fills.filter((f) => f >= 1).length;

  assert.equal(
    clampedAxes, 0,
    `${clampedAxes}/${RADAR_ORDER.length} akser klampet til fuld radius for Koen Peeters ` +
    `(sprint 85 er hans eneste evne over 72) — polygonen ville tegne ham forkert som "maksimal i alt" (#3707)`,
  );

  // Reproducerer den oprindelige regression eksplicit: med #3666's lineære
  // domæne 40 klampede ALLE otte akser for netop denne rytter.
  const oldDomainFills = RADAR_ORDER.map((key) => fillFractionLinear(ratingForRole(KOEN_PEETERS_ABILITIES, key), 40));
  assert.equal(
    oldDomainFills.filter((f) => f >= 1).length, RADAR_ORDER.length,
    "Koen Peeters reproducerer ikke længere #3666-regressionen ved lineær domæne 40, fixturen er stale",
  );
});

test("#3707 egenskab 2: en median-rytter (Naoki S. Ikeda) fylder mindst 40% af radius på sin bedste akse", () => {
  const domain = readAxisDomain();
  const fills = RADAR_ORDER.map((key) => fillFractionSqrt(ratingForRole(NAOKI_IKEDA_ABILITIES, key), domain));
  const bestFill = Math.max(...fills);

  assert.ok(
    bestFill >= 0.40,
    `Naoki S. Ikedas bedste akse fylder kun ${(bestFill * 100).toFixed(0)}% af radius. En median-spillerejet ` +
    `rytter (bedste akse = p50 = 21) skal stadig kunne AFLÆSES, ellers er domæne-85 blot en anden variant af det ` +
    `symptom #3666 selv advarede mod ("polygonen kollapser til en prik for stort set alle")`,
  );

  // Reproducerer eksplicit hvorfor et fladt (lineært) domæne 85 IKKE er nok:
  // samme rytter, lineær mapping, skulle falde under 40%-graensen.
  const linearFills = RADAR_ORDER.map((key) => fillFractionLinear(ratingForRole(NAOKI_IKEDA_ABILITIES, key), domain));
  const linearBestFill = Math.max(...linearFills);
  assert.ok(
    linearBestFill < 0.40,
    "Naoki S. Ikeda fylder allerede >=40% med en LINEÆR domæne-85-mapping, fixturen beviser ikke længere hvorfor " +
    "sqrt er nødvendig, ikke bare et højere domæne",
  );
});

test("#3707: ingen akse kan klampes ud over spillets faktiske evne-loft (99)", () => {
  const domain = readAxisDomain();
  assert.ok(domain <= 99, "AXIS_DOMAIN over 99 er meningsløst, ratingForRole klampes selv til [0,99]");
  assert.ok(domain >= 85, "AXIS_DOMAIN under det målte prod-loft (85) risikerer at klampe en ikke-maksimal rytter igen");
});
