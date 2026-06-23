import test from "node:test";
import assert from "node:assert/strict";
import { assignTeamAcrossRaces } from "./raceEntryGenerator.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
// 10 ryttere
const riders = Array.from({ length: 10 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 3), fatigue: 0 }));

test("assignTeamAcrossRaces: to ikke-overlappende løb kan dele samme ryttere", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 300, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const out = assignTeamAcrossRaces({ riders, races });
  assert.equal(out.A.length, 6);
  assert.equal(out.B.length, 6);
  // Ikke-overlappende → samme stærke ryttere kan gå igen
  assert.ok(out.A.some((e) => out.B.find((b) => b.rider_id === e.rider_id)), "delt rytter tilladt");
});

test("assignTeamAcrossRaces: overlappende løb deler ALDRIG en rytter", () => {
  const races = [
    { race_id: "A", window: { start: 100, end: 250 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 200, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } }, // overlapper A
  ];
  const out = assignTeamAcrossRaces({ riders, races });
  const aIds = new Set(out.A.map((e) => e.rider_id));
  for (const e of out.B) assert.ok(!aIds.has(e.rider_id), `${e.rider_id} dobbeltbooket`);
});

test("assignTeamAcrossRaces: for få ledige ryttere → mindre felt (ingen crash)", () => {
  const fewRiders = riders.slice(0, 8); // kun 8
  const races = [
    { race_id: "A", window: { start: 100, end: 250 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
    { race_id: "B", window: { start: 200, end: 400 }, stages: [flat], sizeRule: { min: 6, max: 6 } },
  ];
  const out = assignTeamAcrossRaces({ riders: fewRiders, races });
  assert.equal(out.A.length, 6);          // A får sine 6 først (tidligst vindue)
  assert.equal(out.B.length, 2);          // kun 2 tilbage til B
});

test("assignTeamAcrossRaces: hvert pick har en kaptajn-rolle", () => {
  const races = [{ race_id: "A", window: { start: 100, end: 200 }, stages: [flat], sizeRule: { min: 6, max: 6 } }];
  const out = assignTeamAcrossRaces({ riders, races });
  assert.equal(out.A.filter((e) => e.race_role === "captain").length, 1);
});
