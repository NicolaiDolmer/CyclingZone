import test from "node:test";
import assert from "node:assert/strict";

import { planChanges } from "./salaryBasisRecompute.js";
import { computeFrozenSalary } from "../lib/contractSeed.js";

// #3360-genberegningen er EJER-GATED til sæsonskiftet og skrives kun én gang.
// Den skal derfor være idempotent (en anden kørsel = no-op) og aldrig røre en
// rytter hvis løn allerede matcher formlen — ellers kan en afbrudt kørsel ikke
// genoptages sikkert.

const rider = (over) => ({
  id: over.id, team_id: "t1", division: 2,
  market_value: over.market_value, base_value: over.market_value,
  current_production_value: over.cpv ?? over.market_value,
  salary: over.salary,
});

test("planChanges: kun ryttere hvis gemte løn afviger fra formlen", () => {
  const alreadyCorrect = rider({ id: "a", market_value: 200_000, salary: null });
  alreadyCorrect.salary = computeFrozenSalary(alreadyCorrect);
  const stale = rider({ id: "b", market_value: 200_000, salary: 1 });

  const { changes, unchanged } = planChanges([alreadyCorrect, stale]);
  assert.equal(unchanged, 1);
  assert.deepEqual(changes.map((c) => c.id), ["b"]);
  assert.equal(changes[0].after, computeFrozenSalary(stale));
});

test("planChanges: idempotent — anden kørsel på resultatet giver nul ændringer", () => {
  const riders = [
    rider({ id: "a", market_value: 20_000, salary: 2_971 }),
    rider({ id: "b", market_value: 180_000, salary: 1_273 }),
    rider({ id: "c", market_value: 5_000_000, salary: 40_000 }),
  ];
  const first = planChanges(riders);
  assert.equal(first.changes.length, 3);

  // Simulér skrivningen og kør igen.
  const after = riders.map((r) => ({ ...r, salary: first.changes.find((c) => c.id === r.id).after }));
  const second = planChanges(after);
  assert.equal(second.changes.length, 0, "anden kørsel skal være en ren no-op");
  assert.equal(second.unchanged, 3);
});

test("planChanges: tæller ryttere uden læsbar værdi (fallback-fælden fra #3389)", () => {
  const blind = { id: "x", team_id: "t1", division: 3, salary: 100 }; // ingen værdi-felter
  const { fallbackHits } = planChanges([blind, rider({ id: "y", market_value: 50_000, salary: 1 })]);
  assert.equal(fallbackHits, 1, "en ejet rytter uden værdi skal RAPPORTERES, ikke tavst få bundlønnen");
});

test("planChanges: genberegningen fjerner inversionen på tværs af populationen", () => {
  // Prod-signaturen 5/8: veteranen (20.347) betalte MERE end talentet (180.024).
  const talent = rider({ id: "talent", market_value: 180_024, salary: 1_273 });
  const veteran = rider({ id: "veteran", market_value: 20_347, salary: 2_971 });
  const { changes } = planChanges([talent, veteran]);
  const after = Object.fromEntries(changes.map((c) => [c.id, c.after]));
  assert.ok(after.talent > after.veteran, `efter: talent ${after.talent} > veteran ${after.veteran}`);
});
