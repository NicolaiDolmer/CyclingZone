#!/usr/bin/env node
// backend/scripts/raceCompetitionScorecard.js
// Sub-2 (#2770) Task 8 — konkurrence-balance-scorecard + kalibrerings-gate.
//
// DB-fri harness: simulerer HELE Grand Tours med ægte rute-data (generateRaceStageProfiles,
// terrain_archetype="grand_tour") gennem den ægte passage-lag-motor (racePassages.js via
// raceRunner.buildRaceResults) og måler om grønt/KOM/bonus-konkurrencerne producerer
// realistiske udfald (spec §8). 100% in-memory — rører INTET i DB/prod.
//
//   node scripts/raceCompetitionScorecard.js [--seeds=2026,7,42] [--gts=12] [--count=800]
//        [--field=140] [--enforce]
//
// v3=false bevidst (samme "flag-off skal være bit-identisk"-disciplin som resten af
// race-motor-harnessene): passage-laget er data-gated (rutefelter), IKKE v3-gated, så
// v3=false giver et simplere, DNF-frit felt (ingen incidents/abandons — se
// raceSimulator.js: incidents kun v3=true) og et rent signal for konkurrence-balancen.
//
// Rolle-tildeling: PRODUKTIONS-autopick (raceAutopick.autopickTeamSelection) pr. hold
// (snake-draftet på overall, holdstørrelse 8) — giver de ÆGTE roller
// (captain/sprint_captain/helper), IKKE simulateSeasonDryRun's syntetiske hunter-rolle.
// sprint_captain er det der driver SPRINT_CAPTAIN_CONTEST_MULTIPLIER i racePassages.js.
//
// ── KALIBRERINGS-LOG (2026-07-22, #2770 Task 8) ──────────────────────────────────────
// RUN 1 (default-konstanter, UÆNDREDE: SPRINT_CAPTAIN_CONTEST_MULTIPLIER=1.15,
//   WAYPOINT_NOISE_SD=0.03, CATCH_KM_RANGE=[0.55,0.92]) — 12 GT × 3 seeds (2026/7/42),
//   36 løb i alt. Alle 5 bånd GRØNNE på første kørsel — INGEN konstant justeret.
//   Pr. seed (grøn n=antal grøn-egnede GTs af 12 m. ≥8 flad/rolling-etaper):
//     seed 2026: grøn 100.0% (n=10) · kom-udbrud 29.9% · kom-vinder 100.0% (n=12) ·
//       gc-flip 8.3% (1/12) · margin-Δ median 42.0s
//     seed 7:    grøn 100.0% (n=7)  · kom-udbrud 30.2% · kom-vinder 100.0% (n=12) ·
//       gc-flip 0.0% (0/12) · margin-Δ median 21.5s
//     seed 42:   grøn 100.0% (n=10) · kom-udbrud 34.0% · kom-vinder 100.0% (n=12) ·
//       gc-flip 16.7% (2/12) · margin-Δ median 30.0s
//   AGGREGAT (36 løb): greenWinnerSprinterShare 100.0% (≥60) · komBreakawayPointShare
//     31.3% (25-60) · komWinnerClimberShare 100.0% (≥70) · bonusGcFlipShare 8.3% (≤15) ·
//     bonusTop3MarginMedianDelta 29.0s (≤45).
//   FUND: grøn/KOM-vinder-andelene (100%) er høje men KONSISTENTE med motorens egne
//   etablerede struktur-oracles (simulateSeasonDryRun.js: flad sprinter-vinderrate
//   93-97%, mountain gc+climber+baroudeur 91-99%) akkumuleret over 21 etaper — en
//   points/mountain-KLASSEMENT-vinder over en hel GT er en endnu skarpere selektion end
//   én etape, så 100% på et beskedent sample (27/36 GTs) er forventeligt, ikke et
//   kalibrerings-problem. GC-flip + margin-delta varierer meningsfuldt på tværs af
//   seeds (0-16.7% · 21.5-42.0s) — bevis for at bonus-sekunderne rent faktisk PÅVIRKER
//   GC uden at DOMINERE det (spec §8's hensigt med bonus-båndene).
//   race:gate (uændret motor) grøn efter denne kørsel — se close-out-commit.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, makeRng } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { riderOverall } from "../lib/riderValuation.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { stableSeed } from "../lib/raceSimulator.js";
import { autopickTeamSelection } from "../lib/raceAutopick.js";
import { buildRaceResults } from "../lib/raceRunner.js";
import { accumulateStageRows, rankByCumTimeAsc, filterCompletedEntrants } from "../lib/raceClassifications.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── args ──────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const SEEDS = String(arg("seeds", "2026,7,42")).split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const GTS = parseInt(arg("gts", "12"), 10);
const COUNT = parseInt(arg("count", "800"), 10);
const FIELD = parseInt(arg("field", "140"), 10);
const ENFORCE = has("enforce");
const REFERENCE_YEAR = 2026;
const TEAM_SIZE = 8;

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

