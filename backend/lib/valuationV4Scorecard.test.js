// node --test for backend/lib/valuationV4Scorecard.js — ren gate-matematik, ingen
// DB, ingen runtime-afhængighed af riderCareerNpv.js (Kontrakt 3, bygget parallelt).
// Fixtures kun. Kør: node --test lib/valuationV4Scorecard.test.js (fra backend/).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ELITE_CHECK_OVERALL,
  allHardGatesPass,
  anchorSanityRow,
  determinismGate,
  developAndSellGate,
  developAndSellPnl,
  eliteUnbuyableGate,
  formatTrajectoryTable,
  formatTypeEconomyTable,
  populationStats,
  projectAbilitiesForward,
  scaleContinuityGate,
  symmetryReportRow,
  typeEconomyRows,
} from "./valuationV4Scorecard.js";

// ---------------------------------------------------------------------------
// populationStats
// ---------------------------------------------------------------------------

test("populationStats: p10/median/p90/total på et 10-element array (shuffled input)", () => {
  const shuffled = [50, 10, 100, 30, 70, 90, 20, 60, 40, 80];
  const stats = populationStats(shuffled);
  assert.equal(stats.n, 10);
  assert.equal(stats.p10, 20); // sorted [10..100], index floor(0.1*10)=1 → 20
  assert.equal(stats.median, 60); // index floor(0.5*10)=5 → 60
  assert.equal(stats.p90, 100); // index floor(0.9*10)=9 → 100
  assert.equal(stats.total, 550);
});

test("populationStats: tomt/ugyldigt input giver n=0 og nulls", () => {
  assert.deepEqual(populationStats([]), { n: 0, p10: null, median: null, p90: null, total: 0 });
  assert.deepEqual(populationStats([NaN, undefined, null]), { n: 0, p10: null, median: null, p90: null, total: 0 });
});

// ---------------------------------------------------------------------------
// typeEconomyRows / formatTypeEconomyTable — Gate 1 (rapport)
// ---------------------------------------------------------------------------

test("typeEconomyRows: aggregerer pr. type, sorteret desc efter median E[prize]", () => {
  const samples = [
    { primary_type: "sprinter", e_prize: 1000 },
    { primary_type: "sprinter", e_prize: 2000 },
    { primary_type: "sprinter", e_prize: 3000 },
    { primary_type: "sprinter", e_prize: 4000 },
    { primary_type: "sprinter", e_prize: 5000 },
    { primary_type: "climber", e_prize: 500 },
    { primary_type: "climber", e_prize: 700 },
  ];
  const v3Offset = { sprinter: 0.5 }; // climber mangler bevidst (fallback-case)
  const rows = typeEconomyRows(samples, v3Offset);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, "sprinter"); // højeste median først
  assert.equal(rows[0].n, 5);
  assert.equal(rows[0].medianEPrize, 3000);
  assert.equal(rows[0].p90EPrize, 5000);
  assert.equal(rows[0].v3Offset, 0.5);
  assert.ok(Math.abs(rows[0].v3OffsetMultiplier - Math.exp(0.5)) < 1e-9);

  assert.equal(rows[1].type, "climber");
  assert.equal(rows[1].n, 2);
  assert.equal(rows[1].medianEPrize, 700);
  assert.equal(rows[1].v3Offset, null);
  assert.equal(rows[1].v3OffsetMultiplier, null);
});

test("typeEconomyRows: ignorerer samples uden primary_type eller uden finite e_prize", () => {
  const samples = [
    { primary_type: "sprinter", e_prize: 1000 },
    { primary_type: null, e_prize: 2000 },
    { primary_type: "sprinter", e_prize: NaN },
    { primary_type: "sprinter" },
  ];
  const rows = typeEconomyRows(samples, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 1);
});

