import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRollingMedians,
  evaluateLevelCorrectionGate,
  runMarketValueLevelCorrectionGateSweep,
} from "./marketValueLevelCorrectionGate.js";
import {
  DEFAULT_MIN_QUALIFIED_TRADES,
  DEFAULT_STABILITY_BAND,
} from "./marketValueLevelCorrectionConfig.js";

const NOW = new Date("2026-08-19T20:00:00Z"); // en søndag

function sale({ daysAgo, price, anchor }) {
  const ts = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return { source: "transfer", sale_ts: ts, price, anchor_value: anchor };
}

test("computeRollingMedians: 3 punkter, ÆLDST→NYEST, seneste punkt slutter ved `now`", () => {
  const sales = [
    sale({ daysAgo: 5, price: 700, anchor: 1000 }),   // i alle tre vinduer
    sale({ daysAgo: 20, price: 800, anchor: 1000 }),  // kun i seneste to vinduer
    sale({ daysAgo: 40, price: 300, anchor: 1000 }),  // kun i ældste vindue (30d vindue der ender 14d tilbage: dag 14..44)
  ];
  const points = computeRollingMedians(sales, { now: NOW });
  assert.equal(points.length, 3);
  assert.ok(points[2].window_end > points[1].window_end); // sidste element = nyeste
  // Seneste vindue (ender ved now, dækker now-30..now): kun dag-5 og dag-20 salg ligger indenfor.
  assert.equal(points[2].n, 2);
});

test("evaluateLevelCorrectionGate: RØD ved for få kvalificerede handler (n90 < minimum)", () => {
  const qualified90d = [sale({ daysAgo: 1, price: 700, anchor: 1000 })]; // n=1
  const rollingMedians = [
    { window_end: "2026-08-05", n: 10, median: 0.7 },
    { window_end: "2026-08-12", n: 10, median: 0.71 },
    { window_end: "2026-08-19", n: 10, median: 0.69 },
  ];
  const gate = evaluateLevelCorrectionGate({
    qualified90d, rollingMedians,
    minQualifiedTrades: DEFAULT_MIN_QUALIFIED_TRADES,
    stabilityBand: DEFAULT_STABILITY_BAND,
  });
  assert.equal(gate.status, "red");
  assert.equal(gate.reason, "insufficient_evidence");
  assert.equal(gate.cCandidate, null);
});

test("evaluateLevelCorrectionGate: RØD ved manglende rullende historik (< 3 gyldige punkter)", () => {
  const qualified90d = Array.from({ length: 50 }, (_, i) => sale({ daysAgo: i % 80, price: 700, anchor: 1000 }));
  const rollingMedians = [
    { window_end: "2026-08-05", n: 0, median: null },
    { window_end: "2026-08-12", n: 10, median: 0.71 },
    { window_end: "2026-08-19", n: 10, median: 0.69 },
  ];
  const gate = evaluateLevelCorrectionGate({
    qualified90d, rollingMedians,
    minQualifiedTrades: DEFAULT_MIN_QUALIFIED_TRADES,
    stabilityBand: DEFAULT_STABILITY_BAND,
  });
  assert.equal(gate.status, "red");
  assert.equal(gate.reason, "insufficient_rolling_history");
});

// Tallene her er 1:1 fra scratchpad-måle-noten 19/8 (rullende 30d-median
// → 4/8: 0,665, → 11/8: 0,775, → 18/8: 0,908) — den faktiske RØDE måling der
// begrunder hvorfor gaten skal stå rød ved seed.
test("evaluateLevelCorrectionGate: RØD på selve 19/8-målingens tal (kanal ustabil)", () => {
  const qualified90d = Array.from({ length: 74 }, (_, i) => sale({ daysAgo: i % 89, price: 700, anchor: 1000 }));
  const rollingMedians = [
    { window_end: "2026-08-04", n: 20, median: 0.665 },
    { window_end: "2026-08-11", n: 32, median: 0.775 },
    { window_end: "2026-08-18", n: 48, median: 0.908 },
  ];
  const gate = evaluateLevelCorrectionGate({
    qualified90d, rollingMedians,
    minQualifiedTrades: DEFAULT_MIN_QUALIFIED_TRADES,
    stabilityBand: DEFAULT_STABILITY_BAND,
  });
  assert.equal(gate.status, "red");
  assert.equal(gate.reason, "unstable_channel");
  assert.ok(Math.abs(gate.spread - (0.908 - 0.665)) < 1e-9);
  assert.equal(gate.cCandidate, null);
});

