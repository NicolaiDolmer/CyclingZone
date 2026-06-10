import test from "node:test";
import assert from "node:assert/strict";

import { auditValuationRows } from "./valuationCutoverAudit.js";

// Konsistent række som DB'ens GENERATED-formler ville producere.
function row(over = {}) {
  const base_value = over.base_value !== undefined ? over.base_value : 45_000;
  const prize_earnings_bonus = over.prize_earnings_bonus ?? 0;
  const effBase = Number(base_value) > 0 ? Number(base_value) : 1000;
  const market_value = over.market_value !== undefined ? over.market_value : effBase + prize_earnings_bonus;
  return {
    id: "r1", firstname: "Test", lastname: "Rytter",
    base_value, prize_earnings_bonus, market_value,
    salary: over.salary !== undefined ? over.salary : Math.max(1, Math.round(market_value * 0.10)),
    is_retired: false, pcm_id: null,
    ...over,
  };
}

test("konsistent population er grøn", () => {
  const { failures } = auditValuationRows([row(), row({ id: "r2", base_value: 8_000_000, salary: 800_000, market_value: 8_000_000 })]);
  assert.deepEqual(failures, []);
});

test("tom population fanges — vacuous truth må ikke give grønt (#1198 cut-M4)", () => {
  const { failures } = auditValuationRows([]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /vakuøs/);
});

test("hel-pensioneret population fanges (#1198 cut-M4 variant B)", () => {
  const { failures } = auditValuationRows([row({ is_retired: true }), row({ id: "r2", is_retired: true })]);
  assert.ok(failures.some((f) => /vakuøs/.test(f)), failures.join("; "));
});

test("negativ market_value via negativ bonus fanges (#1198 cut-M3)", () => {
  // GENERATED-formlen genberegner konsistent: mv = 1000 + (-51000) = -50000,
  // salary = max(1, ...) = 1 — formel-konsistens er grøn, domæne-invarianten ikke.
  const r = row({ base_value: 1000, prize_earnings_bonus: -51_000, market_value: -50_000, salary: 1 });
  const { failures } = auditValuationRows([r]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /market_value ≤ 0/);
});

test("divergent runtime-fallback fanges — check (d) er ikke længere en tautologi (#1198 cut-M1)", () => {
  const divergent = (r) => {
    const base = Number(r.base_value) > 0 ? Number(r.base_value) : 1000;
    return base * 3 + (Number(r.prize_earnings_bonus) || 0); // muteret formel
  };
  const { failures } = auditValuationRows([row()], { marketValueFn: divergent });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /runtime-fallback-formlen divergerer/);
});

test("aktive pcm-ryttere fanges KUN med expectFictional (#1198 cut-M5)", () => {
  const rows = [row(), row({ id: "r2", pcm_id: 101 })];
  // Default: prod kører legitimt på rigtige ryttere FØR relaunch → grøn.
  assert.deepEqual(auditValuationRows(rows).failures, []);
  // Post-relaunch-tilstand håndhæves med flag.
  const { failures } = auditValuationRows(rows, { expectFictional: true });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /pcm_id/);
});

test("base_value NULL/0 på aktive fanges (band a)", () => {
  const r = row({ base_value: null, market_value: 1000, salary: 100 });
  const { failures } = auditValuationRows([r]);
  assert.ok(failures.some((f) => /base_value NULL\/0/.test(f)), failures.join("; "));
});

test("market_value/salary-formelafvigelse fanges (band b+c)", () => {
  const { failures } = auditValuationRows([row({ market_value: 999_999 })]);
  assert.ok(failures.some((f) => /market_value ≠ COALESCE/.test(f)), failures.join("; "));
  const { failures: f2 } = auditValuationRows([row({ salary: 7 })]);
  assert.ok(f2.some((f) => /salary ≠ max/.test(f)), f2.join("; "));
});

// KENDT HUL (dokumenteret, #1198 cut-M2 → #1196): en FLAD værdi-skala (alle
// ryttere = 1000) består formel-konsistensen — fordelings-bånd er en
// ejer-beslutning (scorecard #1196). Denne test LÅSER den nuværende kontrakt,
// så hullet er eksplicit i stedet for stiltiende.
test("kendt hul: flad værdi-fordeling består (fordelings-bånd hører til #1196)", () => {
  const rows = ["a", "b", "c"].map((id) => row({ id, base_value: 1000, market_value: 1000, salary: 100 }));
  assert.deepEqual(auditValuationRows(rows).failures, []);
});