test("formatTypeEconomyTable: header + rækker matcher fmt", () => {
  const rows = typeEconomyRows(
    [{ primary_type: "gc", e_prize: 10000 }],
    { gc: 0.2 }
  );
  const lines = formatTypeEconomyTable(rows);
  assert.equal(lines[0], "| Type | n | Median E[prize] | p90 E[prize] | v3 offset (log) | v3 offset ×mult |");
  // toFixed() bruger altid "." (locale-uafhængig) — kun fmtCZ (toLocaleString) bruger da-DK "," / ".".
  assert.match(lines[2], /^\| gc \| 1 \| 10\.000 \| 10\.000 \| 0\.200 \| ×1\.22 \|$/);
});

// ---------------------------------------------------------------------------
// scaleContinuityGate — Gate 2 (hård, ±15% median-drift)
// ---------------------------------------------------------------------------

test("scaleContinuityGate: drift inden for ±15% er ok", () => {
  const v3 = Array(10).fill(100);
  const v4 = Array(10).fill(112); // +12%
  const gate = scaleContinuityGate(v3, v4);
  assert.equal(gate.hard, true);
  assert.equal(gate.ok, true);
  assert.ok(Math.abs(gate.stats.driftPct - 0.12) < 1e-9);
});

test("scaleContinuityGate: drift over 15% fejler", () => {
  const v3 = Array(10).fill(100);
  const v4 = Array(10).fill(120); // +20%
  const gate = scaleContinuityGate(v3, v4);
  assert.equal(gate.ok, false);
});

test("scaleContinuityGate: eksakt ±15% grænse er inklusiv (≤)", () => {
  const v3 = Array(10).fill(100);
  const v4 = Array(10).fill(115); // eksakt +15%
  const gate = scaleContinuityGate(v3, v4);
  assert.equal(gate.ok, true);
  const v4Neg = Array(10).fill(85); // eksakt -15%
  const gateNeg = scaleContinuityGate(v3, v4Neg);
  assert.equal(gateNeg.ok, true);
});

test("scaleContinuityGate: tom population fejler i stedet for at kaste", () => {
  const gate = scaleContinuityGate([], []);
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /utilstrækkelig data/);
});

// ---------------------------------------------------------------------------
// eliteUnbuyableGate — Gate 5 (hård) — afløser runaway
// ---------------------------------------------------------------------------

test("eliteUnbuyableGate: alle elite over råd-loft → ok", () => {
  const riders = [
    { overall: 70, v4Value: 80_000_000 },
    { overall: 60, v4Value: 20_000_000 },
    { overall: 30, v4Value: 50_000 }, // ikke-elite, ignoreres
  ];
  const gate = eliteUnbuyableGate(riders, { ceiling: 5_000_000 });
  assert.equal(gate.hard, true);
  assert.equal(gate.ok, true);
  assert.equal(gate.stats.nElite, 2);
});

test("eliteUnbuyableGate: en elite UNDER råd-loft → fejler (købelig)", () => {
  const riders = [
    { overall: 70, v4Value: 80_000_000 },
    { overall: 58, v4Value: 3_000_000 }, // under loft → købelig
  ];
  assert.equal(eliteUnbuyableGate(riders, { ceiling: 5_000_000 }).ok, false);
});

test("eliteUnbuyableGate: manglende råd-loft → fejler (kan ikke bekræfte)", () => {
  const gate = eliteUnbuyableGate([{ overall: 70, v4Value: 80_000_000 }], {});
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /råd-loft/);
});

test("eliteUnbuyableGate: ingen elite i populationen → fejler", () => {
  const gate = eliteUnbuyableGate([{ overall: 30, v4Value: 50_000 }], { ceiling: 5_000_000 });
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /ingen ryttere/);
});

test("eliteUnbuyableGate: tunbar overall-tærskel + default = ELITE_CHECK_OVERALL", () => {
  const riders = [{ overall: 50, v4Value: 6_000_000 }];
  assert.equal(eliteUnbuyableGate(riders, { ceiling: 5_000_000 }).ok, false); // 50 < 55 → ingen elite
  assert.equal(eliteUnbuyableGate(riders, { ceiling: 5_000_000, eliteOverall: 45 }).ok, true);
  assert.equal(ELITE_CHECK_OVERALL, 55);
});