test("evaluateLevelCorrectionGate: GRØN når n90 >= minimum OG de 3 rullende medianer er inden for båndet", () => {
  const qualified90d = Array.from({ length: 74 }, (_, i) => sale({ daysAgo: i % 89, price: 690, anchor: 1000 }));
  const rollingMedians = [
    { window_end: "2026-09-06", n: 40, median: 0.70 },
    { window_end: "2026-09-13", n: 42, median: 0.72 },
    { window_end: "2026-09-20", n: 45, median: 0.69 },
  ];
  const gate = evaluateLevelCorrectionGate({
    qualified90d, rollingMedians,
    minQualifiedTrades: DEFAULT_MIN_QUALIFIED_TRADES,
    stabilityBand: DEFAULT_STABILITY_BAND,
  });
  assert.equal(gate.status, "green");
  assert.equal(gate.reason, "stable");
  assert.ok(Number.isFinite(gate.cCandidate));
  // c-kandidaten er det NYESTE rullende vindues median (21/8-beslutningen, #3750).
  assert.ok(Math.abs(gate.cCandidate - 0.69) < 0.001);
});

test("evaluateLevelCorrectionGate: cCandidate er det NYESTE vindues median, IKKE median90 (drift-scenariet 21/8)", () => {
  // 90-dages-populationen har median 0,67 (gamle billige handler), men de tre
  // stabile rullende vinduer ligger 0,85-0,89. Fyringsværdien skal følge det
  // friske marked — median90 rapporteres kun til sammenligning.
  const qualified90d = Array.from({ length: 74 }, (_, i) => sale({ daysAgo: i % 89, price: 670, anchor: 1000 }));
  const rollingMedians = [
    { window_end: "2026-08-07", n: 22, median: 0.85 },
    { window_end: "2026-08-14", n: 29, median: 0.88 },
    { window_end: "2026-08-21", n: 51, median: 0.89 },
  ];
  const gate = evaluateLevelCorrectionGate({
    qualified90d, rollingMedians,
    minQualifiedTrades: DEFAULT_MIN_QUALIFIED_TRADES,
    stabilityBand: DEFAULT_STABILITY_BAND,
  });
  assert.equal(gate.status, "green");
  assert.ok(Math.abs(gate.cCandidate - 0.89) < 0.001, `cCandidate skal være nyeste vindue, fik ${gate.cCandidate}`);
  assert.ok(Math.abs(gate.median90 - 0.67) < 0.001, "median90 rapporteres stadig");
});

test("evaluateLevelCorrectionGate: grænsetilfælde — spread PRÆCIS på båndet er stadig grøn (<=, ikke <)", () => {
  const qualified90d = Array.from({ length: 40 }, (_, i) => sale({ daysAgo: i % 89, price: 700, anchor: 1000 }));
  const rollingMedians = [
    { window_end: "2026-09-06", n: 40, median: 0.60 },
    { window_end: "2026-09-13", n: 42, median: 0.70 },
    { window_end: "2026-09-20", n: 45, median: 0.75 }, // spread = 0.15, præcis DEFAULT_STABILITY_BAND
  ];
  const gate = evaluateLevelCorrectionGate({
    qualified90d, rollingMedians,
    minQualifiedTrades: DEFAULT_MIN_QUALIFIED_TRADES,
    stabilityBand: DEFAULT_STABILITY_BAND,
  });
  assert.equal(gate.status, "green");
});

// ─── runMarketValueLevelCorrectionGateSweep (orkestrering, injicerede deps) ─

