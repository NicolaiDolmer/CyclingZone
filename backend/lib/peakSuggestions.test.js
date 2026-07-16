import test from "node:test";
import assert from "node:assert/strict";
import {
  ageFromBirthdate,
  suggestedPeakCount,
  minPeakSpacingDays,
  normalizedSuitability,
  pickTargetRaces,
  suggestPeaksForRider,
  YOUNG_AGE_THRESHOLD,
  YOUNG_RIDER_PEAK_COUNT,
  ADULT_RIDER_PEAK_COUNT,
} from "./peakSuggestions.js";

// ── ageFromBirthdate ────────────────────────────────────────────────────────

test("ageFromBirthdate: simpel kalenderårs-differens", () => {
  assert.equal(ageFromBirthdate("2001-03-01", "2026-07-16"), 25);
});

test("ageFromBirthdate: manglende input → null", () => {
  assert.equal(ageFromBirthdate(null, "2026-07-16"), null);
  assert.equal(ageFromBirthdate("2001-03-01", null), null);
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
    candidateRaces, stageDatesByRaceId, todayDateString: "2026-07-16",
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
    rider: { birthdate: "2005-01-01" }, abilities: climberAbilities, // 21 år pr. 2026-07-16
    candidateRaces, stageDatesByRaceId, todayDateString: "2026-07-16",
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.equal(out.length, 1);
});

test("suggestPeaksForRider: uplanlagt mål-løb (ingen etape-datoer) springes stille over", () => {
  const candidateRaces = [{ id: "r1", ord: 100, demandVector: { climbing: 10 } }];
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces, stageDatesByRaceId: new Map(), todayDateString: "2026-07-16",
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
    candidateRaces, stageDatesByRaceId, todayDateString: "2026-07-16",
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
    candidateRaces, stageDatesByRaceId, todayDateString: "2026-07-16",
    leadupDays: 14, windowRadiusDays: 2, existingPeakCount: 1, reservedOrds: [100],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].targetRaceId, "far-enough");
});

test("suggestPeaksForRider: ingen kandidat-løb → tom liste, ingen kast", () => {
  const out = suggestPeaksForRider({
    rider: { birthdate: "1998-01-01" }, abilities: climberAbilities,
    candidateRaces: [], stageDatesByRaceId: new Map(), todayDateString: "2026-07-16",
    leadupDays: 14, windowRadiusDays: 2,
  });
  assert.deepEqual(out, []);
});