// ---------------------------------------------------------------------------
// developAndSellPnl / developAndSellGate — Gate 3 (hård)
// ---------------------------------------------------------------------------

const TEST_ACADEMY = { SALARY_RATE: 0.1, SIGNING_FEE_RATE: 0.2, DRIFT_PER_SEASON: 1000 };

test("developAndSellPnl: reproducerer #1364-omkostningsmodellen", () => {
  // cost = 0.2*100000 + 3*(1000 + 0.1*100000) = 20000 + 33000 = 53000
  const result = developAndSellPnl({ bvStart: 100000, bvAtHorizon: 200000, seasons: 3, academy: TEST_ACADEMY });
  assert.equal(result.cost, 53000);
  assert.equal(result.pnl, 200000 - 100000 - 53000);
});

test("developAndSellGate: net-positiv + moderat ROI → ok", () => {
  // pnl=47000, invested=100000+53000=153000, ROI=30.7% ≤ 50% → ikke dominant.
  const gate = developAndSellGate({
    bvStart: 100000, bvAtHorizon: 200000, seasons: 3, academy: TEST_ACADEMY,
  });
  assert.equal(gate.hard, true);
  assert.equal(gate.ok, true);
  assert.equal(gate.pnl, 47000);
  assert.ok(gate.roi > 0.3 && gate.roi < 0.31);
});

test("developAndSellGate: negativ P&L fejler (net-positiv=false)", () => {
  const gate = developAndSellGate({
    bvStart: 100000, bvAtHorizon: 140000, seasons: 3, academy: TEST_ACADEMY,
  });
  assert.equal(gate.ok, false);
  assert.ok(gate.pnl < 0);
});

test("developAndSellGate: for højt ROI = dominant strategi → fejler selvom net-positiv", () => {
  // bvAtHorizon 400000 → pnl=247000, ROI=247000/153000=161% > 50% → dominant.
  const gate = developAndSellGate({
    bvStart: 100000, bvAtHorizon: 400000, seasons: 3, academy: TEST_ACADEMY,
  });
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /ikke-dominant=false/);
});

test("developAndSellGate: maxRoi er tunbar (samme P&L, strammere loft → dominant)", () => {
  const args = { bvStart: 100000, bvAtHorizon: 200000, seasons: 3, academy: TEST_ACADEMY };
  assert.equal(developAndSellGate({ ...args, maxRoi: 0.5 }).ok, true);  // 30.7% ≤ 50%
  assert.equal(developAndSellGate({ ...args, maxRoi: 0.2 }).ok, false); // 30.7% > 20%
});

test("developAndSellGate: manglende data (ingen seasons) → ubekræftet, ok=false", () => {
  const gate = developAndSellGate({ bvStart: 100000, bvAtHorizon: 200000, academy: TEST_ACADEMY });
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /ubekræftet/);
});

// ---------------------------------------------------------------------------
// projectAbilitiesForward — Gate 3-støtte (fremskrivning til bvAtHorizon)
// ---------------------------------------------------------------------------

test("projectAbilitiesForward: 0 sæsoner returnerer uændrede abilities på startAge", () => {
  const abilities = { climbing: 50, sprint: 40 };
  const result = projectAbilitiesForward(abilities, { primaryType: "climber", potentiale: 3, startAge: 20 }, 0);
  assert.deepEqual(result.abilities, abilities);
  assert.equal(result.ageAtHorizon, 20);
});

test("projectAbilitiesForward: unge signatur-evner vokser mod loftet over flere sæsoner", () => {
  const abilities = { climbing: 50 }; // climber-signatur (positiv vægt)
  const result = projectAbilitiesForward(abilities, { primaryType: "climber", potentiale: 4, startAge: 19 }, 3);
  assert.equal(result.ageAtHorizon, 22);
  assert.ok(result.abilities.climbing > abilities.climbing, "signatur-evnen skal vokse mod loftet for en ung, høj-potentiale rytter");
});

