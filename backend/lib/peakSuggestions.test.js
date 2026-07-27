import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  ageForSeason,
  suggestedPeakCount,
  minPeakSpacingDays,
  normalizedSuitability,
  pickTargetRaces,
  suggestPeaksForRider,
  YOUNG_AGE_THRESHOLD,
  YOUNG_RIDER_PEAK_COUNT,
  ADULT_RIDER_PEAK_COUNT,
} from "./peakSuggestions.js";

// ── ageForSeason ─────────────────────────────────────────────────────────────
// #3081: erstatter den fjernede wall-clock ageFromBirthdate(birthdate, todayDateString).
// Skal spejle riderProgressionEngine.ageForSeason (SSOT) præcis, samme værdier
// som squadRiskGuard.test.js verificerer for sin bevidste duplikat.

test("ageForSeason: sæson-drevet, ikke wall-clock (spejler riderProgressionEngine SSOT)", () => {
  assert.equal(ageForSeason("2001-03-01", 1), 2026 - 2001); // 25, sæson 1 = launch-året
  assert.equal(ageForSeason("2001-03-01", 2), 2027 - 2001); // 26, ét år ældre i sæson 2
});

test("ageForSeason: manglende input → null", () => {
  assert.equal(ageForSeason(null, 2), null);
  assert.equal(ageForSeason("2001-03-01", NaN), null);
});

// ── suggestedPeakCount ──────────────────────────────────────────────────────

test("suggestedPeakCount: ung rytter → 1 forslag", () => {
  assert.equal(suggestedPeakCount(YOUNG_AGE_THRESHOLD - 1), YOUNG_RIDER_PEAK_COUNT);
});

test("suggestedPeakCount: voksen rytter → fuldt program", () => {
  assert.equal(suggestedPeakCount(YOUNG_AGE_THRESHOLD), ADULT_RIDER_PEAK_COUNT);
  assert.equal(suggestedPeakCount(30), ADULT_RIDER_PEAK_COUNT);
});

test("suggestedPeakCount: ukendt alder → fail-open til voksen-program", () => {
  assert.equal(suggestedPeakCount(null), ADULT_RIDER_PEAK_COUNT);
});

// ── minPeakSpacingDays ──────────────────────────────────────────────────────

test("minPeakSpacingDays: leadup + 2×radius", () => {
  assert.equal(minPeakSpacingDays(14, 2), 18);
  assert.equal(minPeakSpacingDays(0, 0), 0);
  assert.equal(minPeakSpacingDays(-5, 2), 4); // negative leadup clamped til 0
});

// ── normalizedSuitability ───────────────────────────────────────────────────

test("normalizedSuitability: perfekt rytter mod ren klatre-demand → 100", () => {
  const abilities = { climbing: 99, time_trial: 0, sprint: 0, punch: 0, endurance: 0, cobblestone: 0, acceleration: 0, recovery: 0, tactics: 0, positioning: 0, flat: 0, tempo: 0, durability: 0, aggression: 0, descending: 0 };
  assert.equal(normalizedSuitability(abilities, { climbing: 10 }), 100);
});

test("normalizedSuitability: tom/ugyldig demand-vektor → 0", () => {
  assert.equal(normalizedSuitability({ climbing: 90 }, null), 0);
  assert.equal(normalizedSuitability({ climbing: 90 }, {}), 0);
});

test("normalizedSuitability: svag rytter mod krævende profil → lavt tal, ikke 0", () => {
  const score = normalizedSuitability({ climbing: 20 }, { climbing: 10 });
  assert.ok(score > 0 && score < 30, `forventede lavt score, fik ${score}`);
});

// ── pickTargetRaces ──────────────────────────────────────────────────────────

const climberAbilities = { climbing: 90, time_trial: 30, sprint: 10, punch: 40, endurance: 70, cobblestone: 10, acceleration: 20, recovery: 60, tactics: 50, positioning: 50, flat: 20, tempo: 40, durability: 60, aggression: 30, descending: 60 };

test("pickTargetRaces: rangerer efter egnethed når intet er registreret", () => {
  const candidateRaces = [
    { id: "flat-race", ord: 100, demandVector: { flat: 10 } },
    { id: "mountain-race", ord: 140, demandVector: { climbing: 10 } },
  ];
  const picks = pickTargetRaces({ candidateRaces, abilities: climberAbilities, maxPeaks: 1, minSpacingDays: 0 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].raceId, "mountain-race");
  assert.equal(picks[0].reason, "suitability");
});

