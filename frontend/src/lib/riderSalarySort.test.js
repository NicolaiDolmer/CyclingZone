import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRidersByFilter, mergeSalarySortedIds } from "./riderColumnSort.js";

// #2403 regression: løn-sortering (rytterdatabase server-side + auktioner/
// transfermarked/hold/watchlist klient-side) skal følge den VISTE løn
// (getRiderSalary: frossen kontrakt-løn hvis sat, ellers current_production_value
// × global sats), ikke den rå `salary`-kolonne — som klumpede alle salary=NULL-
// ryttere (free agents m.fl.) i bunden uanset deres faktisk viste estimat-løn.

// ---- Klient-side: compareRidersByFilter (useClientRiderFilters — auktioner,
// transfermarkedets riderFilters, eget hold, watchlist) ----

const mixedRiders = [
  // Frossen kontrakt-løn, lav.
  { id: "low-frozen", firstname: "A", lastname: "Low", salary: 5000 },
  // Frossen kontrakt-løn, høj.
  { id: "high-frozen", firstname: "B", lastname: "High", salary: 50000 },
  // Free agent uden frossen løn — estimat = current_production_value × satsen.
  // Værdien er valgt så estimatet lander MELLEM "low-frozen" (5.000) og
  // "high-frozen" (50.000); den præcise sats må gerne ændre sig, rækkefølgen ikke.
  { id: "free-agent-mid", firstname: "C", lastname: "Mid", salary: null, current_production_value: 60000 },
  // Free agent med produktionsværdi 0 → estimat = fallback 1000 × satsen (lavest).
  { id: "free-agent-low", firstname: "D", lastname: "Floor", salary: null, current_production_value: 0 },
];

test("compareRidersByFilter salary desc — følger VIST løn, blander frossen + estimat korrekt", () => {
  const sorted = [...mixedRiders].sort((a, b) =>
    compareRidersByFilter(a, b, { sort: "salary", sort_dir: "desc" }));
  assert.deepEqual(sorted.map(r => r.id), ["high-frozen", "free-agent-mid", "low-frozen", "free-agent-low"]);
});

test("compareRidersByFilter salary asc — omvendt rækkefølge, free agents IKKE klumpet i bunden", () => {
  const sorted = [...mixedRiders].sort((a, b) =>
    compareRidersByFilter(a, b, { sort: "salary", sort_dir: "asc" }));
  assert.deepEqual(sorted.map(r => r.id), ["free-agent-low", "low-frozen", "free-agent-mid", "high-frozen"]);
});

test("compareRidersByFilter salary — salary:0 er en gyldig gratis-kontrakt, ikke NULL", () => {
  const riders = [
    { id: "free-zero", firstname: "Z", lastname: "Zero", salary: 0 },
    { id: "estimate", firstname: "E", lastname: "Est", salary: null, current_production_value: 5000 },
  ];
  const sorted = [...riders].sort((a, b) => compareRidersByFilter(a, b, { sort: "salary", sort_dir: "asc" }));
  assert.equal(sorted[0].id, "free-zero");
});

// ---- Server-side: mergeSalarySortedIds (fetchRidersPage → fetchRidersSortedBySalary) ----

test("mergeSalarySortedIds desc — fletter to letvægts-grene til én global rækkefølge", () => {
  const withSalary = [
    { id: "low-frozen", salary: 5000 },
    { id: "high-frozen", salary: 50000 },
  ];
  const withoutSalary = [
    // Estimat = cpv × satsen; værdien er valgt så den lander mellem de to frosne.
    { id: "free-agent-mid", current_production_value: 60000 },
    { id: "free-agent-low", current_production_value: 0 },
  ];
  const ids = mergeSalarySortedIds(withSalary, withoutSalary, false);
  assert.deepEqual(ids, ["high-frozen", "free-agent-mid", "low-frozen", "free-agent-low"]);
});

test("mergeSalarySortedIds asc — omvendt rækkefølge", () => {
  const withSalary = [
    { id: "low-frozen", salary: 5000 },
    { id: "high-frozen", salary: 50000 },
  ];
  const withoutSalary = [
    // Estimat = cpv × satsen; værdien er valgt så den lander mellem de to frosne.
    { id: "free-agent-mid", current_production_value: 60000 },
    { id: "free-agent-low", current_production_value: 0 },
  ];
  const ids = mergeSalarySortedIds(withSalary, withoutSalary, true);
  assert.deepEqual(ids, ["free-agent-low", "low-frozen", "free-agent-mid", "high-frozen"]);
});

test("mergeSalarySortedIds — paginering: side 2 fortsætter rækkefølgen fra side 1 (ingen huller/dubletter)", () => {
  const withSalary = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, salary: (i + 1) * 1000 }));
  const withoutSalary = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, current_production_value: (i + 1) * 2000 }));
  const fullOrder = mergeSalarySortedIds(withSalary, withoutSalary, false);
  assert.equal(fullOrder.length, 10);
  assert.equal(new Set(fullOrder).size, 10, "ingen dubletter på tværs af de to grene");

  // Simulér paginering med pageSize=4: side 1 (0-3) + side 2 (4-7) + side 3 (8-9)
  // skal tilsammen genskabe præcis fullOrder, uden huller eller overlap.
  const page1 = fullOrder.slice(0, 4);
  const page2 = fullOrder.slice(4, 8);
  const page3 = fullOrder.slice(8, 10);
  assert.deepEqual([...page1, ...page2, ...page3], fullOrder);
});

test("mergeSalarySortedIds — tom liste giver tom rækkefølge", () => {
  assert.deepEqual(mergeSalarySortedIds([], [], false), []);
});

test("mergeSalarySortedIds — stabil tie-break på id når estimeret løn er lige (fælles gulv)", () => {
  // To free agents uden produktionsværdi rammer begge estimat-gulvet (1000 × sats).
  const withoutSalary = [
    { id: "z-agent", current_production_value: 0 },
    { id: "a-agent", current_production_value: -5 },
  ];
  const ids = mergeSalarySortedIds([], withoutSalary, false);
  assert.deepEqual(ids, ["a-agent", "z-agent"], "tie-break er id-rækkefølge, deterministisk uanset side");
});