// ── Gate-bånd (spec §8, ejer-godkendte, 22/7) ─────────────────────────────────
const BANDS = {
  greenWinnerSprinterShare:   { min: 0.60, max: 1.001, label: "grøn-vinder = sprinter (GTs m. ≥8 flad/rolling-etaper)" },
  komBreakawayPointShare:     { min: 0.25, max: 0.60,  label: "KOM-point til udbrud (ikke-summit bjerg/high_mountain)" },
  komWinnerClimberShare:      { min: 0.70, max: 1.001, label: "bjerg-vinder = climber/gc" },
  bonusGcFlipShare:           { min: -0.001, max: 0.15, label: "GC-vinder flipper med/uden bonussekunder" },
  bonusTop3MarginMedianDelta: { min: -0.001, max: 45,   label: "median Δ vinder→3.-margin (sek), med/uden bonus" },
};

// ── hjælpere ──────────────────────────────────────────────────────────────────
function pct(n, d) { return d > 0 ? n / d : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function within(metric, value) {
  const b = BANDS[metric];
  return value >= b.min && value <= b.max;
}
// Delvis Fisher-Yates (samme mønster som simulateSeasonDryRun.js sampleField).
function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}

// ── population + felt ─────────────────────────────────────────────────────────
// Genbrugt kæde fra simulateSeasonDryRun.js: generateFictionalRiders → deriveAbilities
// → computeRiderTypes (arketype-klassifikation, primary.key ∈ sprinter/tt/climber/
// puncheur/brostensrytter/baroudeur/rouleur/gc).
function buildPopulation(seed) {
  const { riders: raw } = generateFictionalRiders({ count: COUNT, seed, referenceYear: REFERENCE_YEAR });
  return raw.map((r, i) => {
    const id = `r${i}`;
    const abilities = deriveAbilities(r._meta?.physiology ?? {}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
    const archetype = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
    return { id, name: `${r.firstname} ${r.lastname}`, is_u25: !!r.is_u25, abilities, overall: riderOverall(abilities), archetype };
  });
}

// ── én Grand Tour: rute + felt + motor + metrikker ────────────────────────────
function runGT(seed, gtIndex, population, byId) {
  const race = {
    id: `gt-${seed}-${gtIndex}`, name: `Scorecard Tour ${gtIndex}`,
    race_type: "stage_race", stages: 21, terrain_archetype: "grand_tour", season_id: seed,
  };
  const stages = generateRaceStageProfiles(race);
  const finalStageNumber = stages.length;

  // Felt: ~FIELD ryttere trukket fra populationen (dedikeret rng pr. GT — kan
  // overlappe mellem GTs, hvert kald til buildRaceResults er uafhængigt/isoleret).
  const gtRng = makeRng(stableSeed(`scorecard:${seed}:gt:${gtIndex}`));
  const gtRiders = sampleField(gtRng, population, FIELD).sort((a, b) => b.overall - a.overall);

  // Snake-draft ind i hold af 8 (samme mønster som simulateSeasonDryRun's GT-blok),
  // derefter PRODUKTIONS-autopick pr. hold for ÆGTE captain/sprint_captain/helper-roller.
  const nTeams = Math.ceil(gtRiders.length / TEAM_SIZE);
  const teams = new Map();
  gtRiders.forEach((r, i) => {
    const round = Math.floor(i / nTeams), pos = i % nTeams;
    const teamIdx = round % 2 === 0 ? pos : nTeams - 1 - pos;
    if (!teams.has(teamIdx)) teams.set(teamIdx, []);
    teams.get(teamIdx).push(r);
  });

  const entrants = [];
  for (const [teamIdx, roster] of teams) {
    const picks = autopickTeamSelection({
      riders: roster.map((r) => ({ rider_id: r.id, abilities: r.abilities })),
      stages, sizeRule: { min: roster.length, max: roster.length },
    });
    const roleByRider = new Map(picks.map((p) => [p.rider_id, p.race_role]));
    for (const r of roster) {
      entrants.push({
        rider_id: r.id, team_id: `t${teamIdx}`, rider_name: r.name, is_u25: r.is_u25,
        abilities: r.abilities, race_role: roleByRider.get(r.id),
      });
    }
  }

  const { resultRows } = buildRaceResults({ race, stages, entrants, pointsLookup: {}, v3: false });

  // 1. Grøn-vinder = sprinter? (kun GTs m. ≥8 flad/rolling-etaper i denne rute)
  const flatRollingCount = stages.filter((s) => s.profile_type === "flat" || s.profile_type === "rolling").length;
  const pointsWinnerRow = resultRows.find((r) => r.result_type === "points" && r.rank === 1 && r.stage_number === finalStageNumber);
  const pointsWinnerArchetype = pointsWinnerRow ? byId.get(pointsWinnerRow.rider_id)?.archetype ?? null : null;

  // 3. Bjerg-vinder = climber/gc?
  const mountainWinnerRow = resultRows.find((r) => r.result_type === "mountain" && r.rank === 1 && r.stage_number === finalStageNumber);
  const mountainWinnerArchetype = mountainWinnerRow ? byId.get(mountainWinnerRow.rider_id)?.archetype ?? null : null;

  // 2. KOM-point på ikke-summit-finish bjerg/high_mountain-etaper: udbrud vs. felt.
  let komBreakawayPoints = 0, komTotalPoints = 0;
  for (const s of stages) {
    if (s.profile_type !== "mountain" && s.profile_type !== "high_mountain") continue;
    if ((s.climbs || []).some((c) => c.summit_finish)) continue; // summit-finish udelukket (spec §8.2)
    for (const row of resultRows) {
      if (row.result_type !== "stage" || row.stage_number !== s.stage_number) continue;
      const kp = Number(row.kom_points) || 0;
      if (!kp) continue;
      komTotalPoints += kp;
      if (row.in_breakaway) komBreakawayPoints += kp;
    }
  }

  // 4+5. GC-vinder + top-3-margin med/uden bonussekunder — genberegnet fra de
  // PERSISTEREDE etape-rækker (raceClassifications.accumulateStageRows +
  // rankByCumTimeAsc), IKKE motorens egen in-memory GC (uafhængig verifikation).
  const stageRows = resultRows.filter((r) => r.result_type === "stage");
  const profileTypeByStage = new Map(stages.map((s) => [s.stage_number, s.profile_type]));
  function gcVariant(withBonus) {
    const rows = withBonus ? stageRows : stageRows.map((r) => ({ ...r, bonus_seconds: 0 }));
    const acc = accumulateStageRows({ stageRows: rows, profileTypeByStage });
    const classified = filterCompletedEntrants(entrants, acc.stagesByRider, acc.stageNumbers);
    return rankByCumTimeAsc(classified, acc.cumTime, acc.posSum);
  }
  const withBonusGc = gcVariant(true);
  const noBonusGc = gcVariant(false);
  const gcFlip = (withBonusGc[0]?.rider_id ?? null) !== (noBonusGc[0]?.rider_id ?? null);
  const marginWith = withBonusGc[2] && withBonusGc[0] ? withBonusGc[2].time - withBonusGc[0].time : null;
  const marginNo = noBonusGc[2] && noBonusGc[0] ? noBonusGc[2].time - noBonusGc[0].time : null;
  const marginDelta = marginWith != null && marginNo != null ? Math.abs(marginWith - marginNo) : null;

  return { flatRollingCount, pointsWinnerArchetype, mountainWinnerArchetype, komBreakawayPoints, komTotalPoints, gcFlip, marginDelta };
}

// ── kør + aggregér ─────────────────────────────────────────────────────────────
console.log(`\n🏆 KONKURRENCE-BALANCE-SCORECARD (#2770 Task 8) — seeds=${SEEDS.join(",")} · gts=${GTS} · felt=${FIELD} · population=${COUNT} (in-memory, rører ikke prod)\n`);

const perSeed = [];
const pooled = {
  greenEligible: 0, greenSprinterWins: 0,
  komWinnerClimberOk: 0, gtTotal: 0,
  komBreakawayPoints: 0, komTotalPoints: 0,
  gcFlips: 0, marginDeltas: [],
};

for (const seed of SEEDS) {
  const t0 = Date.now();
  const population = buildPopulation(seed);
  const byId = new Map(population.map((r) => [r.id, r]));

  const s = { greenEligible: 0, greenSprinterWins: 0, komWinnerClimberOk: 0, komBreakawayPoints: 0, komTotalPoints: 0, gcFlips: 0, marginDeltas: [], gts: 0 };
  for (let i = 0; i < GTS; i++) {
    const m = runGT(seed, i, population, byId);
    s.gts++;
    if (m.flatRollingCount >= 8) {
      s.greenEligible++;
      if (m.pointsWinnerArchetype === "sprinter") s.greenSprinterWins++;
    }
    if (m.mountainWinnerArchetype === "climber" || m.mountainWinnerArchetype === "gc") s.komWinnerClimberOk++;
    s.komBreakawayPoints += m.komBreakawayPoints;
    s.komTotalPoints += m.komTotalPoints;
    if (m.gcFlip) s.gcFlips++;
    if (m.marginDelta != null) s.marginDeltas.push(m.marginDelta);
  }

  const row = {
    seed,
    greenWinnerSprinterShare: pct(s.greenSprinterWins, s.greenEligible),
    greenEligible: s.greenEligible,
    komBreakawayPointShare: pct(s.komBreakawayPoints, s.komTotalPoints),
    komWinnerClimberShare: pct(s.komWinnerClimberOk, s.gts),
    bonusGcFlipShare: pct(s.gcFlips, s.gts),
    bonusTop3MarginMedianDelta: median(s.marginDeltas),
  };
  perSeed.push(row);

  pooled.greenEligible += s.greenEligible;
  pooled.greenSprinterWins += s.greenSprinterWins;
  pooled.komWinnerClimberOk += s.komWinnerClimberOk;
  pooled.gtTotal += s.gts;
  pooled.komBreakawayPoints += s.komBreakawayPoints;
  pooled.komTotalPoints += s.komTotalPoints;
  pooled.gcFlips += s.gcFlips;
  pooled.marginDeltas.push(...s.marginDeltas);

  console.log(`  seed ${seed}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${s.gts} GT · ${s.greenEligible} grøn-egnede · ${s.marginDeltas.length} GC-margin-datapunkter)`);
}

const aggregate = {
  greenWinnerSprinterShare: pct(pooled.greenSprinterWins, pooled.greenEligible),
  komBreakawayPointShare: pct(pooled.komBreakawayPoints, pooled.komTotalPoints),
  komWinnerClimberShare: pct(pooled.komWinnerClimberOk, pooled.gtTotal),
  bonusGcFlipShare: pct(pooled.gcFlips, pooled.gtTotal),
  bonusTop3MarginMedianDelta: median(pooled.marginDeltas),
};

const pctS = (v) => `${(v * 100).toFixed(1)}%`;
const padE = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);

