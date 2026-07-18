// #1827: løn-filter-helper til den server-side rytter-query (useRiderFilters).
//
// Løn-filteret gælder den VISTE løn = COALESCE(salary, market_value*RATE). Et rå
// `salary.gte/lte`-filter i PostgREST droppede stille alle NULL-løn-ryttere (alle
// free agents + 716 kontraktløse seniorer i prod 25/6) → "fri agent + max-løn" gav
// næsten 0 hits. PostgREST kan ikke filtrere på et COALESCE-udtryk, så vi bygger en
// `.or()` af to grene:
//   (A) frossen løn: salary IS NOT NULL AND salary i [min,max]
//   (B) estimat:     salary IS NULL     AND market_value i [min/RATE, max/RATE]
//
// Ren modul (kun import fra marketValues.js) så det er node --test-venligt uden at
// trække JSX-komponenter ind via useRiderFilters.js (#803-fælden).

import { salaryBoundToValueBound } from "./marketValues.js";

// Bygger PostgREST-or-strengen for løn-filteret. Returnerer null når intet løn-
// filter er sat (kalderen springer .or() over). Kolonnenavnene er uprefixede —
// referencedTable-optionen scoper dem ved embedded queries.
export function buildSalaryFilterOr(filters = {}) {
  if (!filters.min_salary && !filters.max_salary) return null;
  const frozenParts = [];
  const estimateParts = ["salary.is.null"];
  // #2594: estimat-grenen matcher getRiderSalary's nye base — current_production_value.
  if (filters.min_salary) {
    frozenParts.push(`salary.gte.${parseInt(filters.min_salary, 10)}`);
    estimateParts.push(`current_production_value.gte.${salaryBoundToValueBound(filters.min_salary)}`);
  }
  if (filters.max_salary) {
    frozenParts.push(`salary.lte.${parseInt(filters.max_salary, 10)}`);
    estimateParts.push(`current_production_value.lte.${salaryBoundToValueBound(filters.max_salary)}`);
  }
  const frozenBranch = `and(salary.not.is.null,${frozenParts.join(",")})`;
  const estimateBranch = `and(${estimateParts.join(",")})`;
  return `${frozenBranch},${estimateBranch}`;
}
