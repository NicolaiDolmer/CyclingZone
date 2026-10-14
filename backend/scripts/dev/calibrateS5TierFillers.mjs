#!/usr/bin/env node
// backend/scripts/dev/calibrateS5TierFillers.mjs
// #6367: søg S5-modellens pr.-division filler-tilt (lib/s5TierFillerCalibration.js).
//
// 100 % OFFLINE. Hver kandidat-tabel køres gennem HELE tørkørslens kæde
// (seasonCalendarGatesOffline.mjs: materializer → gatePlan → scorecard → S5-benchmark-gaten)
// mod den committede katalog-fixture. Intet skrives; resultatet går til stdout (og --out).
//
// KRITERIET er gatesne selv, i rækkefølge:
//   1. ingen hård gate (placering, blokerende, S5-benchmark del 1-3)   — vægt 1000 pr. brud
//   2. ingen override-bar gate (K-B sæson, §6b)                          — vægt 100 pr. brud
//   3. mindst afstand til målene: §6 K-B pr. division og sæson, §6b pr. division, i enheder
//      af den strenge tolerance (±2 pp), plus en margin til §5's rolling-bånd.
// Benchmark-gatens del (4) (motor-bench) afhænger ikke af filler-vægtene og tælles ikke.
//
// METODE: koordinat-søgning over (division, profiltype) på et fast gitter af faktorer.
// Hver koordinat prøves på alle gitterværdier; den bedste beholdes. Gentages indtil en
// fuld runde ikke forbedrer.
//
//   node scripts/dev/calibrateS5TierFillers.mjs --season 5 --first-day 2026-10-28 --last-day 2026-11-28
//   ... --tiers 1,2          (kun disse divisioners koordinater)
//   ... --start <fil.json>   (start fra en tabel { "1": { "mountain": 0.5, ... } })
//   ... --out <fil.json>     (skriv den bedste tabel; brug balance-internals/, aldrig git)
//   ... --rounds N           (maks antal runder, default 3)
//
// Refs #6367

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { runOfflineSeasonGates } from "./seasonCalendarGatesOffline.mjs";
import { S5_TILT_PROFILE_TYPES, S5_TIER_FILLER_TILT } from "../../lib/s5TierFillerCalibration.js";
import {
  ACTIVE_TARGET, COMPOSITION_TOLERANCE_PP, TIER_UNIFORM_TARGET_FRACTIONS, compositionCategory,
} from "../../lib/calendarCompositionTargets.js";
import { TIER_TERRAIN_FAMILY_MIN, TIER_TERRAIN_FAMILY_MAX, TERRAIN_FAMILY_BY_PROFILE_TYPE } from "../../lib/tierCalendarGuarantees.js";

export const FACTOR_GRID = Object.freeze([0.25, 0.35, 0.5, 0.7, 0.85, 1, 1.2, 1.5, 2, 2.8, 4]);
const KB_KEYS = Object.freeze(["flat", "hilly", "mountain", "itt", "cobbles"]);
const UNIFORM_KEYS = Object.freeze(["itt", "cobbles", "high_mountain"]);

/** Typer pr. division (repræsentativ pulje) → K-B-andele, §6b-andele, rolling-antal. */
export function tierShares(planTier) {
  const pool = planTier.pools?.[0];
  const profiles = planTier.profilesByPoolRaceId ?? new Map();
  /** @type {Record<string, number>} */
  const types = {};
  let n = 0;
  for (const race of pool?.raceRows ?? []) {
    for (const p of profiles.get(race.pool_race_id) ?? []) { types[p.profile_type] = (types[p.profile_type] ?? 0) + 1; n += 1; }
  }
  /** @type {Record<string, number>} */
  const kb = {};
  for (const [t, c] of Object.entries(types)) { const cat = compositionCategory(t); if (cat) kb[cat] = (kb[cat] ?? 0) + c; }
  const pct = (/** @type {number} */ c) => (n ? (100 * c) / n : 0);
  const uniform = {
    itt: pct((types.itt ?? 0) + (types.itt_hilly ?? 0)),
    cobbles: pct(types.cobbles ?? 0),
    high_mountain: pct(types.high_mountain ?? 0),
  };
  const rolling = Object.entries(types).filter(([t]) => TERRAIN_FAMILY_BY_PROFILE_TYPE[t] === "rolling").reduce((s, [, c]) => s + c, 0);
  return { n, types, kbPct: Object.fromEntries(KB_KEYS.map((k) => [k, pct(kb[k] ?? 0)])), uniform, rolling };
}

// Regularisering: foretræk den MINDSTE tilt der holder gatesne (ln-faktor i anden). Uden den
// løber søgningen ud til gitterets kanter for at vinde et par tiendedele pp.
export const TILT_REGULARIZATION = 2;

