#!/usr/bin/env node
// Race v3 S2 (#2353) — EKSPLORATIVE prober (orkestrator 12/7): beslutningsdata
// til ejeren for de tre veje ud af S2's Pareto-blokade (audit §3). INGEN
// default-ændringer — alt kører via env-overrides i child-processer.
//
//   --probe=A  Udvidet varians-sweep ("option 1's sande pris"):
//              sd ∈ {0.025, 0.035, 0.045} × p=3% × fw=0.035.
//   --probe=B  Gab-kompression-prototype (option 2, τ-top-kompression):
//              τ ∈ {0.5, 0.65, 0.8} × sd ∈ {0.015, 0.018} × p=3%.
//
// Pr. celle måles: population-harnesset (favWin/maxSeason/podium/ITT/share4+/
// distinkte/K3-counterfactual, --condition=snapshot), sprinter-flat-GRUPPEN i
// den KALIBREREDE genererede linse (population-linsen er strukturelt ~60%,
// jf. S2-audit §1), anti-exploit-oraklet, og (probe B) det målte felt-gab
// #1→#5 på score-terrain (mål ~0.03).
//
// Brug:  node scripts/probeS2Options.mjs --probe=A|B [--seed=2026] [--population=<sti>]

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..");
const SELF = fileURLToPath(import.meta.url);

// ── Child-mode 1: oraklet under forælderens env ───────────────────────────────
if (process.env.RACE_V3_SWEEP_ORACLE === "1") {
  const { simulateTopTeamSeason } = await import("../lib/raceRoleExploitHarness.js");
  console.log(JSON.stringify({ roles: simulateTopTeamSeason("roles"), free: simulateTopTeamSeason("free_role") }));
  process.exit(0);
}

// ── Child-mode 2: felt-gab-måling (#1→#5 på SCORE-terrain, v3 aktiv) ──────────
// Samme felt-konstruktion som S1-audit'ens boost-måling: pulje-felter via
// prod-autopick, 60 løb × 5 GC-terræner. components.terrain er den EFFEKTIVE
// (evt. τ-komprimerede) score-terrain — præcis det gab varianse skal slå.
if (process.env.RACE_V3_PROBE_GAP === "1") {
  const { readFileSync } = await import("node:fs");
  const { simulateStage, stableSeed } = await import("../lib/raceSimulator.js");
  const { DEMAND_VECTORS, finaleFor } = await import("../lib/raceStageProfileGenerator.js");
  const { autopickTeamSelection } = await import("../lib/raceAutopick.js");
  const { makeRng } = await import("../lib/fictionalRiderGenerator.js");

  const pop = JSON.parse(readFileSync(join(BACKEND_DIR, process.env.RACE_V3_PROBE_POPULATION), "utf8"));
  const byId = new Map(pop.riders.map((r) => [r.id, r]));
  const ridersByTeam = new Map();
  for (const r of pop.riders) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push(r);
  }
  const byDivision = new Map();
  for (const t of pop.teams) {
    if (t.league_division_id == null) continue;
    if (!byDivision.has(t.league_division_id)) byDivision.set(t.league_division_id, []);
    byDivision.get(t.league_division_id).push(t);
  }
  const pools = [...byDivision.values()].filter((ts) => ts.length >= 6).map((teams) => ({ teams, tier: teams[0]?.tier ?? null }));

  const gaps = [];
  for (const terrain of ["mountain", "high_mountain", "hilly", "rolling", "classic"]) {
    const demand = DEMAND_VECTORS[terrain];
    const poolRng = makeRng(stableSeed(`dryrun:2026:${terrain}`));
    const finaleRng = makeRng(stableSeed(`dryrun:2026:${terrain}:finale`));
    for (let i = 0; i < 60; i++) {
      const pool = pools[Math.floor(poolRng() * pools.length)];
      const finaleType = finaleFor(finaleRng, terrain);
      const sizeRule = pool.tier === 1 ? { min: 7, max: 7 } : { min: 6, max: 6 };
      const entrants = [];
      for (const team of pool.teams) {
        const roster = ridersByTeam.get(team.id) || [];
        const picks = autopickTeamSelection({
          riders: roster.map((r) => ({ rider_id: r.id, abilities: r.abilities })),
          stages: [{ profile_type: terrain, demand_vector: demand }],
          sizeRule,
        });
        for (const p of picks) {
          entrants.push({ rider_id: p.rider_id, team_id: team.id, abilities: byId.get(p.rider_id).abilities, race_role: p.race_role });
        }
      }
      if (entrants.length < 5) continue;
      const { ranked } = simulateStage({ entrants, stageProfile: { profile_type: terrain, finale_type: finaleType, demand_vector: demand }, seed: stableSeed(`${terrain}:${i}`), v3: true });
      const ts = ranked.map((r) => r.components.terrain).sort((a, b) => b - a);
      gaps.push(ts[0] - ts[4]);
    }
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log(JSON.stringify({ n: gaps.length, gapP50: q(0.5), gapP90: q(0.9) }));
  process.exit(0);
}

