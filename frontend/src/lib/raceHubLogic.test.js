// frontend/src/lib/raceHubLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeColumnStatus, isSelectionSavable, isRiderBound, deriveRaceStatus, poolRaceDayTotals, fitTier, freshnessTier } from "./raceHubLogic.js";

test("computeColumnStatus: full / understaffed / withdrawn", () => {
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 5, target: 7, withdrawn: false }), { kind: "understaffed", selected: 5, target: 7 });
  assert.deepEqual(computeColumnStatus({ selected: 0, target: 8, withdrawn: true }), { kind: "withdrawn", selected: 0, target: 8 });
  // Rod A: transient over max (kladde-bytte på fuld trup) → overfull, ikke full.
  assert.deepEqual(computeColumnStatus({ selected: 7, target: 6, max: 6, withdrawn: false }), { kind: "overfull", selected: 7, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, max: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
});

// Rod A (#1823): auto-gem-når-gyldig — kun gyldige størrelser persisteres.
test("isSelectionSavable: kun gyldig størrelse gemmes (transient 5/7 på 6/6 → nej)", () => {
  // 6/6-løb, fuld trup tilgængelig
  assert.equal(isSelectionSavable({ count: 6, min: 6, max: 6, available: 12 }), true);
  assert.equal(isSelectionSavable({ count: 5, min: 6, max: 6, available: 12 }), false, "under min → ikke gemt");
  assert.equal(isSelectionSavable({ count: 7, min: 6, max: 6, available: 12 }), false, "over max → ikke gemt");
  // Lille trup: kun 4 tilgængelige → effectiveMin=4, så 4 er nok (mirror backend).
  assert.equal(isSelectionSavable({ count: 4, min: 6, max: 6, available: 4 }), true);
});

test("isRiderBound: rytter bundet i et ANDET kolonne-løb end det aktuelle", () => {
  const bindingMap = { r1: ["a"], r2: ["b"] };
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "b" }), true); // r1 er i a, bundet ift. b
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "a" }), false); // r1 ER a's egen
  assert.equal(isRiderBound({ bindingMap, riderId: "r9", forRaceId: "b" }), false);
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