const SUNDAY = new Date("2026-08-09T10:00:00Z"); // 12:00 CEST
const SATURDAY = new Date("2026-08-08T10:00:00Z");

function baseSweepDeps(overrides = {}) {
  return {
    readMinTrades: async () => DEFAULT_MIN_QUALIFIED_TRADES,
    readBand: async () => DEFAULT_STABILITY_BAND,
    fetchNegotiatedRawSales: async () => [],
    claimMeasurement: async () => ({ claimed: true, tableMissing: false }),
    completeMeasurement: async () => {},
    log: () => {},
    ...overrides,
  };
}

test("runMarketValueLevelCorrectionGateSweep: no-op på en ikke-søndag", async () => {
  const result = await runMarketValueLevelCorrectionGateSweep({
    supabase: { from: () => ({}) }, now: SATURDAY, ...baseSweepDeps(),
  });
  assert.deepEqual(result, { ran: false, skipped: "not_sunday" });
});

test("runMarketValueLevelCorrectionGateSweep: manual=true kører på en ikke-søndag (ejer-direktiv 21/8) — dedup gælder stadig", async () => {
  const completed = [];
  const result = await runMarketValueLevelCorrectionGateSweep({
    supabase: { from: () => ({}) }, now: SATURDAY, manual: true,
    ...baseSweepDeps({
      completeMeasurement: async ({ measuredDate, gate }) => { completed.push({ measuredDate, gate }); },
    }),
  });
  assert.equal(result.ran, true);
  assert.equal(result.manual, true);
  assert.equal(completed.length, 1);

  // Claim-dedup pr. dato blokerer stadig en manuel dobbelt-måling samme dag.
  const deduped = await runMarketValueLevelCorrectionGateSweep({
    supabase: { from: () => ({}) }, now: SATURDAY, manual: true,
    ...baseSweepDeps({ claimMeasurement: async () => ({ claimed: false, tableMissing: false }) }),
  });
  assert.deepEqual(deduped, { ran: false, skipped: "already_measured_today" });
});

test("runMarketValueLevelCorrectionGateSweep: no-op når allerede målt i dag (persisteret dedup)", async () => {
  const result = await runMarketValueLevelCorrectionGateSweep({
    supabase: { from: () => ({}) }, now: SUNDAY,
    ...baseSweepDeps({ claimMeasurement: async () => ({ claimed: false, tableMissing: false }) }),
  });
  assert.deepEqual(result, { ran: false, skipped: "already_measured_today" });
});

test("runMarketValueLevelCorrectionGateSweep: no-op når log-tabellen ikke findes endnu (migration ikke applied)", async () => {
  const result = await runMarketValueLevelCorrectionGateSweep({
    supabase: { from: () => ({}) }, now: SUNDAY,
    ...baseSweepDeps({ claimMeasurement: async () => ({ claimed: false, tableMissing: true }) }),
  });
  assert.deepEqual(result, { ran: false, skipped: "log_table_missing" });
});

test("runMarketValueLevelCorrectionGateSweep: kaster uden eksplicit `now`", async () => {
  await assert.rejects(
    () => runMarketValueLevelCorrectionGateSweep({ supabase: { from: () => ({}) }, ...baseSweepDeps() }),
    /eksplicit `now`/
  );
});

test("runMarketValueLevelCorrectionGateSweep: kører, måler, og persisterer gate-status via completeMeasurement", async () => {
  const completed = [];
  const result = await runMarketValueLevelCorrectionGateSweep({
    supabase: { from: () => ({}) }, now: SUNDAY,
    ...baseSweepDeps({
      fetchNegotiatedRawSales: async () => [],
      completeMeasurement: async ({ measuredDate, gate }) => { completed.push({ measuredDate, gate }); },
    }),
  });
  assert.equal(result.ran, true);
  assert.equal(result.status, "red"); // n=0 < minimum
  assert.equal(completed.length, 1);
  assert.equal(completed[0].gate.status, "red");
});
