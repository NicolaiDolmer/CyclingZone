#!/usr/bin/env node
// READ-ONLY simulation for #1378 — per-type standardization of the rider-type
// classifier. NO prod mutation, NO schema change. Untracked artifact.
//
// Reuses production code UNCHANGED:
//   - backend/lib/riderTypes.js (RIDER_TYPES, GUARDS, scoreRiderType, computeRiderTypes)
//   - backend/lib/riderTypesBaseline.json (z-score baseline)
//
// Faithfulness check: confirm the harness reproduces the stored primary_type via
// the production computeRiderTypes for ~100% of riders before testing variants.
//
//   node scripts/simRiderTypeStandardization.js
//
// Variants:
//   V0  current contrast (scoreRiderType) argmax + guards  (must match stored)
//   VA  contrast score, PER-TYPE STANDARDIZED, argmax + guards
//   VB  positive-fit score, per-type standardized + guards (prior-sim recommendation)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

import {
  ABILITY_KEYS,
  RIDER_TYPES,
  RIDER_TYPE_KEYS,
  GUARDS,
  scoreRiderType,
  computeRiderTypes,
} from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const baseline = JSON.parse(
  readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8")
);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const SPECIALITY_ABILITIES = ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"];

// Re-implement the production guard EXACTLY (guardedOut is not exported, but
// computeRiderTypes uses it; we mirror it byte-for-byte from riderTypes.js so
// VA/VB apply the same exclusions the production argmax does).
function guardedOut(abilities) {
  const out = new Set();
  if (SPECIALITY_ABILITIES.some((a) => num(abilities[a]) >= GUARDS.highSpeciality)) out.add("rouleur");
  if (num(abilities.sprint) > num(abilities.cobblestone)) out.add("brostensrytter");
  const isGc = num(abilities.climbing) >= GUARDS.gcClimbing
    && num(abilities.time_trial) >= GUARDS.gcTimeTrial
    && num(abilities.recovery) >= GUARDS.gcRecovery
    && num(abilities.punch) <= num(abilities.time_trial);
  if (!isGc) out.add("gc");
  return out;
}

// z-score for one ability vs baseline (mirror of riderTypes.abilityZ).
function abilityZ(abilities, ability) {
  const v = Number(abilities?.[ability]);
  if (!Number.isFinite(v)) return 0;
  const mean = baseline?.mean?.[ability] ?? 0;
  const std = baseline?.std?.[ability] || 1;
  return (v - mean) / std;
}

// POSITIVE-FIT score for one type: mean of (z * weight) over POSITIVE weights only.
// No negative-penalty term. Used by VB.
function positiveFitScore(abilities, weights) {
  let pos = 0, posW = 0;
  for (const [ability, w] of Object.entries(weights)) {
    if (w > 0) { pos += abilityZ(abilities, ability) * w; posW += w; }
  }
  return posW ? pos / posW : 0;
}

// ── Load all active non-retired riders (same population the task targets) ──────
async function fetchAll() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  // riders has firstname/lastname + type cols; abilities are in rider_derived_abilities.
  for (;;) {
    const { data, error } = await supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${ABILITY_KEYS.join(", ")}, riders!inner(id, firstname, lastname, is_retired, primary_type, secondary_type)`)
      .order("rider_id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.riders?.is_retired === true) continue; // active non-retired only
      rows.push(r);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// ── Variant classifiers ───────────────────────────────────────────────────────

// V0: production argmax (the real thing). Returns primary key.
function classifyV0(abilities) {
  return computeRiderTypes(abilities, baseline).primary.key;
}

// Generic: given a per-type raw-score function and an optional per-type
// standardization (mean/std), classify with guards. Mirrors computeRiderTypes'
// guard + fallback logic so the only difference vs V0 is the score transform.
function classifyStandardized(abilities, rawScoreOf, stats) {
  const out = guardedOut(abilities);
  let scored = RIDER_TYPES
    .filter((t) => !out.has(t.key))
    .map((t) => {
      const raw = rawScoreOf(abilities, t.weights, t.key);
      const m = stats[t.key];
      const std = m.std || 1;
      return { key: t.key, score: (raw - m.mean) / std };
    });
  if (scored.length < 2) {
    scored = RIDER_TYPES.map((t) => {
      const raw = rawScoreOf(abilities, t.weights, t.key);
      const m = stats[t.key];
      const std = m.std || 1;
      return { key: t.key, score: (raw - m.mean) / std };
    });
  }
  scored.sort((a, b) => b.score - a.score); // stable: ties keep RIDER_TYPES order
  return scored[0].key;
}

// Compute per-type population mean+std of a raw-score function over the whole
// population (UNGUARDED — standardization parameters describe the type's score
// distribution across all riders, which is the structural fix the task asks for).
function fitTypeStats(rows, rawScoreOf) {
  const acc = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, []]));
  for (const r of rows) {
    for (const t of RIDER_TYPES) {
      acc[t.key].push(rawScoreOf(r, t.weights, t.key));
    }
  }
  const stats = {};
  for (const k of RIDER_TYPE_KEYS) {
    const arr = acc[k];
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
    stats[k] = { mean, std: Math.sqrt(variance) };
  }
  return stats;
}

const rawContrast = (abilities, weights) => scoreRiderType(abilities, weights, baseline);
const rawPositive = (abilities, weights) => positiveFitScore(abilities, weights);

// ── Reporting helpers ──────────────────────────────────────────────────────────
function distOf(rows, classify) {
  const d = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  const result = new Map();
  for (const r of rows) {
    const key = classify(r);
    d[key] = (d[key] || 0) + 1;
    result.set(r.rider_id, key);
  }
  return { dist: d, byId: result };
}

function fmtDist(dist, total) {
  return RIDER_TYPE_KEYS
    .map((k) => ({ k, n: dist[k] }))
    .sort((a, b) => b.n - a.n)
    .map(({ k, n }) => `  ${k.padEnd(15)} ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(1).padStart(5)}%`)
    .join("\n");
}

function changeMatrix(rowsById, fromById, toById) {
  // counts of from->to where they differ
  const m = new Map();
  let changed = 0;
  for (const [id, from] of fromById) {
    const to = toById.get(id);
    if (from !== to) {
      changed++;
      const key = `${from} -> ${to}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
  }
  return { changed, transitions: [...m.entries()].sort((a, b) => b[1] - a[1]) };
}

