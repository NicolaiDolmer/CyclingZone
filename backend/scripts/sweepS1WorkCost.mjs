#!/usr/bin/env node
// Race v3 S1 (#2352) — JOINT grid-sweep: WORK_COST_HELPER_GC × TEAM_RACE_WEIGHT_V3.
//
// Spec §6: work-cost og kaptajn-boost kalibreres SAMMEN. Denne sweep kører
// hver grid-celle i CHILD-processer med env-overrides (RACE_V3_*-envs læses i
// lib/raceRoles.js ved module-load; prod sætter dem aldrig) — pr. celle:
//   1. Anti-exploit-oraklet (lib/raceRoleExploitHarness.js): sæsonpoint+sejre
//      for tophold under roles vs. all-free_role.
//   2. Population-harnesset (simulateSeasonDryRun.js --roles --v3) mod prod-
//      snapshottet: sektion F-metrikker parses fra stdout.
// WORK_COST_HELPER_FLAT skaleres proportionalt (8/9 af GC-costen — spec-
// kandidaternes forhold −0.04/−0.045).
//
// Vinder-kriterier (orkestrator 12/7, prioriteret):
//   1. Oracle: point-margin ≥ +1% OG sejre ≥ (parity ok).
//   2. share4Plus ≤ 5% og distinkte hold ≥ 7.5.
//   3. Counterfactual hjælper-tab-median (top-terrain-linsen) i [10, 30].
//   4. Blandt 1-3-opfyldende celler: LAVEST favorit-win-rate (mindst forværring
//      vs. S0 → mest varians-budget tilbage til S2).
//
// Brug:  node scripts/sweepS1WorkCost.mjs [--seed=2026] [--population=<sti>]
// Intern: kaldes med RACE_V3_SWEEP_ORACLE=1 kører den KUN oracle-cellen og
// printer JSON (child-mode — så env-overrides kan variere pr. celle).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..");

// ── Child-mode: kør oraklet under de env-overrides forælderen satte ──────────
if (process.env.RACE_V3_SWEEP_ORACLE === "1") {
  const { simulateTopTeamSeason } = await import("../lib/raceRoleExploitHarness.js");
  const roles = simulateTopTeamSeason("roles");
  const free = simulateTopTeamSeason("free_role");
  console.log(JSON.stringify({ roles, free }));
  process.exit(0);
}

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const SEED = arg("seed", "2026");
const POPULATION = arg("population", "scripts/baselines/population-snapshot-2026-07-11.json");

const GRID_WORK_COST = [-0.030, -0.0375, -0.045];
const GRID_TEAM_WEIGHT = [0.06, 0.08, 0.10, 0.12];
const FLAT_RATIO = 8 / 9; // WORK_COST_HELPER_FLAT = GC-cost × 8/9 (spec-kandidat-forhold)

const SELF = fileURLToPath(import.meta.url);

function cellEnv(gc, w) {
  return {
    ...process.env,
    RACE_V3_WORK_COST_HELPER_GC: String(gc),
    RACE_V3_WORK_COST_HELPER_FLAT: String(gc * FLAT_RATIO),
    RACE_V3_TEAM_RACE_WEIGHT: String(w),
  };
}

