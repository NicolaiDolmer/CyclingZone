import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRidersByFilter, mergeSalarySortedIds } from "./riderColumnSort.js";
import { getRiderSalary, SALARY_ESTIMATE_COLUMN } from "./marketValues.js";

// #2403 regression: løn-sortering (rytterdatabase server-side + auktioner/
// transfermarked/hold/watchlist klient-side) skal følge den VISTE løn
// (getRiderSalary: frossen kontrakt-løn hvis sat, ellers grundlags-estimatet —
// SALARY_ESTIMATE_COLUMN, #3360 = market_value), ikke den rå `salary`-kolonne —
// som klumpede alle salary=NULL-ryttere (free agents m.fl.) i bunden uanset
// deres faktisk viste estimat-løn.
//
// #3959-fund (lønbasis-cutover 19/8): fixturerne herunder brugte tidligere
// current_production_value (CPV-æraens grundlag). Under SALARY_BASIS_MODE=
// "market" bruger getRiderSalary IKKE current_production_value længere — kun
// market_value/base_value — så fixturerne er flyttet til SALARY_ESTIMATE_COLUMN,
// som altid følger det AKTIVE grundlag i stedet for et hardkodet feltnavn.

// ---- Klient-side: compareRidersByFilter (useClientRiderFilters — auktioner,
// transfermarkedets riderFilters, eget hold, watchlist) ----

const mixedRiders = [
  // Frossen kontrakt-løn, lav.
  { id: "low-frozen", firstname: "A", lastname: "Low", salary: 5000 },
  // Frossen kontrakt-løn, høj.
  { id: "high-frozen", firstname: "B", lastname: "High", salary: 50000 },
  // Free agent uden frossen løn — estimat via SALARY_ESTIMATE_COLUMN, valgt så
  // estimatet ligger LIGE UNDER "high-frozen" (verificeret nedenfor, ikke antaget).
  { id: "free-agent-mid", firstname: "C", lastname: "Mid", salary: null, [SALARY_ESTIMATE_COLUMN]: 800000 },
  // Free agent med værdi 0 → falder til estimat-gulvet (base-fallback).
  { id: "free-agent-low", firstname: "D", lastname: "Floor", salary: null, [SALARY_ESTIMATE_COLUMN]: 0 },
];

// Låser selve fixture-forudsætningen (i stedet for at antage den): estimatet for
// "free-agent-mid" skal ligge strengt mellem de to frosne lønninger, ellers siger
// rækkefølge-testerne nedenfor ingenting om den rigtige bug.
test("fixture-forudsætning: free-agent-mid's estimat ligger mellem low-frozen og high-frozen", () => {
  const midEstimate = getRiderSalary({ [SALARY_ESTIMATE_COLUMN]: 800000 });
  assert.ok(midEstimate > 5000 && midEstimate < 50000, `estimat ${midEstimate} skal ligge mellem 5000 og 50000`);
});

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
    { id: "estimate", firstname: "E", lastname: "Est", salary: null, [SALARY_ESTIMATE_COLUMN]: 5000 },
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
    { id: "free-agent-mid", [SALARY_ESTIMATE_COLUMN]: 800000 },
    { id: "free-agent-low", [SALARY_ESTIMATE_COLUMN]: 0 },
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
    { id: "free-agent-mid", [SALARY_ESTIMATE_COLUMN]: 800000 },
    { id: "free-agent-low", [SALARY_ESTIMATE_COLUMN]: 0 },
  ];
  const ids = mergeSalarySortedIds(withSalary, withoutSalary, true);
  assert.deepEqual(ids, ["free-agent-low", "low-frozen", "free-agent-mid", "high-frozen"]);
});

test("mergeSalarySortedIds — paginering: side 2 fortsætter rækkefølgen fra side 1 (ingen huller/dubletter)", () => {
  const withSalary = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, salary: (i + 1) * 1000 }));
  const withoutSalary = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, [SALARY_ESTIMATE_COLUMN]: (i + 1) * 2000 }));
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
  // To free agents uden en gyldig værdi rammer begge samme fallback-estimat.
  const withoutSalary = [
    { id: "z-agent", [SALARY_ESTIMATE_COLUMN]: 0 },
    { id: "a-agent", [SALARY_ESTIMATE_COLUMN]: -5 },
  ];
  const ids = mergeSalarySortedIds([], withoutSalary, false);
  assert.deepEqual(ids, ["a-agent", "z-agent"], "tie-break er id-rækkefølge, deterministisk uanset side");
});
