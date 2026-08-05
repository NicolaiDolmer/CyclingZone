import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSalaryFilterOr } from "./salaryFilter.js";
import { salaryBoundToValueBound, SALARY_ESTIMATE_COLUMN } from "./marketValues.js";

// #3360: estimat-grenens KOLONNE og værdi-grænse følger det aktive løn-grundlag.
// Testene bygger derfor den forventede streng af de samme eksporterede helpers —
// et hardcodet kolonnenavn ville tie når grundlaget skifter, og filteret ville
// stille pege på den forkerte kolonne (free agents droppet igen, jf. #1827).
const col = SALARY_ESTIMATE_COLUMN;
const bound = (n) => salaryBoundToValueBound(n);

// #1827: løn-filteret skal ramme den VISTE løn (frossen ELLER estimat), så free
// agents (salary == NULL i prod for ~785/793) ikke længere droppes stille af et
// rå `salary.lte`-filter. buildSalaryFilterOr bygger den PostgREST-or-streng der
// OR'er en frossen-løn-gren og en estimat-gren (market_value-interval).

test("buildSalaryFilterOr — intet løn-filter → null", () => {
  assert.equal(buildSalaryFilterOr({}), null);
  assert.equal(buildSalaryFilterOr({ min_salary: "", max_salary: "" }), null);
});

test("buildSalaryFilterOr — kun max_salary: estimat-grenen tillader NULL-løn via værdi-kolonnen", () => {
  const or = buildSalaryFilterOr({ max_salary: "5000" });
  assert.equal(
    or,
    `and(salary.not.is.null,salary.lte.5000),and(salary.is.null,${col}.lte.${bound(5000)})`,
  );
  // Den kritiske rettelse: en gren matcher EKSPLICIT salary.is.null (free agents),
  // som det gamle `salary.lte`-filter ekskluderede.
  assert.ok(or.includes("salary.is.null"));
});

test("buildSalaryFilterOr — kun min_salary", () => {
  const or = buildSalaryFilterOr({ min_salary: "1000" });
  assert.equal(
    or,
    `and(salary.not.is.null,salary.gte.1000),and(salary.is.null,${col}.gte.${bound(1000)})`,
  );
});

test("buildSalaryFilterOr — tosidet interval AND'er begge grænser i hver gren", () => {
  const or = buildSalaryFilterOr({ min_salary: "1000", max_salary: "5000" });
  assert.equal(
    or,
    "and(salary.not.is.null,salary.gte.1000,salary.lte.5000)," +
      `and(salary.is.null,${col}.gte.${bound(1000)},${col}.lte.${bound(5000)})`,
  );
});

test("buildSalaryFilterOr — estimat-kolonnen matcher det aktive løn-grundlag", () => {
  // Forward-guard: kolonnen må aldrig være hardcodet til det gamle grundlag.
  assert.ok(["market_value", "current_production_value"].includes(col));
  assert.ok(buildSalaryFilterOr({ max_salary: "5000" }).includes(`${col}.lte.`));
});

test("buildSalaryFilterOr — frossen-grenen kræver salary.not.is.null (matcher kun rigtige kontrakter)", () => {
  const or = buildSalaryFilterOr({ max_salary: "100" });
  assert.ok(or.startsWith("and(salary.not.is.null,"));
});
