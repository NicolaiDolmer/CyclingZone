import test from "node:test";
import assert from "node:assert/strict";

import { computeFreshSalaryBurden } from "./freshPopulationBurden.js";
import { computeFrozenSalary } from "../../lib/contractSeed.js";
import { SALARY_BASIS_MODE } from "../../lib/economyConstants.js";
import { SALARY_BASIS } from "../../lib/salaryBasis.js";

// #3389/#3360-forensik: kaldestedet i freshPopulationBurden.js sendte { base_value } til
// computeFrozenSalary, som efter #2594 kun læste current_production_value. Feltet
// blev undefined, faldt tilbage på CONTRACT.BASE_VALUE_FALLBACK, og HVER rytter
// fik samme løn. Begge økonomi-scorecards undervurderede dermed lønbyrden med to
// størrelsesordener, uden at fejle — outputtet så bare mistænkeligt fladt ud.
//
// Guarden er derfor formet efter fejlens signatur (alt ens), ikke efter et
// konkret tal: konkrete tal ville låse kalibreringen, som netop skal kunne ændres.
//
// #3360 gjorde fælden STØRRE, ikke mindre: nu findes der to grundlag, og et
// kaldested der kun kender det ene felt fejler tavst når SALARY_BASIS_MODE flyttes.
// Testene læser derfor mode'en i stedet for at antage et feltnavn.

// Hvilket felt bærer løn-basen i den aktive mode.
const BASE_FIELD = SALARY_BASIS_MODE === SALARY_BASIS.MARKET ? "market_value" : "current_production_value";

test("computeFrozenSalary reagerer på det felt det AKTIVE grundlag læser", () => {
  const lav = computeFrozenSalary({ [BASE_FIELD]: 10_000 });
  const hoej = computeFrozenSalary({ [BASE_FIELD]: 1_000_000 });
  assert.ok(hoej > lav * 2, `en 100x dyrere rytter skal koste markant mere i løn (fik ${lav} vs ${hoej} via ${BASE_FIELD})`);
});

test("computeFrozenSalary falder tilbage til en konstant når feltet mangler", () => {
  // Dokumenterer fælden: et forkert felt-navn fejler IKKE, det giver bare fallback.
  const fallback = computeFrozenSalary({});
  const wrongField = SALARY_BASIS_MODE === SALARY_BASIS.MARKET
    ? { current_production_value: 1_000_000 }   // ikke løn-basen i market-mode
    : { market_value: 1_000_000 };              // ikke løn-basen i production-mode
  assert.equal(computeFrozenSalary(wrongField), fallback);
});

test("alle produktions-kaldesteder skal sende BEGGE grundlag (forward-guard mod basis-skift)", () => {
  // Et kaldested der sender begge felter er korrekt uanset mode. Det er den eneste
  // form der overlever et fremtidigt skift af SALARY_BASIS_MODE.
  const begge = { current_production_value: 250_000, market_value: 250_000, base_value: 250_000 };
  assert.ok(computeFrozenSalary(begge) > computeFrozenSalary({}),
    "en rytter med begge felter sat må aldrig lande på fallback-lønnen");
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
