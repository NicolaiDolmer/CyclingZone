#!/usr/bin/env node
// Race v3 S2 (#2353) — grid-sweep: DAYFORM_SD × JOUR_SANS_P × FORM_WEIGHT.
//
// Samme mønster som sweepS1WorkCost.mjs: hver celle kører i CHILD-processer
// med env-overrides (RACE_V3_DAYFORM_SD / RACE_V3_JOUR_SANS_P /
// RACE_V3_FORM_WEIGHT, læses i lib/raceRoles.js ved module-load). Pr. celle:
//   1. Anti-exploit-oraklet (S1-gaten SKAL forblive grøn under S2-varians).
//   2. Population-harnesset --roles --v3 --condition=snapshot (form live, så
//      form-vægt + jour-sans-form-koblingen faktisk måles).
//
// Gates (spec §12, orkestrator 12/7):
//   1. favoriteWinRate 25-40% (måldriveren)   2. maxSeasonWinRate ≤45%
//   3. favoritePodiumRate 55-75%              5. ittFavoriteWinRate 45-65%
//   6. S1: share4Plus ≤5% · distinkte ≥7.5 · oracle grøn
//   4. TYPE-INTEGRITET (sprinter ≥90% flat): kan IKKE evalueres i population-
//      mode — flat-sprinter er strukturelt ~57-61% dér UANSET v3/condition
//      (S0-fund: udbruds-eksplosion på flat i pulje-felter; ≥90%-båndet er
//      kalibreret mod den GENEREREDE population). sprinterFlat rapporteres pr.
//      celle som reference; den ÆGTE gate køres separat på kandidat-cellerne
//      i genereret mode (--roles --v3 uden --population), jf. audit-doc.
// Ingen celle når 1-3 samtidig → rapportér Pareto-front og STOP (ingen hacks).
//
// Brug:  node scripts/sweepS2DayForm.mjs [--seed=2026] [--population=<sti>]

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..");

// ── Child-mode: oraklet under forælderens env-overrides ──────────────────────
if (process.env.RACE_V3_SWEEP_ORACLE === "1") {
  const { simulateTopTeamSeason } = await import("../lib/raceRoleExploitHarness.js");
  console.log(JSON.stringify({ roles: simulateTopTeamSeason("roles"), free: simulateTopTeamSeason("free_role") }));
  process.exit(0);
}

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const SEED = arg("seed", "2026");
const POPULATION = arg("population", "scripts/baselines/population-snapshot-2026-07-11.json");

const GRID_SD = [0.012, 0.015, 0.018];
const GRID_P = [0.02, 0.03, 0.05];
const GRID_FW = [0.025, 0.035, 0.045];

const SELF = fileURLToPath(import.meta.url);

function cellEnv(sd, p, fw) {
  return {
    ...process.env,
    RACE_V3_DAYFORM_SD: String(sd),
    RACE_V3_JOUR_SANS_P: String(p),
    RACE_V3_FORM_WEIGHT: String(fw),
  };
}