// ── Forælder ──────────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const PROBE = String(arg("probe", "")).toUpperCase();
const SEED = arg("seed", "2026");
const POPULATION = arg("population", "scripts/baselines/population-snapshot-2026-07-11.json");
if (PROBE !== "A" && PROBE !== "B") {
  console.error("❌ --probe=A eller --probe=B kræves.");
  process.exit(1);
}

function spawnJson(env, extraEnv) {
  const res = spawnSync(process.execPath, [SELF], {
    cwd: BACKEND_DIR, env: { ...env, ...extraEnv },
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`child fejlede: ${res.stderr}`);
  return JSON.parse(res.stdout.trim().split("\n").pop());
}

function runPopHarness(env) {
  const res = spawnSync(process.execPath, [
    join(BACKEND_DIR, "scripts", "simulateSeasonDryRun.js"),
    `--population=${POPULATION}`, "--no-html", `--seed=${SEED}`, "--roles", "--v3", "--condition=snapshot",
  ], { cwd: BACKEND_DIR, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`pop-harness fejlede (exit ${res.status}): ${res.stderr?.slice(0, 2000)}`);
  const out = res.stdout;
  const num = (re, label) => {
    const m = out.match(re);
    if (!m) throw new Error(`kunne ikke parse '${label}'`);
    return parseFloat(m[1]);
  };
  return {
    favWin: num(/favoriteWinRate\s+([\d.]+)%/, "favWin"),
    maxSeason: num(/maxSeasonWinRate\s+([\d.]+)%/, "maxSeason"),
    podium: num(/favoritePodiumRate\s+([\d.]+)%/, "podium"),
    itt: num(/ittFavoriteWinRate\s+([\d.]+)%/, "itt"),
    share4Plus: num(/share4PlusSameTeamTop10\s+([\d.]+)%/, "share4Plus"),
    distinct: num(/avgDistinctTeamsTop10\s+([\d.]+)/, "distinct"),
    cfTabMedian: num(/helperLossTop15MedianGc\s+(-?[\d.]+)/, "cfTab"),
    jourSansRate: num(/Jour-sans-rate: ([\d.]+)%/, "jsRate"),
  };
}

function runGenHarness(env) {
  const res = spawnSync(process.execPath, [
    join(BACKEND_DIR, "scripts", "simulateSeasonDryRun.js"),
    "--no-html", `--seed=${SEED}`, "--roles", "--v3",
  ], { cwd: BACKEND_DIR, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`gen-harness fejlede (exit ${res.status}): ${res.stderr?.slice(0, 2000)}`);
  const m = res.stdout.match(/flat\s+sprinter ≥90%\s+(\d+)%/);
  if (!m) throw new Error("kunne ikke parse sprinter-flat fra genereret harness");
  return { sprinterFlat: parseFloat(m[1]) };
}

const cells = [];
if (PROBE === "A") {
  for (const sd of [0.025, 0.035, 0.045]) cells.push({ sd, p: 0.03, fw: 0.035, tau: 1.0 });
} else {
  for (const tau of [0.5, 0.65, 0.8]) for (const sd of [0.015, 0.018]) cells.push({ sd, p: 0.03, fw: 0.035, tau });
}

console.log(`\n🔬 PROBE ${PROBE} (EKSPLORATIV — ingen default-ændringer) — seed=${SEED}`);
const results = [];
for (const c of cells) {
  const env = {
    ...process.env,
    RACE_V3_DAYFORM_SD: String(c.sd),
    RACE_V3_JOUR_SANS_P: String(c.p),
    RACE_V3_FORM_WEIGHT: String(c.fw),
    RACE_V3_TOP_COMPRESSION_TAU: String(c.tau),
  };
  const oracle = spawnJson(env, { RACE_V3_SWEEP_ORACLE: "1" });
  const pop = runPopHarness(env);
  const gen = runGenHarness(env);
  const gap = PROBE === "B" ? spawnJson(env, { RACE_V3_PROBE_GAP: "1", RACE_V3_PROBE_POPULATION: POPULATION }) : null;
  const marginPct = (oracle.roles.points / oracle.free.points - 1) * 100;
  results.push({ ...c, oracle, marginPct, pop, gen, gap });
  console.log(
    `   ${PROBE === "B" ? `τ=${String(c.tau).padEnd(4)} ` : ""}sd=${String(c.sd).padEnd(5)}`
    + `${gap ? ` | gab#1→#5 p50=${gap.gapP50.toFixed(3)}` : ""}`
    + ` | favWin ${pop.favWin}% maxS ${pop.maxSeason}% pod ${pop.podium}% itt ${pop.itt}%`
    + ` | sprintFlat ${gen.sprinterFlat}% | oracle ${marginPct >= 0 ? "+" : ""}${marginPct.toFixed(1)}%/${oracle.roles.wins}v${oracle.free.wins}`
    + ` | 4+ ${pop.share4Plus}% dist ${pop.distinct} | cfTab ${pop.cfTabMedian} js ${pop.jourSansRate}%`
  );
}
console.log(`\nJSON:\n${JSON.stringify(results, null, 1)}`);