function runOracle(env) {
  const res = spawnSync(process.execPath, [SELF], {
    cwd: BACKEND_DIR,
    env: { ...env, RACE_V3_SWEEP_ORACLE: "1" },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`oracle-child fejlede: ${res.stderr}`);
  return JSON.parse(res.stdout.trim().split("\n").pop());
}

function runHarness(env) {
  const res = spawnSync(process.execPath, [
    join(BACKEND_DIR, "scripts", "simulateSeasonDryRun.js"),
    `--population=${POPULATION}`, "--no-html", `--seed=${SEED}`, "--roles", "--v3",
  ], { cwd: BACKEND_DIR, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // NB: harnesset kan exite 1 pga. --enforce-* i andre kontekster; her kører vi
  // uden enforce-flag, så non-zero = ægte fejl.
  if (res.status !== 0) throw new Error(`harness-child fejlede (exit ${res.status}): ${res.stderr?.slice(0, 2000)}`);
  const out = res.stdout;
  const num = (re, label) => {
    const m = out.match(re);
    if (!m) throw new Error(`kunne ikke parse '${label}' fra harness-output`);
    return parseFloat(m[1]);
  };
  return {
    favoriteWinRate: num(/favoriteWinRate\s+([\d.]+)%/, "favoriteWinRate"),
    maxSeasonWinRate: num(/maxSeasonWinRate\s+([\d.]+)%/, "maxSeasonWinRate"),
    share4Plus: num(/share4PlusSameTeamTop10\s+([\d.]+)%/, "share4Plus"),
    distinctTeams: num(/avgDistinctTeamsTop10\s+([\d.]+)/, "distinctTeams"),
    helperLossTop15Median: num(/helperLossTop15MedianGc\s+(-?[\d.]+)/, "helperLossTop15MedianGc"),
    helperLossP25: num(/helperLossTop15 \(counterfactual, n=\d+\): p25=(-?[\d.]+)/, "p25"),
    helperLossP75: num(/p75=(-?[\d.]+)/, "p75"),
  };
}

console.log(`\n🧪 S1 JOINT GRID-SWEEP — seed=${SEED} population=${POPULATION}`);
console.log(`   grid: WORK_COST_HELPER_GC ∈ {${GRID_WORK_COST.join(", ")}} × TEAM_RACE_WEIGHT_V3 ∈ {${GRID_TEAM_WEIGHT.join(", ")}} (flat = GC×8/9)\n`);

const results = [];
for (const gc of GRID_WORK_COST) {
  for (const w of GRID_TEAM_WEIGHT) {
    const env = cellEnv(gc, w);
    const oracle = runOracle(env);
    const harness = runHarness(env);
    const pointMarginPct = (oracle.roles.points / oracle.free.points - 1) * 100;
    const oracleOk = oracle.roles.points >= oracle.free.points * 1.01 && oracle.roles.wins >= oracle.free.wins;
    const teamOk = harness.share4Plus <= 5.0 && harness.distinctTeams >= 7.5;
    const helperOk = harness.helperLossTop15Median >= 10 && harness.helperLossTop15Median <= 30;
    results.push({ gc, w, oracle, pointMarginPct, harness, oracleOk, teamOk, helperOk });
    console.log(
      `   gc=${String(gc).padEnd(7)} w=${String(w).padEnd(5)} | oracle ${oracle.roles.points}p/${oracle.roles.wins}w vs ${oracle.free.points}p/${oracle.free.wins}w (${pointMarginPct >= 0 ? "+" : ""}${pointMarginPct.toFixed(1)}%) ${oracleOk ? "✓" : "✗"}`
      + ` | share4+ ${harness.share4Plus}% dist ${harness.distinctTeams} ${teamOk ? "✓" : "✗"}`
      + ` | cfHelperTab p25/med/p75 ${harness.helperLossP25}/${harness.helperLossTop15Median}/${harness.helperLossP75} ${helperOk ? "✓" : "✗"}`
      + ` | favWin ${harness.favoriteWinRate}% maxSeason ${harness.maxSeasonWinRate}%`
    );
  }
}

const qualifying = results.filter((r) => r.oracleOk && r.teamOk && r.helperOk);
console.log(`\n   ${qualifying.length}/${results.length} celler opfylder kriterie 1-3.`);
if (qualifying.length) {
  const winner = [...qualifying].sort((a, b) => a.harness.favoriteWinRate - b.harness.favoriteWinRate)[0];
  console.log(`   🏆 VINDER (lavest favoriteWinRate blandt kvalificerede): gc=${winner.gc} w=${winner.w} favWin=${winner.harness.favoriteWinRate}%`);
} else {
  console.log(`   ⚠ Ingen celle opfylder alle kriterier — se tabellen og vælg bedste kompromis manuelt.`);
}
console.log(`\nJSON:\n${JSON.stringify(results, null, 1)}`);
