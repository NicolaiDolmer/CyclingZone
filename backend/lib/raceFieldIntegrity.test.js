// Tests for race field integrity guards (#1844 engine-frys, #1845 runtime-binding).
// Rene funktioner — ingen DB. RED-first.
import test from "node:test";
import assert from "node:assert/strict";
import { freezeEntrantsToStartField, excludeBoundRiders } from "./raceFieldIntegrity.js";

// ── #1844: feltet må ikke ændre sig mellem etaper ──────────────────────────────
test("freezeEntrantsToStartField udelukker en rytter der IKKE var med fra start (mid-race-intruder)", () => {
  // C kom ind midt i løbet (ikke i etape-1-snapshot) → må ikke simuleres i GC.
  const entrants = [
    { rider_id: "A", team_id: "t1" },
    { rider_id: "B", team_id: "t1" },
    { rider_id: "C", team_id: "t2" }, // intruder
  ];
  const { frozen, added, missing } = freezeEntrantsToStartField(entrants, ["A", "B"]);
  assert.deepEqual(frozen.map((e) => e.rider_id), ["A", "B"], "kun start-feltet simuleres");
  assert.deepEqual(added, ["C"], "intruderen rapporteres som tilføjet");
  assert.deepEqual(missing, [], "ingen mangler");
});

test("freezeEntrantsToStartField rapporterer en rytter fra start-feltet der er forsvundet", () => {
  // D var med fra start men er væk nu (fjernet/slettet) → skal surfaces, ikke skjules.
  const entrants = [
    { rider_id: "A", team_id: "t1" },
    { rider_id: "B", team_id: "t1" },
  ];
  const { frozen, added, missing } = freezeEntrantsToStartField(entrants, ["A", "B", "D"]);
  assert.deepEqual(frozen.map((e) => e.rider_id).sort(), ["A", "B"]);
  assert.deepEqual(added, [], "ingen tilføjede");
  assert.deepEqual(missing, ["D"], "den forsvundne start-rytter rapporteres");
});

test("freezeEntrantsToStartField uden snapshot (null/tom) lader feltet uændret", () => {
  const entrants = [{ rider_id: "A" }, { rider_id: "B" }];
  const r1 = freezeEntrantsToStartField(entrants, null);
  const r2 = freezeEntrantsToStartField(entrants, []);
  assert.equal(r1.frozen.length, 2, "null-snapshot = ingen frysning (etape 1 / legacy)");
  assert.equal(r2.frozen.length, 2, "tom snapshot = ingen frysning");
});

// ── #1845: runtime auto-fill må ikke dobbeltbooke ──────────────────────────────
test("excludeBoundRiders fjerner ryttere bundet til et OVERLAPPENDE løb", () => {
  const riders = [{ rider_id: "r1" }, { rider_id: "r2" }, { rider_id: "r3" }];
  // r1 er bundet i et løb hvis dag-vindue overlapper dette løbs vindue (samme dag).
  const thisWindow = { start: 100, end: 100 };
  const otherRaces = [
    { window: { start: 100, end: 100 }, riderIds: ["r1"] }, // overlapper → r1 ekskluderes
    { window: { start: 200, end: 200 }, riderIds: ["r2"] }, // overlapper IKKE → r2 beholdes
  ];
  const available = excludeBoundRiders({ riders, thisWindow, otherRaces });
  assert.deepEqual(available.map((r) => r.rider_id), ["r2", "r3"], "kun r1 (samme-dags-bundet) fjernes");
});

test("excludeBoundRiders uden vindue/binding lader feltet uændret", () => {
  const riders = [{ rider_id: "r1" }, { rider_id: "r2" }];
  assert.equal(excludeBoundRiders({ riders, thisWindow: null, otherRaces: [] }).length, 2);
  assert.equal(excludeBoundRiders({ riders, thisWindow: { start: 1, end: 1 }, otherRaces: [] }).length, 2);
});