test("pickTargetRaces: registreret løb slår ren egnethed", () => {
  const candidateRaces = [
    { id: "flat-race", ord: 100, demandVector: { flat: 10 } },
    { id: "mountain-race", ord: 140, demandVector: { climbing: 10 } },
  ];
  const picks = pickTargetRaces({
    candidateRaces, abilities: climberAbilities, maxPeaks: 1, minSpacingDays: 0,
    registeredRaceIds: new Set(["flat-race"]),
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].raceId, "flat-race");
  assert.equal(picks[0].reason, "registered");
});

test("pickTargetRaces: håndhæver minimums-mellemrum (spring for-tætte løb over)", () => {
  const candidateRaces = [
    { id: "best", ord: 100, demandVector: { climbing: 10 } },
    { id: "too-close", ord: 105, demandVector: { climbing: 10 } }, // kun 5 dage fra "best"
    { id: "far-enough", ord: 130, demandVector: { climbing: 9 } },
  ];
  const picks = pickTargetRaces({ candidateRaces, abilities: climberAbilities, maxPeaks: 2, minSpacingDays: 18 });
  assert.deepEqual(picks.map((p) => p.raceId), ["best", "far-enough"]);
});

test("pickTargetRaces: output er kronologisk sorteret uanset rangerings-rækkefølge", () => {
  const candidateRaces = [
    { id: "late", ord: 200, demandVector: { climbing: 10 } },
    { id: "early", ord: 50, demandVector: { climbing: 10 } },
  ];
  const picks = pickTargetRaces({ candidateRaces, abilities: climberAbilities, maxPeaks: 2, minSpacingDays: 0 });
  assert.deepEqual(picks.map((p) => p.raceId), ["early", "late"]);
});

test("pickTargetRaces: maxPeaks 0 eller ingen kandidater → tom liste, ingen kast", () => {
  assert.deepEqual(pickTargetRaces({ candidateRaces: [{ id: "a", ord: 1, demandVector: {} }], maxPeaks: 0, minSpacingDays: 0 }), []);
  assert.deepEqual(pickTargetRaces({ candidateRaces: [], maxPeaks: 2, minSpacingDays: 0 }), []);
});

test("pickTargetRaces: stabil tie-break (tidligst dato → race-id) ved lige egnethed", () => {
  const candidateRaces = [
    { id: "b-race", ord: 100, demandVector: { climbing: 10 } },
    { id: "a-race", ord: 100, demandVector: { climbing: 10 } },
  ];
  const picks = pickTargetRaces({ candidateRaces, abilities: climberAbilities, maxPeaks: 1, minSpacingDays: 0 });
  assert.equal(picks[0].raceId, "a-race");
});

// ── suggestPeaksForRider (fuld orkestrering) ────────────────────────────────

test("suggestPeaksForRider: snapper vindue omkring valgte løbs etape-datoer", () => {
  const candidateRaces = [{ id: "r1", ord: 20268, demandVector: { climbing: 10 } }]; // 2025-06-01-ish ordinal, vilkårlig
  const stageDatesByRaceId = new Map([["r1", ["2026-08-10"]]]);
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces, stageDatesByRaceId, seasonNumber: 1,
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].targetRaceId, "r1");
  assert.equal(out[0].windowStart, "2026-08-08");
  assert.equal(out[0].windowEnd, "2026-08-12");
  assert.equal(out[0].reason, "suitability");
});

test("suggestPeaksForRider: ung rytter får kun ét forslag selvom flere kandidater findes", () => {
  const candidateRaces = [
    { id: "r1", ord: 100, demandVector: { climbing: 10 } },
    { id: "r2", ord: 200, demandVector: { climbing: 9 } },
  ];
  const stageDatesByRaceId = new Map([["r1", ["2026-08-10"]], ["r2", ["2026-11-18"]]]);
  const out = suggestPeaksForRider({
    rider: { birthdate: "2005-01-01" }, abilities: climberAbilities, // 21 år i sæson 1 (2026 − 2005)
    candidateRaces, stageDatesByRaceId, seasonNumber: 1,
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.equal(out.length, 1);
});

test("suggestPeaksForRider: uplanlagt mål-løb (ingen etape-datoer) springes stille over", () => {
  const candidateRaces = [{ id: "r1", ord: 100, demandVector: { climbing: 10 } }];
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces, stageDatesByRaceId: new Map(), seasonNumber: 1,
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.deepEqual(out, []);
});

test("suggestPeaksForRider: fylder kun resterende slot når rytteren allerede har én ægte peak", () => {
  const candidateRaces = [
    { id: "r1", ord: 100, demandVector: { climbing: 10 } },
    { id: "r2", ord: 200, demandVector: { climbing: 9 } },
  ];
  const stageDatesByRaceId = new Map([["r1", ["2026-08-10"]], ["r2", ["2026-11-18"]]]);
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces, stageDatesByRaceId, seasonNumber: 1,
    leadupDays: 14, windowRadiusDays: 2, existingPeakCount: 1,
  });
  assert.equal(out.length, 1); // voksen-loft 2 minus 1 ægte = 1 forslag
});

