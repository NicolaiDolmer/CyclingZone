#!/usr/bin/env node
// #1441/#1607 economy-calibration-sweep — finder de økonomi-tal der gør et KOMPETENT
// hold ~break-even, MÅLT af den ægte prizeDistributionScorecard (ikke gættet).
//
// 100% SYNTETISK — ingen DB, ingen prod-impact. Importerer runScorecard() fra
// prizeDistributionScorecard.js og kører den over et grid af {sponsorBase, prizePerPoint,
// flatten}-kandidater × flere seeds. Prod-konstanterne (economyConstants.js,
// uciRacePointDefaults.js) er UÆNDREDE — alt sker via override-mekanismen.
//
//   node scripts/economyCalibrationSweep.js [--seeds=2026,2027,2028] [--top=10] [--markdown]
//
// MÅL (ejer-beslutning 2026-06-21, spec §1 A + §6):
//   • D1 median-net ≈ 0   (|median| ≤ 30.000)
//   • D2 median-net ∈ [0, +20.000]
//   • D3 median-net ∈ [0, +30.000]   (progressiv, anti-snowball)
//   • 5-sæsons saldo i 0,8×–1,3× start  ·  ingen division median-net < −30k
//   • SEKUNDÆRT: lavest mulig divergens (Gini / p10–p90 spread)
//
// RANGERING: kandidater der rammer net-målene over ALLE seeds (median-aggregat)
// sorteres efter (i) net-mål-afstand, derefter (ii) divergens (gns. Gini over divisioner).

import { runScorecard } from "./prizeDistributionScorecard.js";
import {
  SPONSOR_INCOME_BY_DIVISION,
  UPKEEP_BY_DIVISION,
  PRIZE_PER_POINT,
} from "../lib/economyConstants.js";
import { W_RESULTS, MAX_MULTIPLIER } from "../lib/renownEngine.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const SEEDS = String(arg("seeds", "2026,2027,2028")).split(",").map((s) => parseInt(s.trim(), 10));
const TOP = parseInt(arg("top", "12"), 10);
const TEAM_COUNT = parseInt(arg("teams", "22"), 10);
const ROSTER_SIZE = parseInt(arg("roster", "8"), 10);
const MARKDOWN = !!arg("markdown", false);

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) / 2)] : 0;
};

// Net-mål pr. division (midtpunkt + tilladt bånd). D1 ≈ 0; D2/D3 progressiv buffer.
const NET_TARGET = {
  1: { lo: -30000, hi: 30000, mid: 0 },
  2: { lo: 0, hi: 20000, mid: 10000 },
  3: { lo: 0, hi: 30000, mid: 15000 },
};

// ── Kandidat-grid ────────────────────────────────────────────────────────────────
// Sponsor er den primære NIVEAU-knap (flad add → divergens-neutral). prizePerPoint
// trades niveau MOD divergens (multiplikativ). flatten skærer divergensen (komprimerer
// GC-top, booster etape/hold). Vi holder upkeep = prod-shippet (Fase 1) medmindre
// målene er uopnåelige — så flagges det højlydt (se note nederst).
//
// Sponsor-kandidater pr. division er centreret om det niveau der lukker baseline-gappet
// (D1 ~−372k → behøver ~+370k flad løft fra prod 600k → ~970k-zonen; D2/D3 mindre).
const SPONSOR_GRID = {
  1: [820000, 880000, 940000, 980000, 1020000],
  2: [560000, 620000, 680000, 740000],
  3: [360000, 400000, 440000, 480000],
};
const PRIZE_PER_POINT_GRID = [1000, 1250, 1500];
const FLATTEN_GRID = [0, 0.3, 0.5];
// breadthBoost: 0 = ren GC-kompression (etape/hold uændret); 0.6 = + breadth-boost.
// Empirisk øger breadth-boost divergens (stærke hold vinder også etaper) → test begge.
const BREADTH_BOOST_GRID = [0, 0.6];

