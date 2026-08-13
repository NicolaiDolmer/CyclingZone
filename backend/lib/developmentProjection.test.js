import test from "node:test";
import assert from "node:assert/strict";
import {
  stepRating, projectCeilingBand, ceilingTiming,
  RATING_DECLINE_BY_YEARS_PAST_PEAK, DISPLAY_SEASONS,
} from "./developmentProjection.js";
import { PROGRESSION_CONFIG } from "./riderProgression.js";

// #2100 — projektions-funktioner. Ren matematik; node --test.

test("projectCeilingBand: lo ≤ hi og heltal på hvert punkt", () => {
  const band = projectCeilingBand({ now: 60, ceilLo: 68, ceilHi: 74, age: 21, seasons: 8 });
  assert.equal(band.length, 9); // season 0..8
  for (const p of band) {
    assert.ok(Number.isInteger(p.lo), `lo heltal: ${p.lo}`);
    assert.ok(Number.isInteger(p.hi), `hi heltal: ${p.hi}`);
    assert.ok(p.lo <= p.hi, `lo≤hi ved season ${p.season}: ${p.lo}/${p.hi}`);
  }
});

test("projectCeilingBand: season 0 = nu (afrundet)", () => {
  const band = projectCeilingBand({ now: 63, ceilLo: 70, ceilHi: 76, age: 20 });
  assert.equal(band[0].season, 0);
  assert.equal(band[0].lo, 63);
  assert.equal(band[0].hi, 63);
});

test("vækst: nedre envelope ≥ now og stiger langsomt, øvre stiger hurtigere", () => {
  const now = 60;
  const band = projectCeilingBand({ now, ceilLo: 70, ceilHi: 78, age: 20, seasons: 6 });
  // Alle vækst-sæsoner (age 21..26 ≤ peak 28): nedre kant ≥ now og aldrig over øvre;
  // øvre stiger over now. Nedre må stige (smalt bånd, ejer-valgt) men aldrig under now.
  for (let s = 1; s <= 6; s++) {
    assert.ok(band[s].lo >= now, `nedre kant ≥ now ved season ${s}: ${band[s].lo}`);
    assert.ok(band[s].hi > now, `øvre stiger ved season ${s}`);
    assert.ok(band[s].lo <= band[s].hi, `lo ≤ hi ved season ${s}`);
  }
});

test("øvre envelope stiger monotont mod loftet i vækstfasen", () => {
  const band = projectCeilingBand({ now: 55, ceilLo: 70, ceilHi: 80, age: 19, seasons: 8 });
  for (let s = 2; s <= 8; s++) {
    assert.ok(band[s].hi >= band[s - 1].hi, `hi ikke-faldende ${s}`);
    assert.ok(band[s].hi <= 80 + 1, `hi under loft+afrunding ${band[s].hi}`);
  }
});

test("past-peak: begge envelopes falder", () => {
  const band = projectCeilingBand({ now: 85, ceilLo: 88, ceilHi: 92, age: 31, seasons: 6 });
  // age 31 > peak 28 → decline fra season 1.
  assert.ok(band[6].hi < band[1].hi, "øvre falder over tid");
  assert.ok(band[6].lo < band[1].lo, "nedre falder over tid");
});

test("stepRating: vækst mod loft, aldrig over loft; decline efter peak", () => {
  assert.ok(stepRating(60, 80, 20) > 60, "vokser mod loft");
  assert.equal(stepRating(80, 80, 20), 80, "på loft → flad");
  assert.equal(stepRating(85, 80, 20), 85, "over loft → flad (gap≤0)");
  assert.ok(stepRating(85, 90, 31) < 85, "falder efter peak");
});

test("ceilingTiming: stigende ung rytter → øvre envelope træder ind i loft-zonen", () => {
  const timing = ceilingTiming({ now: 62, ceilLo: 72, ceilHi: 80, age: 20 });
  assert.ok(timing, "rising rider giver timing");
  assert.ok(timing.seasons.lo > 0, "loftet nås ikke med det samme");
  assert.equal(timing.ageAt.lo, 20 + timing.seasons.lo, "alder ved loft = alder + sæsoner");
  // hi kan være null (asymptotisk mod ceilHi) eller ≥ lo.
  assert.ok(timing.seasons.hi == null || timing.seasons.hi >= timing.seasons.lo, "hi ≥ lo eller åben");
});