test("projectAbilitiesForward: deterministisk (samme input → samme output)", () => {
  const abilities = { climbing: 45, sprint: 30, endurance: 55 };
  const ctx = { primaryType: "gc", potentiale: 5, startAge: 21 };
  const a = projectAbilitiesForward(abilities, ctx, 5);
  const b = projectAbilitiesForward(abilities, ctx, 5);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// anchorSanityRow — Gate 6 (blød, aldrig exit 1)
// ---------------------------------------------------------------------------

test("anchorSanityRow: ingen brud → ok=true, hard=false", () => {
  const row = anchorSanityRow({ hard: [], soft: [] });
  assert.equal(row.hard, false);
  assert.equal(row.ok, true);
});

test("anchorSanityRow: hårde brud rapporteres men hard forbliver false (blokerer aldrig)", () => {
  const row = anchorSanityRow({ hard: [{ high: "A", low: "B", predHigh: 1, predLow: 2 }], soft: [] });
  assert.equal(row.hard, false); // aldrig exit-blokerende, uanset ok
  assert.equal(row.ok, false); // men afspejler status i rapporten
  assert.equal(row.hardBreaks.length, 1);
});

test("anchorSanityRow: default-argument håndterer manglende input", () => {
  const row = anchorSanityRow();
  assert.equal(row.ok, true);
});

// ---------------------------------------------------------------------------
// determinismGate — Gate 7 (hård)
// ---------------------------------------------------------------------------

test("determinismGate: sim_run_id sat → ok", () => {
  assert.equal(determinismGate({ simRunId: "abc123" }).ok, true);
});

test("determinismGate: manglende/tom sim_run_id → fejler", () => {
  assert.equal(determinismGate({}).ok, false);
  assert.equal(determinismGate({ simRunId: "" }).ok, false);
  assert.equal(determinismGate({ simRunId: null }).ok, false);
});

// ---------------------------------------------------------------------------
// formatTrajectoryTable / symmetryReportRow — Gate 4 (rapport)
// ---------------------------------------------------------------------------

test("formatTrajectoryTable: formatterer career-trajectory-rækker (careerTrajectory-formen)", () => {
  const rows = [
    { s: 0, age: 20, O: 65.4, prod: 150000, survival: 1, discounted: 150000 },
    { s: 1, age: 21, O: 68.1, prod: 180000, survival: 0.98, discounted: 141120 },
  ];
  const lines = formatTrajectoryTable("Ung talent", rows);
  assert.equal(lines[0], "**Ung talent**");
  assert.equal(lines[2], "| Alder | Output O | E[produktion] sæson (CZ$) | Survival | Diskonteret bidrag (CZ$) |");
  assert.equal(lines[4], "| 20 | 65.4 | 150.000 | 100% | 150.000 |");
  assert.equal(lines[5], "| 21 | 68.1 | 180.000 | 98% | 141.120 |");
});

test("formatTrajectoryTable: tom trajectory giver kun header", () => {
  const lines = formatTrajectoryTable("Veteran", []);
  assert.equal(lines.length, 4);
});

test("symmetryReportRow: >0 arketyper → ok", () => {
  assert.equal(symmetryReportRow(3).ok, true);
  assert.equal(symmetryReportRow(0).ok, false);
});

// ---------------------------------------------------------------------------
// allHardGatesPass — exit-kode-logik
// ---------------------------------------------------------------------------

test("allHardGatesPass: kun hårde gates tæller; bløde/rapport-gates blokerer aldrig", () => {
  const gates = [
    { hard: true, ok: true },
    { hard: true, ok: true },
    { hard: false, ok: false }, // fx anker-sanity med afvigelser — skal IKKE blokere
  ];
  assert.equal(allHardGatesPass(gates), true);
});

test("allHardGatesPass: én fejlet hård gate blokerer, uanset bløde gates", () => {
  const gates = [
    { hard: true, ok: true },
    { hard: true, ok: false },
    { hard: false, ok: true },
  ];
  assert.equal(allHardGatesPass(gates), false);
});

test("allHardGatesPass: tomt gates-array passerer trivielt", () => {
  assert.equal(allHardGatesPass([]), true);
});