// #1663 Fase J — renown-sponsor-grid. Holder sponsor/ppp/flatten på de Fase-2-besluttede
// PROD-værdier (prod-curven bager allerede flatten 0.5 ind → override flatten=0) og sweeper
// KUN de to renown-knapper. wResults skalerer resultsScore∈[0,1] ind i multiplieren;
// maxMultiplier clamper top-holdets løft. wResults=0 = renown SLUKKET (= flad sponsor,
// flatten-0.5-baseline) → med i griddet som anti-snowball-referencepunkt.
const W_RESULTS_GRID = [0, 0.3, 0.45, 0.6, 0.75];
const MAX_MULTIPLIER_GRID = [1.4, 1.6, 1.8];

const RENOWN_MODE = !!arg("renown", false);

function* sponsorCandidates() {
  for (const s1 of SPONSOR_GRID[1])
    for (const s2 of SPONSOR_GRID[2])
      for (const s3 of SPONSOR_GRID[3])
        for (const ppp of PRIZE_PER_POINT_GRID)
          for (const flatten of FLATTEN_GRID)
            for (const breadthBoost of (flatten === 0 ? [0] : BREADTH_BOOST_GRID))
              yield {
                sponsorBase: { 1: s1, 2: s2, 3: s3 },
                upkeep: { ...UPKEEP_BY_DIVISION },
                prizePerPoint: ppp,
                flatten,
                breadthBoost,
              };
}

// Renown-sweep: prod sponsor/ppp + prod-curve (flatten=0 i override = ingen dobbelt-flad).
function* renownCandidates() {
  for (const wResults of W_RESULTS_GRID)
    for (const maxMultiplier of (wResults === 0 ? [MAX_MULTIPLIER_GRID[0]] : MAX_MULTIPLIER_GRID))
      yield {
        sponsorBase: { ...SPONSOR_INCOME_BY_DIVISION },
        upkeep: { ...UPKEEP_BY_DIVISION },
        prizePerPoint: PRIZE_PER_POINT,
        flatten: 0,
        breadthBoost: 0,
        wResults,
        maxMultiplier,
      };
}

function* candidates() {
  yield* (RENOWN_MODE ? renownCandidates() : sponsorCandidates());
}

// Kør én kandidat over alle seeds; aggreger pr. division (median-af-seeds).
function evaluate(overrides) {
  const perSeed = SEEDS.map((seed) =>
    runScorecard({ seed, teamCount: TEAM_COUNT, rosterSize: ROSTER_SIZE, overrides, print: false })
  );
  const agg = {};
  for (const d of [1, 2, 3]) {
    const medNets = perSeed.map((r) => r.divisions[d].medNet);
    const p10s = perSeed.map((r) => r.divisions[d].p10);
    const p90s = perSeed.map((r) => r.divisions[d].p90);
    const ginis = perSeed.map((r) => r.divisions[d].gini);
    const spreads = perSeed.map((r) => r.divisions[d].p10p90Spread);
    const ratioS5 = perSeed.map((r) => r.trajectories[d].ratioS5);
    agg[d] = {
      medNet: median(medNets),
      medNetMin: Math.min(...medNets),
      medNetMax: Math.max(...medNets),
      p10: median(p10s),
      p90: median(p90s),
      gini: median(ginis),
      spread: median(spreads),
      ratioS5: median(ratioS5),
    };
  }
  return { overrides, agg, perSeed };
}

// Mål-score: hvor langt median-net (aggreg.) er fra mål-båndet, summeret over divisioner.
// 0 = alle i bånd. Lavere = bedre. Bruger min-af-seeds for robusthed mod seed-varians.
function targetDistance(agg) {
  let dist = 0;
  let allInBand = true;
  for (const d of [1, 2, 3]) {
    const t = NET_TARGET[d];
    const v = agg[d].medNet;
    if (v < t.lo) { dist += t.lo - v; allInBand = false; }
    else if (v > t.hi) { dist += v - t.hi; allInBand = false; }
    // konservativ: straf hvis NOGEN seed falder under den hårde −30k median-bund (§6)
    if (agg[d].medNetMin < -30000) { dist += (-30000 - agg[d].medNetMin) * 0.5; allInBand = false; }
    // trajektorie-bånd 0,8–1,3×
    if (agg[d].ratioS5 < 0.8) { dist += (0.8 - agg[d].ratioS5) * 200000; allInBand = false; }
    if (agg[d].ratioS5 > 1.3) { dist += (agg[d].ratioS5 - 1.3) * 200000; allInBand = false; }
  }
  return { dist, allInBand };
}