test("ceilingTiming: past-peak (faldende) → null (ingen loft-ETA)", () => {
  assert.equal(ceilingTiming({ now: 85, ceilLo: 88, ceilHi: 92, age: 32 }), null, "past-peak → null");
});

test("ceilingTiming: rytter allerede i loft-zonen → 0 sæsoner", () => {
  const timing = ceilingTiming({ now: 90, ceilLo: 90, ceilHi: 93, age: 24 });
  assert.equal(timing.seasons.lo, 0, "allerede i zonen");
  assert.equal(timing.ageAt.lo, 24, "alder = nuværende");
});

test("ceilingTiming: tal stemmer med det viste bånd (samme kilde)", () => {
  const input = { now: 70, ceilLo: 78, ceilHi: 86, age: 21 };
  const band = projectCeilingBand({ ...input, seasons: 6 });
  const timing = ceilingTiming(input);
  // Ved seasons.lo skal båndets øvre kant være i loft-zonen; sæsonen før må ikke være.
  assert.ok(band[timing.seasons.lo].hi >= input.ceilLo, "øvre kant i zonen ved lo");
  if (timing.seasons.lo > 0) {
    assert.ok(band[timing.seasons.lo - 1].hi < input.ceilLo, "ikke i zonen sæsonen før");
  }
});

// NON-INVERTIBILITET (#1162): projektionen tager INTET potentiale-/caps-input — kun
// allerede-publicerede størrelser (now, ceilLo, ceilHi, age). To ryttere med forskellig
// (skjult) potentiale men SAMME publicerede rapport får identiske bånd → projektionen
// tilføjer nul ny information og kan ikke inverteres til potentiale.
test("projektionen er en ren funktion af publicerede outputs (ingen skjult input)", () => {
  const a = projectCeilingBand({ now: 64, ceilLo: 71, ceilHi: 77, age: 22, seasons: 8 });
  const b = projectCeilingBand({ now: 64, ceilLo: 71, ceilHi: 77, age: 22, seasons: 8 });
  assert.deepEqual(a, b, "samme publicerede input → identisk bånd (deterministisk, seed-frit)");
});

// #3666 — DECLINE-KURVEN ER MOTORENS EGEN.
//
// Kurven her og motorens ability-decline var to uafhængige tal-sæt, forbundet af
// en kommentar. Da rating-skalaen blev absolut, holdt oversættelsen mellem dem op
// med at gælde — og intet fejlede, fordi intet målte forholdet. En median-rytter
// blev derefter projekteret til nul på seks sæsoner mens motoren ville tage ~15.
//
// Testen findes for at gøre den tavse drift umulig: bindingen SKAL være identitet,
// ikke en afskrift der ligner.
test("#3666 projektionens decline ER motorens, ikke en kopi der ligner", () => {
  assert.equal(
    RATING_DECLINE_BY_YEARS_PAST_PEAK,
    PROGRESSION_CONFIG.declineByYearsPastPeak,
    "samme objekt-reference — en kopi ville kunne drifte i tavshed",
  );
});

test("#3666 en median-rytter over peak rammer ikke gulvet i display-vinduet", () => {
  // Prod-median for egen-rolle-rating er 15 (målt 14/8). Med de gamle 2,5/3,5/4,5
  // var han på 0 efter seks sæsoner. Kravet er ikke et bestemt tal, men at
  // projektionen ikke afskriver en helt almindelig rytter inden for det vindue
  // spilleren faktisk får vist.
  const band = projectCeilingBand({ now: 15, ceilLo: 15, ceilHi: 16, age: 30, seasons: DISPLAY_SEASONS });
  const sidste = band[band.length - 1];
  assert.ok(sidste.hi > 0, `øvre kant faldt til ${sidste.hi} inden for ${DISPLAY_SEASONS} sæsoner`);
  assert.ok(sidste.lo >= 5, `nedre kant faldt til ${sidste.lo} — for stejlt mod motorens målte 0,97-2,63/sæson`);
});
