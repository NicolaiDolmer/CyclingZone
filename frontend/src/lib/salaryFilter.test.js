import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSalaryFilterOr } from "./salaryFilter.js";

// #1827: løn-filteret skal ramme den VISTE løn (frossen ELLER estimat), så free
// agents (salary == NULL i prod for ~785/793) ikke længere droppes stille af et
// rå `salary.lte`-filter. buildSalaryFilterOr bygger den PostgREST-or-streng der
// OR'er en frossen-løn-gren og en estimat-gren (market_value-interval).

test("buildSalaryFilterOr — intet løn-filter → null", () => {
  assert.equal(buildSalaryFilterOr({}), null);
  assert.equal(buildSalaryFilterOr({ min_salary: "", max_salary: "" }), null);
});

test("buildSalaryFilterOr — kun max_salary: estimat-grenen tillader NULL-løn via market_value", () => {
  // #2594: value-bound = round(5000/0.1606) = 31133 (global prod-sats, ikke længere 0.067)
  const or = buildSalaryFilterOr({ max_salary: "5000" });
  assert.equal(
    or,
    "and(salary.not.is.null,salary.lte.5000),and(salary.is.null,current_production_value.lte.31133)",
  );
  // Den kritiske rettelse: en gren matcher EKSPLICIT salary.is.null (free agents),
  // som det gamle `salary.lte`-filter ekskluderede.
  assert.ok(or.includes("salary.is.null"));
});

test("buildSalaryFilterOr — kun min_salary", () => {
  const or = buildSalaryFilterOr({ min_salary: "1000" });
  // value-bound = round(1000/0.1606) = 6227
  assert.equal(
    or,
    "and(salary.not.is.null,salary.gte.1000),and(salary.is.null,current_production_value.gte.6227)",
  );
});

test("buildSalaryFilterOr — tosidet interval AND'er begge grænser i hver gren", () => {
  const or = buildSalaryFilterOr({ min_salary: "1000", max_salary: "5000" });
  assert.equal(
    or,
    "and(salary.not.is.null,salary.gte.1000,salary.lte.5000)," +
      "and(salary.is.null,current_production_value.gte.6227,current_production_value.lte.31133)",
  );
});

test("buildSalaryFilterOr — frossen-grenen kræver salary.not.is.null (matcher kun rigtige kontrakter)", () => {
  const or = buildSalaryFilterOr({ max_salary: "100" });
  assert.ok(or.startsWith("and(salary.not.is.null,"));
});