console.log(`\n${"─".repeat(96)}`);
console.log("PR. SEED\n");
for (const row of perSeed) {
  console.log(`  seed ${padE(row.seed, 6)} grøn=${padS(pctS(row.greenWinnerSprinterShare), 7)} (n=${row.greenEligible})   kom-udbrud=${padS(pctS(row.komBreakawayPointShare), 7)}   kom-vinder=${padS(pctS(row.komWinnerClimberShare), 7)}   gc-flip=${padS(pctS(row.bonusGcFlipShare), 7)}   margin-Δ=${padS(row.bonusTop3MarginMedianDelta.toFixed(1), 6)}s`);
}

console.log(`\n${"─".repeat(96)}`);
console.log(`AGGREGAT (${SEEDS.length} seeds × ${GTS} GT = ${pooled.gtTotal} løb)\n`);
const failures = [];
for (const [metric, band] of Object.entries(BANDS)) {
  const v = aggregate[metric];
  const ok = within(metric, v);
  if (!ok) failures.push(`${metric}: ${metric === "bonusTop3MarginMedianDelta" ? `${v.toFixed(1)}s` : pctS(v)} udenfor [${metric === "bonusTop3MarginMedianDelta" ? `≤${band.max}s` : `${pctS(band.min)}, ${pctS(band.max)}`}]`);
  const display = metric === "bonusTop3MarginMedianDelta" ? `${v.toFixed(1)}s` : pctS(v);
  console.log(`  ${ok ? "✅" : "❌"} ${padE(metric, 28)} ${padS(display, 8)}   ${band.label}`);
}

console.log("");
if (failures.length) {
  console.log(`❌ ${failures.length} bånd-brud:`);
  for (const f of failures) console.log(`   · ${f}`);
  if (ENFORCE) process.exitCode = 1;
  else console.log(`   (rapport-only — kør med --enforce for at gate)`);
} else {
  console.log(`✅ Alle 5 konkurrence-balance-bånd grønne.`);
}
console.log("");