function nameOf(r) {
  const fn = r.riders?.firstname || "";
  const ln = r.riders?.lastname || "";
  return `${fn} ${ln}`.trim();
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  const out = [];
  const log = (s = "") => { out.push(s); console.log(s); };

  log("=== #1378 READ-ONLY sim: per-type standardization of rider-type classifier ===");
  log(`baseline n=${baseline.n}  abilities=${ABILITY_KEYS.length}  types=${RIDER_TYPE_KEYS.length}`);
  log("");

  const rows = await fetchAll();
  const total = rows.length;
  log(`Population: ${total} active non-retired riders (with abilities)`);
  log("");

  // ── Faithfulness check: V0 must reproduce stored primary_type ───────────────
  let match = 0, mismatch = 0;
  const mismatches = [];
  for (const r of rows) {
    const v0 = classifyV0(r);
    if (v0 === r.riders.primary_type) match++;
    else { mismatch++; if (mismatches.length < 10) mismatches.push(`${nameOf(r)} stored=${r.riders.primary_type} v0=${v0}`); }
  }
  const pct = ((match / total) * 100).toFixed(2);
  log(`FAITHFULNESS CHECK: V0 (production computeRiderTypes) reproduces stored primary_type for ${match}/${total} (${pct}%)`);
  if (mismatch > 0) {
    log(`  mismatches: ${mismatch}`);
    mismatches.forEach((m) => log(`    ${m}`));
  }
  log("");

  // ── Fit per-type standardization parameters ─────────────────────────────────
  const contrastStats = fitTypeStats(rows, rawContrast);
  const positiveStats = fitTypeStats(rows, rawPositive);

  log("Per-type CONTRAST score population stats (used by VA):");
  for (const k of RIDER_TYPE_KEYS) {
    log(`  ${k.padEnd(15)} mean=${contrastStats[k].mean.toFixed(3).padStart(7)}  std=${contrastStats[k].std.toFixed(3).padStart(6)}`);
  }
  log("");

  // ── Classify under each variant ─────────────────────────────────────────────
  const v0 = distOf(rows, classifyV0);
  const va = distOf(rows, (r) => classifyStandardized(r, rawContrast, contrastStats));
  const vb = distOf(rows, (r) => classifyStandardized(r, rawPositive, positiveStats));

  for (const [label, res] of [["V0 baseline (current, stored)", v0], ["VA contrast + per-type standardized", va], ["VB positive-fit + per-type standardized", vb]]) {
    log(`── ${label} ──`);
    log(fmtDist(res.dist, total));
    const maxKey = RIDER_TYPE_KEYS.reduce((a, b) => (res.dist[a] >= res.dist[b] ? a : b));
    log(`  catch-all (largest) = ${maxKey} at ${((res.dist[maxKey] / total) * 100).toFixed(1)}%`);
    log("");
  }

  // ── Change matrices vs V0 ───────────────────────────────────────────────────
  for (const [label, res] of [["VA vs V0", va], ["VB vs V0", vb]]) {
    const cm = changeMatrix(rows, v0.byId, res.byId);
    log(`── Change matrix ${label}: ${cm.changed}/${total} reclassified (${((cm.changed / total) * 100).toFixed(1)}%) ──`);
    cm.transitions.slice(0, 20).forEach(([t, n]) => log(`  ${t.padEnd(28)} ${String(n).padStart(5)}`));
    log("");
  }

  // ── Spot checks ─────────────────────────────────────────────────────────────
  // accent-insensitive (Ramírez vs Ramirez): strip diacritics before matching.
  const deAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const findByName = (sub) => rows.find((r) => deAccent(nameOf(r)).includes(deAccent(sub)));
  const findById = (idPrefix) => rows.find((r) => String(r.rider_id).startsWith(idPrefix));

  const spotTargets = [];
  const marcos = findByName("Marcos Ramirez");
  if (marcos) spotTargets.push(["Marcos Ramirez (textbook GC)", marcos]);
  const ayoub = findByName("Ayoub Cherif") || findById("b896912d");
  if (ayoub) spotTargets.push(["Ayoub Cherif (weak tail)", ayoub]);

  log("── Spot checks ──");
  for (const [label, r] of spotTargets) {
    const ab = ABILITY_KEYS.map((a) => `${a.slice(0, 4)}=${num(r[a])}`).join(" ");
    log(`${label}  id=${String(r.rider_id).slice(0, 8)}`);
    log(`  abilities: ${ab}`);
    log(`  stored=${r.riders.primary_type}  V0=${v0.byId.get(r.rider_id)}  VA=${va.byId.get(r.rider_id)}  VB=${vb.byId.get(r.rider_id)}`);
    // show standardized scores for VA so we see WHY
    const guardOut = guardedOut(r);
    const vaScores = RIDER_TYPES.map((t) => {
      const raw = rawContrast(r, t.weights);
      const m = contrastStats[t.key];
      return { key: t.key, std: (raw - m.mean) / (m.std || 1), guarded: guardOut.has(t.key) };
    }).sort((a, b) => b.std - a.std);
    log(`  VA standardized scores: ${vaScores.map((s) => `${s.key}${s.guarded ? "(X)" : ""}=${s.std.toFixed(2)}`).join("  ")}`);
    log("");
  }

  // Auto-pick a clear sprinter (highest sprint among stored sprinter) and a clear
  // climber (highest climbing among stored climber) for additional spot checks.
  const stored = (k) => rows.filter((r) => r.riders.primary_type === k);
  const topBy = (arr, ab) => arr.slice().sort((a, b) => num(b[ab]) - num(a[ab]))[0];
  const realSprinter = topBy(stored("sprinter"), "sprint");
  const realClimber = topBy(stored("climber"), "climbing");
  const realGc = topBy(stored("gc"), "climbing");
  for (const [label, r] of [["Top sprinter (highest sprint)", realSprinter], ["Top climber (highest climbing)", realClimber], ["Top GC (highest climbing among gc)", realGc]]) {
    if (!r) continue;
    log(`${label}  ${nameOf(r)}  id=${String(r.rider_id).slice(0, 8)}`);
    log(`  key abilities: climb=${num(r.climbing)} tt=${num(r.time_trial)} sprint=${num(r.sprint)} accel=${num(r.acceleration)} punch=${num(r.punch)} cobble=${num(r.cobblestone)} recov=${num(r.recovery)}`);
    log(`  stored=${r.riders.primary_type}  V0=${v0.byId.get(r.rider_id)}  VA=${va.byId.get(r.rider_id)}  VB=${vb.byId.get(r.rider_id)}`);
    log("");
  }

  // ── Strong-rider integrity check: did VA/VB break clear specialists? ─────────
  // For each strong specialist (stored type with high defining ability), count how
  // many stayed correct vs flipped under VA/VB.
  function integrity(classifyById, variantLabel) {
    const checks = [
      { type: "gc", ab: "climbing", thr: 70, label: "strong GC (climb>=70)" },
      { type: "sprinter", ab: "sprint", thr: 70, label: "strong sprinter (sprint>=70)" },
      { type: "climber", ab: "climbing", thr: 75, label: "strong climber (climb>=75)" },
      { type: "brostensrytter", ab: "cobblestone", thr: 70, label: "strong cobbles (cobble>=70)" },
    ];
    log(`  [${variantLabel}] strong-rider retention:`);
    for (const c of checks) {
      const grp = rows.filter((r) => r.riders.primary_type === c.type && num(r[c.ab]) >= c.thr);
      if (grp.length === 0) { log(`    ${c.label.padEnd(30)} n=0`); continue; }
      const kept = grp.filter((r) => classifyById.get(r.rider_id) === c.type).length;
      log(`    ${c.label.padEnd(30)} kept ${kept}/${grp.length}  (${((kept / grp.length) * 100).toFixed(0)}%)`);
    }
  }
  log("── Strong-rider integrity ──");
  integrity(va.byId, "VA");
  integrity(vb.byId, "VB");
  log("");

  // ── Write scorecard markdown to scratchpad ──────────────────────────────────
  const scoreLines = out.join("\n");
  return { scoreLines, rows: total, v0, va, vb, contrastStats };
}

main()
  .then(({ scoreLines }) => {
    const scratch = process.env.SCRATCH_OUT;
    if (scratch) {
      writeFileSync(scratch, scoreLines, "utf8");
      console.log(`\n[scorecard written to ${scratch}]`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("ERROR:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
