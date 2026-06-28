// frontend/src/lib/raceHubLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeColumnStatus, isSelectionSavable, isRiderBound, deriveRaceStatus, poolRaceDayTotals, fitTier, freshnessTier, draftBindingMap, windowsOverlap, canAddRiderToColumn } from "./raceHubLogic.js";

const W = (g) => ({ start: g, end: g }); // 1-dags in-game-vindue på game-dag g

test("draftBindingMap: binder rytter til de kolonner han er i kladden, med game-dag-vindue (ekskl. afmeldte)", () => {
  const cols = [
    { id: "A", withdrawn: false, bindingWindow: W(4), selection: { rider_ids: ["r1", "r2"] } },
    { id: "B", withdrawn: false, bindingWindow: W(4), selection: { rider_ids: ["r2"] } },
    { id: "C", withdrawn: true, bindingWindow: W(5), selection: { rider_ids: ["r1"] } },
  ];
  const map = draftBindingMap(cols);
  assert.deepEqual(map.r1, [{ id: "A", window: W(4) }]); // C er afmeldt → tæller ikke
  assert.deepEqual(map.r2.map((e) => e.id).sort(), ["A", "B"]);
});

test("windowsOverlap: deler game-dag → true; forskellige game-dage → false", () => {
  assert.equal(windowsOverlap(W(4), W(4)), true);
  assert.equal(windowsOverlap(W(4), W(5)), false);
  assert.equal(windowsOverlap({ start: 4, end: 8 }, W(5)), true); // etapeløb-span dækker gd5
  assert.equal(windowsOverlap(null, W(4)), false);
});

test("computeColumnStatus: full / understaffed / withdrawn", () => {
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 5, target: 7, withdrawn: false }), { kind: "understaffed", selected: 5, target: 7 });
  assert.deepEqual(computeColumnStatus({ selected: 0, target: 8, withdrawn: true }), { kind: "withdrawn", selected: 0, target: 8 });
  // Rod A: transient over max (kladde-bytte på fuld trup) → overfull, ikke full.
  assert.deepEqual(computeColumnStatus({ selected: 7, target: 6, max: 6, withdrawn: false }), { kind: "overfull", selected: 7, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, max: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
});

// #1906: auto-gem KUN ved fuld opstilling (count === max). Delvis trup gemmes aldrig.
test("isSelectionSavable: kun en KOMPLET trup gemmes (count === max)", () => {
  assert.equal(isSelectionSavable({ count: 6, max: 6 }), true);
  assert.equal(isSelectionSavable({ count: 5, max: 6 }), false, "under fuld → ikke gemt");
  assert.equal(isSelectionSavable({ count: 7, max: 6 }), false, "over fuld → ikke gemt");
  // Lille trup (kun 4 ryttere på en 6/6) gemmes IKKE længere — manageren skal afmelde
  // eller hente fri-agenter. (Tidligere lempelse fjernet, ejer-beslutning 26/6.)
  assert.equal(isSelectionSavable({ count: 4, max: 6 }), false);
});

test("isRiderBound: kun bundet når game-dag-vinduer overlapper (samme IRL-dag ≠ binding)", () => {
  // r1 er i a (gd4); b er gd4 (overlapper → bundet); c er gd5 (samme IRL-dag, anden game-dag → IKKE bundet).
  const bindingMap = { r1: [{ id: "a", window: W(4) }] };
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "b", forWindow: W(4) }), true);
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "c", forWindow: W(5) }), false, "anden game-dag → fri");
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "a", forWindow: W(4) }), false); // a er hans eget løb
  assert.equal(isRiderBound({ bindingMap, riderId: "r9", forRaceId: "b", forWindow: W(4) }), false);
});

test("canAddRiderToColumn: game-dag-fri kolonne på samme IRL-dag er tilføjbar", () => {
  const bindingMap = { r1: [{ id: "a", window: W(4) }] };
  const colB = { id: "b", bindingWindow: W(4), selection: { rider_ids: [] } }; // gd4 → bundet
  const colC = { id: "c", bindingWindow: W(5), selection: { rider_ids: [] } }; // gd5 → fri
  assert.equal(canAddRiderToColumn({ column: colB, bindingMap, riderId: "r1" }), false);
  assert.equal(canAddRiderToColumn({ column: colC, bindingMap, riderId: "r1" }), true);
  assert.equal(canAddRiderToColumn({ column: { ...colC, withdrawn: true }, bindingMap, riderId: "r1" }), false);
  assert.equal(canAddRiderToColumn({ column: { ...colC, selection: { rider_ids: ["r1"] } }, bindingMap, riderId: "r1" }), false);
});

