// backend/lib/raceDistribution.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildColumnSet,
  buildBindingMap,
  dominantTerrain,
  lockedWindowsFromManualEntries,
} from "./raceDistribution.js";

const W = (h) => ({ start: Date.parse(`2026-07-04T${h}:00Z`), end: Date.parse(`2026-07-04T${h}:00Z`) });

test("buildColumnSet: kun egne-pulje scheduled-løb hvis vindue rammer dagen", () => {
  const races = [
    { id: "a", league_division_id: "p1", status: "scheduled", window: W("12") }, // egen pulje, i dag
    { id: "b", league_division_id: "p2", status: "scheduled", window: W("15") }, // fremmed pulje
    { id: "c", league_division_id: "p1", status: "completed", window: W("12") }, // afsluttet
    { id: "d", league_division_id: null, status: "scheduled", window: W("18") }, // pulje-løs (tilladt)
  ];
  const cols = buildColumnSet({
    races,
    teamDivisionId: "p1",
    dayWindow: { start: W("00").start, end: Date.parse("2026-07-04T23:59:00Z") },
  });
  assert.deepEqual(cols.map((r) => r.id).sort(), ["a", "d"]);
});

test("buildBindingMap: rytter udtaget i ét kolonne-løb bindes i de overlappende", () => {
  const columns = [
    { id: "a", window: W("12"), riderIds: ["r1", "r2"] },
    { id: "b", window: W("12"), riderIds: ["r3"] }, // samme tid → overlap med a
    { id: "c", window: W("20"), riderIds: [] }, // senere → ingen overlap
  ];
  const map = buildBindingMap({ columns });
  assert.deepEqual(map["r1"], ["a"]); // r1 er i a, bundet ift. b
  assert.deepEqual(map["r3"], ["b"]);
  assert.equal(map["r9"], undefined);
});

test("dominantTerrain: flertal vinder, lige → mixed", () => {
  assert.equal(dominantTerrain(["flat", "flat", "hills"]), "flat");
  assert.equal(dominantTerrain(["flat", "hills"]), "mixed");
  assert.equal(dominantTerrain([]), null);
});

test("lockedWindowsFromManualEntries: kun manuelle entries (is_auto_filled=false), grupperet pr. løb", () => {
  const entries = [
    { race_id: "x", rider_id: "r1", is_auto_filled: false },
    { race_id: "x", rider_id: "r2", is_auto_filled: false },
    { race_id: "y", rider_id: "r3", is_auto_filled: true }, // auto → ignoreres
  ];
  const windowByRace = new Map([["x", { start: 1, end: 2 }], ["y", { start: 3, end: 4 }]]);
  const locks = lockedWindowsFromManualEntries({ entries, windowByRace, excludeRaceIds: new Set() });
  assert.equal(locks.length, 1);
  assert.deepEqual(locks[0].window, { start: 1, end: 2 });
  assert.deepEqual(locks[0].riderIds.sort(), ["r1", "r2"]);
});

test("lockedWindowsFromManualEntries: excludeRaceIds (de synlige løb) udelades", () => {
  const entries = [{ race_id: "x", rider_id: "r1", is_auto_filled: false }];
  const windowByRace = new Map([["x", { start: 1, end: 2 }]]);
  const locks = lockedWindowsFromManualEntries({ entries, windowByRace, excludeRaceIds: new Set(["x"]) });
  assert.equal(locks.length, 0);
});