function runOracle(env) {
  const res = spawnSync(process.execPath, [SELF], {
    cwd: BACKEND_DIR, env: { ...env, RACE_V3_SWEEP_ORACLE: "1" },
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`oracle-child fejlede: ${res.stderr}`);
  return JSON.parse(res.stdout.trim().split("\n").pop());
}

function runHarness(env) {
  const res = spawnSync(process.execPath, [
    join(BACKEND_DIR, "scripts", "simulateSeasonDryRun.js"),
    `--population=${POPULATION}`, "--no-html", `--seed=${SEED}`, "--roles", "--v3", "--condition=snapshot",
  ], { cwd: BACKEND_DIR, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
    favoritePodiumRate: num(/favoritePodiumRate\s+([\d.]+)%/, "favoritePodiumRate"),
    ittFavoriteWinRate: num(/ittFavoriteWinRate\s+([\d.]+)%/, "ittFavoriteWinRate"),
    share4Plus: num(/share4PlusSameTeamTop10\s+([\d.]+)%/, "share4Plus"),
    distinctTeams: num(/avgDistinctTeamsTop10\s+([\d.]+)/, "distinctTeams"),
    sprinterFlat: num(/flat\s+sprinter ≥90%\s+(\d+)%/, "sprinterFlat"),
    jourSansRate: num(/Jour-sans-rate: ([\d.]+)%/, "jourSansRate"),
    helperLossTop15Median: num(/helperLossTop15MedianGc\s+(-?[\d.]+)/, "helperLossTop15MedianGc"),
  };
}

console.log(`\n🧪 S2 GRID-SWEEP — seed=${SEED} population=${POPULATION} (roles+v3+condition=snapshot)`);
console.log(`   grid: DAYFORM_SD ∈ {${GRID_SD.join(", ")}} × JOUR_SANS_P ∈ {${GRID_P.join(", ")}} × FORM_WEIGHT ∈ {${GRID_FW.join(", ")}}\n`);

const results = [];
for (const sd of GRID_SD) {
  for (const p of GRID_P) {
    for (const fw of GRID_FW) {
      const env = cellEnv(sd, p, fw);
      const oracle = runOracle(env);
      const h = runHarness(env);
      const pointMarginPct = (oracle.roles.points / oracle.free.points - 1) * 100;
      const gates = {
        favWin: h.favoriteWinRate >= 25 && h.favoriteWinRate <= 40,
        maxSeason: h.maxSeasonWinRate <= 45,
        podium: h.favoritePodiumRate >= 55 && h.favoritePodiumRate <= 75,
        itt: h.ittFavoriteWinRate >= 45 && h.ittFavoriteWinRate <= 65,
        s1: h.share4Plus <= 5 && h.distinctTeams >= 7.5
          && oracle.roles.points >= oracle.free.points * 1.01 && oracle.roles.wins >= oracle.free.wins,
      };
      results.push({ sd, p, fw, oracle, pointMarginPct, h, gates });
      const g = (b) => (b ? "✓" : "✗");
      console.log(
        `   sd=${String(sd).padEnd(5)} p=${String(p).padEnd(4)} fw=${String(fw).padEnd(5)}`
        + ` | favWin ${h.favoriteWinRate}% ${g(gates.favWin)} maxS ${h.maxSeasonWinRate}% ${g(gates.maxSeason)} pod ${h.favoritePodiumRate}% ${g(gates.podium)}`
        + ` | sprintFlat ${h.sprinterFlat}% (ref) itt ${h.ittFavoriteWinRate}% ${g(gates.itt)}`
        + ` | S1: 4+ ${h.share4Plus}% dist ${h.distinctTeams} oracle ${pointMarginPct >= 0 ? "+" : ""}${pointMarginPct.toFixed(1)}%/${oracle.roles.wins}v${oracle.free.wins} ${g(gates.s1)}`
        + ` | js-rate ${h.jourSansRate}% cfTab ${h.helperLossTop15Median}`
      );
    }
  }
}

const fullPass = results.filter((r) => Object.values(r.gates).every(Boolean));
const core123 = results.filter((r) => r.gates.favWin && r.gates.maxSeason && r.gates.podium);
console.log(`\n   Fuldt bestående celler: ${fullPass.length}/${results.length} · celler m. bånd 1-3 samtidig: ${core123.length}/${results.length}`);
if (fullPass.length) {
  const winner = [...fullPass].sort((a, b) => Math.abs(a.h.favoriteWinRate - 32.5) - Math.abs(b.h.favoriteWinRate - 32.5))[0];
  console.log(`   🏆 VINDER: sd=${winner.sd} p=${winner.p} fw=${winner.fw}`);
} else {
  // Pareto-front på (favWin-afstand-til-bånd ↓, maxSeason ↓, podium-afstand ↓) — rapporteres, ingen auto-beslutning.
  console.log(`   ⚠ Ingen celle består alle gates — Pareto-front rapporteres (orkestrator beslutter).`);
}
console.log(`\nJSON:\n${JSON.stringify(results, null, 1)}`);