// deriveRaceStatus (#1828): visnings-status afledt af stages_completed. Backend
// skriver ALDRIG 'active' (finalization-invarianter); fronten afleder "live".
test("deriveRaceStatus: scheduled + ingen etaper kørt → scheduled", () => {
  assert.equal(deriveRaceStatus("scheduled", 0, 7), "scheduled");
});

test("deriveRaceStatus: scheduled + nogle (ikke alle) etaper kørt → live (#1828)", () => {
  assert.equal(deriveRaceStatus("scheduled", 3, 7), "live");
  assert.equal(deriveRaceStatus("scheduled", 1, 7), "live");
});

test("deriveRaceStatus: completed → completed uanset etape-tal", () => {
  assert.equal(deriveRaceStatus("completed", 7, 7), "completed");
  assert.equal(deriveRaceStatus("completed", 0, 7), "completed");
});

test("deriveRaceStatus: scheduled men alle etaper kørt → completed (status-flip undervejs)", () => {
  assert.equal(deriveRaceStatus("scheduled", 7, 7), "completed");
});

test("deriveRaceStatus: endagsløb (stages=1) bliver aldrig live", () => {
  assert.equal(deriveRaceStatus("scheduled", 0, 1), "scheduled");
  assert.equal(deriveRaceStatus("scheduled", 1, 1), "completed");
});

test("deriveRaceStatus: robust mod manglende stages", () => {
  assert.equal(deriveRaceStatus("scheduled", 0, 0), "scheduled");
  assert.equal(deriveRaceStatus("scheduled", 0, null), "scheduled");
});

// poolRaceDayTotals (#1829): per-pulje løbsdage-tæller. total = sum(stages);
// completed = løbsdage faktisk kørt INKL. igangværende etaper; inProgress = de
// løbsdage der hører til løb som stadig kører (ærligt mellemregnings-tal).
test("poolRaceDayTotals: total = sum(stages); completed inkluderer igangværende etaper", () => {
  const races = [
    { status: "completed", stages: 1, stages_completed: 1 },  // endagsløb færdig → 1/1
    { status: "scheduled", stages: 7, stages_completed: 3 },  // etapeløb i gang → 3 af 7
    { status: "scheduled", stages: 5, stages_completed: 0 },  // ikke startet → 0 af 5
  ];
  assert.deepEqual(poolRaceDayTotals(races), { completed: 4, total: 13, inProgress: 3 });
});

test("poolRaceDayTotals: completed-løb tæller alle sine etaper selv hvis stages_completed mangler", () => {
  assert.deepEqual(poolRaceDayTotals([{ status: "completed", stages: 21, stages_completed: 0 }]),
    { completed: 21, total: 21, inProgress: 0 });
});

test("poolRaceDayTotals: tom liste → nul", () => {
  assert.deepEqual(poolRaceDayTotals([]), { completed: 0, total: 0, inProgress: 0 });
  assert.deepEqual(poolRaceDayTotals(), { completed: 0, total: 0, inProgress: 0 });
});

test("poolRaceDayTotals: manglende stages → tæller som 1 (matcher DEFAULT 1)", () => {
  assert.deepEqual(poolRaceDayTotals([{ status: "scheduled", stages: null, stages_completed: 0 }]),
    { completed: 0, total: 1, inProgress: 0 });
});

test("poolRaceDayTotals: stages_completed klampes til [0, stages] (defensivt mod inkonsistent data)", () => {
  assert.deepEqual(poolRaceDayTotals([{ status: "scheduled", stages: 7, stages_completed: 9 }]),
    { completed: 7, total: 7, inProgress: 0 });
});

// fitTier/freshnessTier: centraliserede tærskler (erstatter inline-tal som fatigue>50).
test("fitTier: strong/average/poor + null ved manglende score", () => {
  assert.equal(fitTier(80), "strong");
  assert.equal(fitTier(66), "strong");
  assert.equal(fitTier(50), "average");
  assert.equal(fitTier(40), "average");
  assert.equal(fitTier(20), "poor");
  assert.equal(fitTier(null), null);
  assert.equal(fitTier(undefined), null);
});

test("freshnessTier: fresh/ok/tired + null ved manglende værdi", () => {
  assert.equal(freshnessTier(0), "fresh");
  assert.equal(freshnessTier(33), "fresh");
  assert.equal(freshnessTier(34), "ok");
  assert.equal(freshnessTier(66), "ok");
  assert.equal(freshnessTier(67), "tired");
  assert.equal(freshnessTier(null), null);
});
