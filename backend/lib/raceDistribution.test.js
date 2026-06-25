// backend/lib/raceDistribution.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildColumnSet,
  buildBindingMap,
  dominantTerrain,
  lockedWindowsFromEntries,
  partitionRegenTargets,
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

// Rod A (#1823): et afmeldt kolonne-løb binder ikke — dets ryttere er frie til de
// overlappende løb (puljen viser dem ikke som låst).
test("buildBindingMap: afmeldt kolonne binder ikke (frigør ryttere)", () => {
  const columns = [
    { id: "a", window: W("12"), riderIds: ["r1", "r2"] },
    { id: "b", window: W("12"), riderIds: ["r3"] }, // overlapper a
  ];
  const map = buildBindingMap({ columns, withdrawnIds: new Set(["a"]) });
  assert.equal(map["r1"], undefined, "r1 i afmeldt a binder ikke");
  assert.equal(map["r2"], undefined);
  assert.equal(map["r3"], undefined, "b overlapper kun det afmeldte a → r3 fri");
});

test("dominantTerrain: flertal vinder, lige → mixed", () => {
  assert.equal(dominantTerrain(["flat", "flat", "hills"]), "flat");
  assert.equal(dominantTerrain(["flat", "hills"]), "mixed");
  assert.equal(dominantTerrain([]), null);
});

// lockedWindowsFromEntries (#1823 1b + dual-mode): låser ALLE committede entries
// (manuelle OG auto-filled) i løb der IKKE regenereres (excludeRaceIds). Det lukker
// hullet hvor en auto-filled rytter i et ikke-synligt overlappende løb (fx et multi-
// dag-etapeløb) blev dobbeltbooket fordi kun manuelle entries blev låst.
test("lockedWindowsFromEntries: låser ALLE committede entries (manuelle + auto) i ikke-regenererede løb", () => {
  const entries = [
    { race_id: "x", rider_id: "r1", is_auto_filled: false },
    { race_id: "x", rider_id: "r2", is_auto_filled: false },
    { race_id: "y", rider_id: "r3", is_auto_filled: true }, // auto i ANDET løb → låses nu (1b-fix)
  ];
  const windowByRace = new Map([["x", { start: 1, end: 2 }], ["y", { start: 3, end: 4 }]]);
  const locks = lockedWindowsFromEntries({ entries, windowByRace, excludeRaceIds: new Set() });
  const byWindow = Object.fromEntries(locks.map((l) => [l.window.start, l.riderIds.sort()]));
  assert.deepEqual(byWindow[1], ["r1", "r2"]);
  assert.deepEqual(byWindow[3], ["r3"]);
});

test("lockedWindowsFromEntries: excludeRaceIds (de regenererede løb) udelades", () => {
  const entries = [
    { race_id: "x", rider_id: "r1", is_auto_filled: false },
    { race_id: "y", rider_id: "r3", is_auto_filled: true },
  ];
  const windowByRace = new Map([["x", { start: 1, end: 2 }], ["y", { start: 3, end: 4 }]]);
  const locks = lockedWindowsFromEntries({ entries, windowByRace, excludeRaceIds: new Set(["y"]) });
  assert.equal(locks.length, 1);
  assert.deepEqual(locks[0].riderIds, ["r1"]);
});

test("lockedWindowsFromEntries: løb uden vindue ignoreres", () => {
  const entries = [{ race_id: "z", rider_id: "r1", is_auto_filled: true }];
  const locks = lockedWindowsFromEntries({ entries, windowByRace: new Map(), excludeRaceIds: new Set() });
  assert.equal(locks.length, 0);
});

// partitionRegenTargets (#1823 dual-mode + #1825 frys): hvilke kolonner regenereres.
const COLS = [
  { id: "auto", stages_completed: 0 },     // assistent-udfyldt (eller tom)
  { id: "manual", stages_completed: 0 },    // manuelt udtaget
  { id: "started", stages_completed: 3 },   // igangværende → frys
  { id: "withdrawn", stages_completed: 0 }, // afmeldt
];
test("partitionRegenTargets mode=missing: springer manuelle + igangværende over, afmeldte tæller ikke som skipped", () => {
  const { target, skipped } = partitionRegenTargets({
    cols: COLS, withdrawnIds: new Set(["withdrawn"]), manualRaceIds: new Set(["manual"]), mode: "missing",
  });
  assert.deepEqual(target.map((r) => r.id), ["auto"]);
  assert.equal(skipped, 2); // manual + started (afmeldt tæller IKKE)
});

test("partitionRegenTargets mode=all: regenererer også manuelle, men aldrig igangværende", () => {
  const { target, skipped } = partitionRegenTargets({
    cols: COLS, withdrawnIds: new Set(["withdrawn"]), manualRaceIds: new Set(["manual"]), mode: "all",
  });
  assert.deepEqual(target.map((r) => r.id).sort(), ["auto", "manual"]);
  assert.equal(skipped, 1); // kun started (frys gælder uanset mode)
});

test("partitionRegenTargets: igangværende løb fryses i begge modes", () => {
  for (const mode of ["missing", "all"]) {
    const { target } = partitionRegenTargets({ cols: COLS, withdrawnIds: new Set(), manualRaceIds: new Set(), mode });
    assert.ok(!target.find((r) => r.id === "started"), `started fryses i mode=${mode}`);
  }
});