/** Tab for ét resultat af runOfflineSeasonGates (+ tabellen der gav det). Lavere er bedre. */
export function lossOf(result, table = {}) {
  const hard = result.hard.filter((b) => !/S5 \(4\) motor/.test(b));
  let loss = 1000 * hard.length + 100 * result.overridable.length;
  for (const factors of Object.values(table)) for (const f of Object.values(factors)) loss += TILT_REGULARIZATION * Math.log(f) ** 2;
  const tol = COMPOSITION_TOLERANCE_PP;
  for (const t of result.plan.planTiers ?? []) {
    const s = tierShares(t);
    for (const k of KB_KEYS) loss += ((s.kbPct[k] - ACTIVE_TARGET[k]) / tol) ** 2;
    for (const k of UNIFORM_KEYS) loss += ((s.uniform[k] - 100 * TIER_UNIFORM_TARGET_FRACTIONS[k]) / tol) ** 2;
    const lo = TIER_TERRAIN_FAMILY_MIN[t.tier]?.rolling ?? 0;
    const hi = TIER_TERRAIN_FAMILY_MAX[t.tier]?.rolling ?? Infinity;
    // margin: mindst 2 etaper fra begge kanter af rolling-båndet
    loss += 5 * Math.max(0, lo + 2 - s.rolling) + 5 * Math.max(0, s.rolling - (hi - 2));
  }
  for (const row of result.report.rows ?? []) {
    if (KB_KEYS.includes(row.category ?? "")) loss += 2 * ((row.actual - row.target) / tol) ** 2;
  }
  return loss;
}

/** @param {Record<string, Record<string, number>>} table */
function cloneTable(table) {
  return Object.fromEntries(Object.entries(table).map(([t, f]) => [t, { ...f }]));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const argOf = (/** @type {string} */ f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const seasonNumber = Number(argOf("--season") ?? 5);
  const firstDay = argOf("--first-day");
  const lastDay = argOf("--last-day");
  if (!firstDay) { console.error("--first-day kræves"); process.exit(2); }
  const tiers = (argOf("--tiers") ?? "1,2,3,4").split(",").map(Number);
  const rounds = Number(argOf("--rounds") ?? 3);
  const startPath = argOf("--start");
  const outPath = argOf("--out");
  /** @type {Record<string, Record<string, number>>} */
  let best = cloneTable(startPath ? JSON.parse(readFileSync(startPath, "utf8")) : S5_TIER_FILLER_TILT);
  // --alt-draws K: læg middel-tabet over K ALTERNATIVE parcours-træk (samme løbsudvalg,
  // andet season_id i seed-nøglen) til sæsonens rigtige træk. Uden dem kalibreres der mod
  // ét træk, og tabellen bliver et tilfælde af det træk i stedet for en rettelse af
  // fordelingen (målt: grøn på det rigtige træk, sjældent på andre).
  const altDraws = Number(argOf("--alt-draws") ?? 0);
  const evaluate = async (/** @type {any} */ table) => {
    const r = await runOfflineSeasonGates({ seasonNumber, firstDay, lastDay, s5TierFillerTilt: table });
    let loss = lossOf(r, table);
    for (let k = 1; k <= altDraws; k++) {
      const alt = await runOfflineSeasonGates({ seasonNumber, firstDay, lastDay, s5TierFillerTilt: table, seasonId: `calibration-draw-${k}` });
      loss += lossOf(alt, {}) / altDraws;
    }
    return { r, loss };
  };
  let { r: bestRun, loss: bestLoss } = await evaluate(best);
  console.log(`start: tab ${bestLoss.toFixed(2)} · hårde ${bestRun.hard.length} · override-bare ${bestRun.overridable.length}`);
  // --random N: stokastisk bjergbestigning FØR koordinat-runderne. Gitteret er diskret og
  // rng-strømmen forskyder sig når en vægt ændres, så én koordinat ad gangen sidder fast i
  // lokale minima; 1-3 samtidige ændringer kommer ud af dem. Deterministisk (--rng-seed).
  const randomIters = Number(argOf("--random") ?? 0);
  let s = Number(argOf("--rng-seed") ?? 1) >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < randomIters; i++) {
    const cand = cloneTable(best);
    const moves = 1 + Math.floor(rand() * 3);
    for (let m = 0; m < moves; m++) {
      const tier = tiers[Math.floor(rand() * tiers.length)];
      const type = S5_TILT_PROFILE_TYPES[Math.floor(rand() * S5_TILT_PROFILE_TYPES.length)];
      cand[tier] = { ...(cand[tier] ?? {}), [type]: FACTOR_GRID[Math.floor(rand() * FACTOR_GRID.length)] };
    }
    const { r, loss } = await evaluate(cand);
    if (loss < bestLoss - 1e-9) {
      best = cand; bestLoss = loss; bestRun = r;
      console.log(`  tilfældig ${i} · tab ${bestLoss.toFixed(2)} · hårde ${bestRun.hard.length} · override-bare ${bestRun.overridable.length} · ${JSON.stringify(best)}`);
    }
  }
  for (let round = 1; round <= rounds; round++) {
    let improved = false;
    for (const tier of tiers) {
      for (const type of S5_TILT_PROFILE_TYPES) {
        const current = best[tier]?.[type] ?? 1;
        for (const f of FACTOR_GRID) {
          if (f === current) continue;
          const cand = cloneTable(best);
          cand[tier] = { ...(cand[tier] ?? {}), [type]: f };
          const { r, loss } = await evaluate(cand);
          if (loss < bestLoss - 1e-9) { best = cand; bestLoss = loss; bestRun = r; improved = true; }
        }
        console.log(`  runde ${round} · D${tier} ${type.padEnd(13)} → ${best[tier]?.[type] ?? 1} · tab ${bestLoss.toFixed(2)} · hårde ${bestRun.hard.length} · override-bare ${bestRun.overridable.length}`);
      }
    }
    if (!improved) break;
  }
  console.log(JSON.stringify(best));
  for (const b of [...bestRun.hard, ...bestRun.overridable]) console.log(`   · ${b}`);
  if (outPath) writeFileSync(outPath, `${JSON.stringify(best, null, 2)}\n`);
}
