// #1306-regression + #1307: form/fatigue/race_role skal nå simulateStage gennem buildRaceResults.
// Rider-id'er er valgt så tiebreak ALTID favoriserer den FORKERTE rytter PRE-FIX:
//   test 1: "z" (bundform) < "a" (topform) er falsk — "a" < "z" → a vinder tie → test PASSER tiebreak!
//   For at garantere rød pre-fix bruger vi ids "z" (topform) vs "a" (bundform):
//     "a" < "z" → a vinder tie → bundform slår topform → test 1 er RØD pre-fix.
//   test 2: "zzz-cap" > "aaa-helper" > "mmm-solo" → solo/helper vinder tiebreak pre-fix → RØD pre-fix.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRaceResults } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

// itt + randomness 0 → deterministisk, ingen udbrud: kun terrain + form/fatigue/team.
const stages = [{ stage_number: 1, profile_type: "itt", demand_vector: { time_trial: 1, randomness: 0 } }];

test("form/fatigue påvirker resultatet gennem buildRaceResults (#1306-bugfix)", () => {
  // "z" = topform, "a" = bundform.
  // Pre-fix: form/fatigue STRIPPES → ens abilities → "a" < "z" alfabetisk → a (bundform) slår z (topform) → RØD.
  // Post-fix: z's form=100 giver boost → z slår a trods tiebreak → GRØN.
  const entrants = [
    { rider_id: "z", team_id: "t1", abilities: ab(50), form: 100, fatigue: 0 },
    { rider_id: "a", team_id: "t2", abilities: ab(50), form: 0, fatigue: 100 },
  ];
  const { resultRows } = buildRaceResults({ race: { id: "x", race_type: "single" }, stages, entrants, pointsLookup: {} });
  const gc = resultRows.filter((r) => r.result_type === "gc").sort((r, s) => r.rank - s.rank);
  assert.equal(gc[0].rider_id, "z", "topform (z) skal slå bundform (a) ved ens abilities");
});

test("race_role når simulatoren: kaptajn med hjælper slår rolle-løs tvilling (#1307)", () => {
  // "zzz-cap" = kaptajn, "aaa-hlp" = hjælper, "mmm-solo" = rolle-løs.
  // Pre-fix: race_role STRIPPES → ens abilities → alfabetisk: aaa < mmm < zzz → zzz-cap taber tiebreak → RØD.
  // Post-fix: kaptajn-boost fra hjælper sikrer zzz-cap #1 → GRØN.
  const entrants = [
    { rider_id: "zzz-cap", team_id: "t1", abilities: ab(50), race_role: "captain" },
    { rider_id: "aaa-hlp", team_id: "t1", abilities: ab(50), race_role: "helper" },
    { rider_id: "mmm-solo", team_id: "t2", abilities: ab(50) },
  ];
  const { resultRows } = buildRaceResults({ race: { id: "y", race_type: "single" }, stages, entrants, pointsLookup: {} });
  const gc = resultRows.filter((r) => r.result_type === "gc").sort((r, s) => r.rank - s.rank);
  assert.equal(gc[0].rider_id, "zzz-cap", "kaptajn-boost (zzz-cap) skal afgøre ved ellers ens score");
});
