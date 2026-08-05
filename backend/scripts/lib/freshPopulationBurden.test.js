import test from "node:test";
import assert from "node:assert/strict";

import { computeFreshSalaryBurden } from "./freshPopulationBurden.js";
import { computeFrozenSalary } from "../../lib/contractSeed.js";

// #3360-forensik: kaldestedet i freshPopulationBurden.js sendte { base_value } til
// computeFrozenSalary, som efter #2594 kun læser current_production_value. Feltet
// blev undefined, faldt tilbage på CONTRACT.BASE_VALUE_FALLBACK, og HVER rytter
// fik samme løn. Begge økonomi-scorecards undervurderede dermed lønbyrden med to
// størrelsesordener, uden at fejle — outputtet så bare mistænkeligt fladt ud.
//
// Guarden er derfor formet efter fejlens signatur (alt ens), ikke efter et
// konkret tal: konkrete tal ville låse kalibreringen, som netop skal kunne ændres.

test("computeFrozenSalary reagerer på current_production_value (kontrakten kaldestedet afhænger af)", () => {
  const lav = computeFrozenSalary({ current_production_value: 10_000 });
  const hoej = computeFrozenSalary({ current_production_value: 1_000_000 });
  assert.ok(hoej > lav * 50, `en 100x dyrere rytter skal koste markant mere i løn (fik ${lav} vs ${hoej})`);
});

test("computeFrozenSalary falder tilbage til en konstant når feltet mangler", () => {
  // Dokumenterer fælden: et forkert felt-navn fejler IKKE, det giver bare fallback.
  const fallback = computeFrozenSalary({});
  assert.equal(computeFrozenSalary({ base_value: 1_000_000 }), fallback);
});

test("lønbyrden varierer mellem hold — ikke min == median == max", () => {
  const r = computeFreshSalaryBurden();
  assert.ok(r.teamCount > 1, "harnessen skal generere flere hold");
  const { burdenMin, burdenMax } = r;
  assert.ok(
    Number.isFinite(burdenMin) && Number.isFinite(burdenMax),
    "min/max lønbyrde skal være tal",
  );
  assert.ok(
    burdenMax > burdenMin,
    `alle hold fik identisk lønbyrde (${burdenMin}) — kaldestedet sender formentlig et felt computeFrozenSalary ikke læser`,
  );
});

test("lønbyrden er i samme størrelsesorden som truppens værdi, ikke en fallback-konstant", () => {
  const r = computeFreshSalaryBurden();
  // Fejlen gav 8 x 161 = 1.288 CZ$ pr. hold. En ægte trup ligger mange
  // størrelsesordener over. 50.000 er valgt lavt nok til at overleve en
  // fremtidig satsændring, og højt nok til at fange fallback-tilstanden.
  assert.ok(
    r.burdenMedian > 50_000,
    `median lønbyrde ${r.burdenMedian} ser ud som fallback-konstanten, ikke en rigtig trup`,
  );
});