function divergenceScore(agg) {
  // Gennemsnitlig Gini over divisioner (lavere = mindre divergens).
  return (agg[1].gini + agg[2].gini + agg[3].gini) / 3;
}

// #1663 Fase J — renown-deficit-score: hvor langt det MODNE D1+D2-median-net er fra
// break-even (0). Renown trækker stærke hold MOD 0 fra neden (managed deficit), så vi
// måler |median net| for D1+D2 (de tunge løn-divisioner). Lavere = tættere på break-even.
// D3 er nær nul i forvejen → ekskluderet fra deficit-scoren (men dens Gini tæller stadig).
function renownDeficitScore(agg) {
  return Math.abs(agg[1].medNet) + Math.abs(agg[2].medNet);
}

// #1663 Fase J renown-sweep: hold sponsor/ppp/flatten på prod, sweep wResults×maxMultiplier.
// Rangering: (i) mindste modne D1/D2-deficit (tættest på break-even), HÅRD FILTER (ii) Gini
// må ikke stige materielt over wResults=0-baselinen (anti-snowball, spec §7) + ingen seed
// median < den hårde −30k×skala. Fresh-gaten er invariant (renownSponsorFor(null)=base).
function renownMain() {
  const all = [...candidates()];
  console.log(`\n=== #1663 RENOWN-SPONSOR-KALIBRERINGS-SWEEP (Fase J) ===`);
  console.log(`Seeds: ${SEEDS.join(", ")} · ${all.length} kandidater · ${TEAM_COUNT} hold × ${ROSTER_SIZE} ryttere`);
  console.log(`Holdt på PROD: sponsor D1=${SPONSOR_INCOME_BY_DIVISION[1]}/D2=${SPONSOR_INCOME_BY_DIVISION[2]}/D3=${SPONSOR_INCOME_BY_DIVISION[3]} · ppp=${PRIZE_PER_POINT} · prod-curve (flatten 0.5 bagt) · upkeep D1=${UPKEEP_BY_DIVISION[1]}/D2=${UPKEEP_BY_DIVISION[2]}/D3=${UPKEEP_BY_DIVISION[3]}`);
  console.log(`Prod renown (renownEngine.js): W_RESULTS=${W_RESULTS} · MAX_MULTIPLIER=${MAX_MULTIPLIER}`);
  console.log(`Swept: wResults ∈ {${W_RESULTS_GRID.join(", ")}} × maxMultiplier ∈ {${MAX_MULTIPLIER_GRID.join(", ")}}`);
  console.log(`Mål: træk modent D1/D2-median-net mod break-even fra neden UDEN at hæve Gini over wResults=0-baseline (anti-snowball, hård filter).\n`);

  const results = all.map(evaluate);
  for (const r of results) {
    r.deficit = renownDeficitScore(r.agg);
    r.div = divergenceScore(r.agg);
    r.minSeedNet = Math.min(r.agg[1].medNetMin, r.agg[2].medNetMin, r.agg[3].medNetMin);
  }

  // Baseline = wResults=0 (renown slukket = flad sponsor på prod-curve = flatten-0.5-baseline).
  const baseline = results.find((r) => r.overrides.wResults === 0);
  const baseGini = baseline ? baseline.div : Infinity;
  const baseGiniByDiv = baseline ? [1, 2, 3].map((d) => baseline.agg[d].gini) : [Infinity, Infinity, Infinity];
  const GINI_TOL = 0.005; // materiel-stigning-tolerance (afrundings-/seed-støj).

  // Hård filter: ingen division-Gini må stige > tolerance over baseline (anti-snowball).
  for (const r of results) {
    r.giniRise = r.div - baseGini;
    r.maxDivGiniRise = Math.max(...[1, 2, 3].map((d, i) => r.agg[d].gini - baseGiniByDiv[i]));
    r.giniOk = r.maxDivGiniRise <= GINI_TOL;
  }

  // Rangér: Gini-ok først (hård filter), så mindste modne deficit, så mindste Gini.
  const ranked = [...results].sort((a, b) => {
    if (a.giniOk !== b.giniOk) return a.giniOk ? -1 : 1;
    if (Math.abs(a.deficit - b.deficit) > 1) return a.deficit - b.deficit;
    return a.div - b.div;
  });

  if (baseline) {
    console.log("BASELINE (wResults=0, renown SLUKKET = flad sponsor, flatten-0.5-curve):");
    for (const d of [1, 2, 3]) {
      const a = baseline.agg[d];
      console.log(`  D${d}: median-net ${fmt(a.medNet)} · Gini ${a.gini.toFixed(3)} · p10–p90 ${fmt(a.spread)} · S5 ${a.ratioS5.toFixed(2)}×`);
    }
    console.log(`  modent D1+D2-deficit |net|: ${fmt(baseline.deficit)} · gns. Gini ${baseGini.toFixed(3)}\n`);
  }

  const giniOkCount = results.filter((r) => r.giniOk).length;
  console.log(`KANDIDATER DER IKKE HÆVER GINI (≤ +${GINI_TOL} pr. division): ${giniOkCount} af ${results.length}\n`);

  const rows = ranked.slice(0, TOP);
  console.log("RANGEREDE KANDIDATER (Gini-ok → mindst modent deficit → mindst Gini):");
  console.log("─".repeat(120));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const o = r.overrides;
    console.log(
      `#${i + 1}  wResults=${o.wResults} maxMult=${o.maxMultiplier}` +
      `  ${r.giniOk ? "✅ Gini-ok" : `⚠️ Gini +${r.maxDivGiniRise.toFixed(3)}`}` +
      `  modent D1+D2 deficit ${fmt(r.deficit)}  gns.Gini ${r.div.toFixed(3)} (Δ ${r.giniRise >= 0 ? "+" : ""}${r.giniRise.toFixed(3)})`
    );
    for (const d of [1, 2, 3]) {
      const a = r.agg[d];
      console.log(
        `      D${d}: median-net ${fmt(a.medNet)} (seed-spænd ${fmt(a.medNetMin)}..${fmt(a.medNetMax)}) · net p10 ${fmt(a.p10)}/p90 ${fmt(a.p90)} · Gini ${a.gini.toFixed(3)} · spread ${fmt(a.spread)} · S5 ${a.ratioS5.toFixed(2)}×`
      );
    }
    console.log();
  }
  console.log("─".repeat(120));

  if (MARKDOWN) {
    console.log("\n### Renown-sweep (rangeret, markdown)\n");
    console.log("| # | wResults | maxMult | D1 net | D2 net | D3 net | modent D1+D2 |net| | gns. Gini | ΔGini | D1 spread | D2 spread | Gini-ok |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const o = r.overrides;
      console.log(
        `| ${i + 1} | ${o.wResults} | ${o.maxMultiplier} | ${fmt(r.agg[1].medNet)} | ${fmt(r.agg[2].medNet)} | ${fmt(r.agg[3].medNet)} | ` +
        `${fmt(r.deficit)} | ${r.div.toFixed(3)} | ${r.giniRise >= 0 ? "+" : ""}${r.giniRise.toFixed(3)} | ${fmt(r.agg[1].spread)} | ${fmt(r.agg[2].spread)} | ${r.giniOk ? "✅" : "⚠️"} |`
      );
    }
  }

  console.log("\nNOTE: 100% syntetisk, prod-konstanter UÆNDREDE. Fresh-gaten er invariant (renownSponsorFor(null)=base).");
  console.log("      Vælg den Gini-ok-kandidat med mindst modent D1+D2-deficit. wResults=0 = renown slukket (reference).\n");
  return rows;
}

