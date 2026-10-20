import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #6936 source-guard (samme stil som de øvrige wiring-tests; ingen jsdom i
// repoet): med economy_no_upkeep_v1 on sender backend inputs.no_upkeep=true og
// 0 for de tre udgifter. Kortet må så ikke forudsige dem: prognose-kolonnen
// viser "—" (value undefined) og upkeep-forklaringen om løbsdage forsvinder.
// Indeværende sæsons realiserede tal (s2Value, historik) vises uændret.
const src = readFileSync(new URL("./FinanceForecastCard.jsx", import.meta.url), "utf8");

test("#6936 kortet læser no_upkeep fra backendens inputs", () => {
  assert.match(src, /const noUpkeep = forecast\.inputs\?\.no_upkeep === true;/);
});

test("#6936 upkeep-, facilitets- og akademi-rækkerne forudsiger intet med no_upkeep", () => {
  assert.match(src, /value=\{noUpkeep \? undefined : forecast\.projected_upkeep\}/);
  assert.match(src, /value=\{noUpkeep \? undefined : forecast\.projected_facility_upkeep\}/);
  assert.match(src, /value=\{noUpkeep \? undefined : forecast\.projected_academy_drift\}/);
  assert.match(src, /detail=\{noUpkeep\s*\?\s*undefined/, "løbsdags-forklaringen skjules");
});

test("#6936 historikken (s2Value) er uændret på de tre rækker", () => {
  assert.match(src, /s2Value=\{s2\?\.upkeep\}/);
  assert.match(src, /s2Value=\{s2\?\.facility_upkeep\}/);
  assert.match(src, /s2Value=\{s2\?\.academy_drift\}/);
});