test("suggestPeaksForRider: respekterer mellemrum mod ÆGTE peak-vinduer (reservedOrds)", () => {
  const candidateRaces = [
    { id: "too-close", ord: 105, demandVector: { climbing: 10 } },
    { id: "far-enough", ord: 200, demandVector: { climbing: 9 } },
  ];
  const stageDatesByRaceId = new Map([["too-close", ["2026-08-10"]], ["far-enough", ["2026-11-18"]]]);
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces, stageDatesByRaceId, seasonNumber: 1,
    leadupDays: 14, windowRadiusDays: 2, existingPeakCount: 1, reservedOrds: [100],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].targetRaceId, "far-enough");
});

test("suggestPeaksForRider: ingen kandidat-løb → tom liste, ingen kast", () => {
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces: [], stageDatesByRaceId: new Map(), seasonNumber: 1,
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.deepEqual(out, []);
});

// #3081: rytter født 2004 fylder 23 i sæson 2 (2027 − 2004) og skal derfor have
// det VOKSNE peak-antal (2), ikke ungdomsantallet (1). Før fixet regnede
// suggestPeaksForRider alder på wall-clock (ageFromBirthdate/todayDateString),
// som i sæson 2 stadig lå i kalenderåret 2026 (sæson-cutover sker IKKE på nytår)
// — rytteren blev dermed regnet som 22 år (2026 − 2004) og fik kun ét forslag.
// Denne test fejler på main (før fixet) og skal bestå efter (seasonNumber-baseret
// ageForSeason). Verificeret i prod 27/7: 121 ryttere ramt af præcis dette.
test("suggestPeaksForRider: rytter født 2004 får voksen-peak-antal i sæson 2, ikke ungdomsantal (#3081)", () => {
  const candidateRaces = [
    { id: "r1", ord: 100, demandVector: { climbing: 10 } },
    { id: "r2", ord: 200, demandVector: { climbing: 9 } },
  ];
  const stageDatesByRaceId = new Map([["r1", ["2026-08-10"]], ["r2", ["2026-11-18"]]]);
  const out = suggestPeaksForRider({
    rider: { birthdate: "2004-01-01" }, abilities: climberAbilities,
    candidateRaces, stageDatesByRaceId,
    seasonNumber: 2, // ageForSeason("2004-01-01", 2) = 2027 - 2004 = 23 → voksen
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.equal(out.length, ADULT_RIDER_PEAK_COUNT, "23-årig i sæson 2 skal have det voksne peak-antal (2), ikke ungdomsantallet (1)");
});

// ── #3081 forward-guard ──────────────────────────────────────────────────────
// Scope: KUN denne fil, ikke hele backend-træet. Backend bruger wall-clock-datoer
// legitimt overalt til andet end alder (scheduling, copenhagenDateString, m.fl.),
// så et helt-træ-scan (som frontend/riderAgeSeasonGuard.test.js kører — sikkert
// dér fordi frontend-alder reelt kun har ét sted den beregnes) ville give en
// strøm af falske positiver her. Denne fil har derimod netop ÉN alderskilde
// (ageForSeason ovenfor), så et snævert scan af peakSuggestions.js selv rammer
// præcis den fejlklasse #3081/#3071 handlede om: en tredje, tavs alders-konvention.
test("#3081 forward-guard: peakSuggestions.js har ingen wall-clock alderskilde og bruger stadig ageForSeason", () => {
  const src = readFileSync(new URL("./peakSuggestions.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    src,
    /todayYear\s*-\s*birthYear|new Date\(\)\.getFullYear\(\)|getUTCFullYear\(\)\s*-\s*.*getUTCFullYear\(\)/,
    "Wall-clock alders-mønster fundet i peakSuggestions.js (#3081/#3071-fejlklassen) — brug ageForSeason(birthdate, seasonNumber) i stedet",
  );
  assert.match(
    src,
    /function ageForSeason\(/,
    "peakSuggestions.js skal fortsat have en sæson-forankret ageForSeason (SSOT: riderProgressionEngine.ageForSeason) — ingen tredje alders-konvention",
  );
});