function main() {
  if (RENOWN_MODE) return renownMain();
  const all = [...candidates()];
  console.log(`\n=== #1441/#1607 ECONOMY-CALIBRATION-SWEEP ===`);
  console.log(`Seeds: ${SEEDS.join(", ")} · ${all.length} kandidater · ${TEAM_COUNT} hold × ${ROSTER_SIZE} ryttere`);
  console.log(`Prod-baseline: sponsor D1=${SPONSOR_INCOME_BY_DIVISION[1]}/D2=${SPONSOR_INCOME_BY_DIVISION[2]}/D3=${SPONSOR_INCOME_BY_DIVISION[3]} · prizePerPoint=${PRIZE_PER_POINT} · upkeep D1=${UPKEEP_BY_DIVISION[1]}/D2=${UPKEEP_BY_DIVISION[2]}/D3=${UPKEEP_BY_DIVISION[3]}`);
  console.log(`Net-mål: D1 |median|≤30k · D2 [0,+20k] · D3 [0,+30k] · trajektorie 0,8–1,3× · ingen seed median<−30k\n`);

  const results = all.map(evaluate);
  for (const r of results) {
    const td = targetDistance(r.agg);
    r.dist = td.dist;
    r.allInBand = td.allInBand;
    r.div = divergenceScore(r.agg);
  }

  // Rangér: først dem i bånd (allInBand), så mindste mål-afstand, så mindste divergens.
  results.sort((a, b) => {
    if (a.allInBand !== b.allInBand) return a.allInBand ? -1 : 1;
    if (Math.abs(a.dist - b.dist) > 1) return a.dist - b.dist;
    return a.div - b.div;
  });

  const inBand = results.filter((r) => r.allInBand).length;
  console.log(`KANDIDATER I MÅL-BÅND (alle seeds): ${inBand} af ${results.length}\n`);

  const rows = results.slice(0, TOP);
  console.log("TOP-KANDIDATER (rangeret: i-bånd → mål-afstand → divergens):");
  console.log("─".repeat(120));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const o = r.overrides;
    console.log(
      `#${i + 1}  sponsor[${fmt(o.sponsorBase[1])}/${fmt(o.sponsorBase[2])}/${fmt(o.sponsorBase[3])}] ppp=${o.prizePerPoint} flatten=${o.flatten} bBoost=${o.breadthBoost}` +
      `  ${r.allInBand ? "✅ I-BÅND" : `afstand ${fmt(r.dist)}`}  Gini~${r.div.toFixed(3)}`
    );
    for (const d of [1, 2, 3]) {
      const a = r.agg[d];
      console.log(
        `      D${d}: median-net ${fmt(a.medNet)} (seed-spænd ${fmt(a.medNetMin)}..${fmt(a.medNetMax)}) · net p10 ${fmt(a.p10)}/p90 ${fmt(a.p90)} · Gini ${a.gini.toFixed(3)} · S5 ${a.ratioS5.toFixed(2)}×`
      );
    }
    console.log();
  }
  console.log("─".repeat(120));

  if (!inBand) {
    console.log("\n⚠️  INGEN kandidat ramte ALLE net-mål over alle seeds med sponsor+prize+flatten alene.");
    console.log("    Overvej (a) at udvide sponsor-grid, (b) at justere upkeep (Fase 1-shipped — flag højlydt),");
    console.log("    eller (c) at acceptere bedste mål-afstand (#1 ovenfor) som anbefaling med eksplicit caveat.");
  }

  // Markdown-tabel for rapporten (top 5).
  if (MARKDOWN) {
    console.log("\n### Sweep top-5 (markdown)\n");
    console.log("| # | sponsor D1/D2/D3 | ppp | flatten | bBoost | D1 net | D2 net | D3 net | gns. Gini | i-bånd |");
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const r = rows[i]; const o = r.overrides;
      console.log(
        `| ${i + 1} | ${fmt(o.sponsorBase[1])}/${fmt(o.sponsorBase[2])}/${fmt(o.sponsorBase[3])} | ${o.prizePerPoint} | ${o.flatten} | ${o.breadthBoost} | ` +
        `${fmt(r.agg[1].medNet)} | ${fmt(r.agg[2].medNet)} | ${fmt(r.agg[3].medNet)} | ${r.div.toFixed(3)} | ${r.allInBand ? "✅" : "—"} |`
      );
    }
  }

  console.log("\nNOTE: 100% syntetisk, prod-konstanter UÆNDREDE. Anbefaling = #1; ejer godkender i separat PR.\n");
  return rows;
}

main();
