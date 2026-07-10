#!/usr/bin/env node
// READ-ONLY simulation (#1378 / #2006) — z-normalized POSITIVE-ONLY specialist-fit
// classifier vs the current z-score CONTRAST classifier. NO prod mutation.
//
// Reuses production code unchanged:
//   - riderTypes.js  : RIDER_TYPES (weights), RIDER_TYPE_KEYS, GUARDS, abilityZ-via-baseline,
//                       the guardedOut() logic (re-implemented here ONLY because it is not
//                       exported — identical semantics, verified against the source).
//   - riderValuation.js : outputScore() (speciale_output) + meanAbilityScore() (mean abilities).
//   - riderTypesBaseline.json : population mean/std for z.
//
// NEW classifier: for each type, score = average over the type's POSITIVE-weighted
// abilities of (weight * z(ability)). z uses the baseline. DROP all negative-weight
// terms (no contrast subtraction). Apply the EXISTING guards unchanged.
//
//   node scripts/simRiderTypesPositiveFit.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  RIDER_TYPES,
  RIDER_TYPE_KEYS,
  GUARDS,
} from "../lib/riderTypes.js";
import { outputScore, meanAbilityScore } from "../lib/riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ABILITY keys the abilities table uses for the 15-ability mean (mean of all abilities).
// riderValuation.meanAbilityScore uses ABILITY_KEYS (13). We keep that EXACT call for the
// rating's mean term so O matches the value model. (Owner note: "mean(15 abilities)" — the
// codebase ability set is 13 game-abilities; we reuse the production mean for fidelity.)

// ── z + guards: re-implement guardedOut() identically to riderTypes.js (not exported) ──
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function abilityZ(abilities, ability) {
  const v = Number(abilities?.[ability]);
  if (!Number.isFinite(v)) return 0;
  const mean = baseline?.mean?.[ability] ?? 0;
  const std = baseline?.std?.[ability] || 1;
  return (v - mean) / std;
}
const SPECIALITY_ABILITIES = ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"];
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

// ── NEW classifier: positive-only z-fit ──
function scorePositiveFit(abilities, weights) {
  let pos = 0, posW = 0;
  for (const [ability, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    pos += abilityZ(abilities, ability) * w;
    posW += w;
  }
  return posW ? pos / posW : 0;
}

// Stable tie-break: RIDER_TYPES order is the documented priority. We index types and
// break ties on that index (matches the production stable-sort behavior).
const TYPE_INDEX = Object.fromEntries(RIDER_TYPE_KEYS.map((k, i) => [k, i]));

function classifyNew(abilities, { useGuards = true } = {}) {
  const out = useGuards ? guardedOut(abilities) : new Set();
  let scored = RIDER_TYPES
    .filter((t) => !out.has(t.key))
    .map((t) => ({ key: t.key, score: scorePositiveFit(abilities, t.weights) }));
  if (scored.length < 2) {
    scored = RIDER_TYPES.map((t) => ({ key: t.key, score: scorePositiveFit(abilities, t.weights) }));
  }
  // descending score, tie-break by RIDER_TYPES order (stable)
  scored.sort((a, b) => (b.score - a.score) || (TYPE_INDEX[a.key] - TYPE_INDEX[b.key]));
  return { primary: scored[0], secondary: scored[1] };
}

// ── V1 overall rating on top of NEW types ──
// O_best = 0.5*speciale_output(NEW primary) + 0.5*mean(abilities). Reuses production fns.
function oBest(abilities, primaryType) {
  return 0.5 * outputScore(abilities, primaryType) + 0.5 * meanAbilityScore(abilities);
}

// ── helpers ──
const ABILS = ["climbing","time_trial","sprint","punch","endurance","cobblestone","acceleration","recovery","prolog","flat","tempo","durability","descending","aggression"];
function pct(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * (sortedAsc.length - 1)));
  return sortedAsc[idx];
}
function dist(keys, items, keyFn) {
  const d = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const it of items) { const k = keyFn(it); d[k] = (d[k] || 0) + 1; }
  return d;
}
async function fetchAll() {
  // mirror prod active-non-retired with abilities (inner join)
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await supabase
      .from("riders")
      .select(`id, firstname, lastname, primary_type, secondary_type, base_value, is_retired, rider_derived_abilities!inner(${ABILS.join(",")})`)
      .eq("is_retired", false)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const a = Array.isArray(r.rider_derived_abilities) ? r.rider_derived_abilities[0] : r.rider_derived_abilities;
      if (!a) continue;
      rows.push({
        id: r.id,
        name: `${r.firstname} ${r.lastname}`,
        oldType: r.primary_type,
        oldSecondary: r.secondary_type,
        base_value: r.base_value,
        abilities: a,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function main(rows) {
  const total = rows.length;
  const out = [];
  const log = (s = "") => { out.push(s); console.log(s); };

  log(`=== READ-ONLY SIM: positive-only z-fit classifier (n=${total} active non-retired) ===`);
  log(`baseline: riderTypesBaseline.json (n=${baseline.n})  |  guards: ${JSON.stringify(GUARDS)}`);
  log("");

  // classify
  for (const r of rows) {
    r.newGuard = classifyNew(r.abilities, { useGuards: true });
    r.newNoGuard = classifyNew(r.abilities, { useGuards: false });
  }

  // 1) distributions
  const oldDist = dist(RIDER_TYPE_KEYS, rows, (r) => r.oldType);
  const newDist = dist(RIDER_TYPE_KEYS, rows, (r) => r.newGuard.primary.key);
  const newNoGuardDist = dist(RIDER_TYPE_KEYS, rows, (r) => r.newNoGuard.primary.key);

  log("## 1. PRIMARY-TYPE DISTRIBUTION");
  log("type             OLD(stored)        NEW(+guards)       NEW(no guards)");
  for (const k of RIDER_TYPE_KEYS) {
    const o = oldDist[k], n = newDist[k], ng = newNoGuardDist[k];
    log(`  ${k.padEnd(15)} ${String(o).padStart(5)} (${((o/total)*100).toFixed(1).padStart(5)}%)   ` +
        `${String(n).padStart(5)} (${((n/total)*100).toFixed(1).padStart(5)}%)   ` +
        `${String(ng).padStart(5)} (${((ng/total)*100).toFixed(1).padStart(5)}%)`);
  }
  log("");

  // change matrix (old -> new, guards)
  const pairs = new Map();
  let changed = 0;
  for (const r of rows) {
    if (r.oldType !== r.newGuard.primary.key) changed++;
    const key = `${r.oldType} -> ${r.newGuard.primary.key}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }
  const movePairs = [...pairs.entries()].filter(([k]) => {
    const [a, b] = k.split(" -> "); return a !== b;
  }).sort((a, b) => b[1] - a[1]);
  log(`## 1b. CHANGE MATRIX (old -> new, guards on). Changed ${changed}/${total} (${((changed/total)*100).toFixed(1)}%)`);
  log("Top 15 from->to move pairs:");
  for (const [k, v] of movePairs.slice(0, 15)) log(`  ${k.padEnd(34)} ${String(v).padStart(5)}`);
  log("");

  // guards effect: how many differ between guard/noguard
  let guardDiff = 0;
  const guardMoves = new Map();
  for (const r of rows) {
    if (r.newGuard.primary.key !== r.newNoGuard.primary.key) {
      guardDiff++;
      const key = `${r.newNoGuard.primary.key} (noguard) -> ${r.newGuard.primary.key} (guard)`;
      guardMoves.set(key, (guardMoves.get(key) || 0) + 1);
    }
  }
  log(`## 1c. GUARDS EFFECT: ${guardDiff}/${total} riders get a different primary with guards on`);
  for (const [k, v] of [...guardMoves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    log(`  ${k.padEnd(46)} ${String(v).padStart(5)}`);
  }
  log("");

  // 2) named spot-checks
  const NAMED = [
    "b896912d-777b-4b32-b680-bc2eec8a102c", // Ayoub Cherif
    "e698d171-219d-4781-ae5c-b1a36fdb6b3d", // Lei Lin (max sprint)
    "a9dce93e-430e-4d91-ab55-0740e2726b28", // Marcos Ramírez (best GC)
    "602f0dca-0f17-4fd8-89ea-2d9639564d0c", // Federico Brivio (top climber)
    "263b0af8-7d5a-43f8-8969-8e40fd86378b", // Javier Vega (top tt)
  ];
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 3) RATING — compute O_best on NEW primary for all, then normalize to 1-99.
  for (const r of rows) {
    r.O = oBest(r.abilities, r.newGuard.primary.key);
  }
  const Os = rows.map((r) => r.O).sort((a, b) => a - b);
  // STABLE anchor: p99.5 of O is the "elite=99" reference (NOT the literal max).
  const anchorP = 0.995;
  const anchorO = pct(Os, anchorP);
  const maxO = Os[Os.length - 1];
  const minO = Os[0];
  // Linear map: O=0 -> 1, O=anchorO -> 99. Clamp to [1,99].
  const ratingOf = (O) => {
    const raw = 1 + (O / anchorO) * 98;
    return Math.max(1, Math.min(99, Math.round(raw)));
  };
  for (const r of rows) r.rating = ratingOf(r.O);

  log("## RATING ANCHOR");
  log(`O distribution: min ${minO.toFixed(2)} · median ${pct(Os,0.5).toFixed(2)} · p90 ${pct(Os,0.9).toFixed(2)} · p99 ${pct(Os,0.99).toFixed(2)} · p99.5 ${anchorO.toFixed(2)} · max ${maxO.toFixed(2)}`);
  log(`Anchor = p99.5 of O = ${anchorO.toFixed(3)} maps to rating 99 (stable: p99.5 not literal max; max O ${maxO.toFixed(2)} also lands 99 after clamp). Tunable knob.`);
  log("");

  const ratings = rows.map((r) => r.rating).sort((a, b) => a - b);
  log("## RATING DISTRIBUTION (1-99)");
  log(`  min ${ratings[0]} · p10 ${pct(ratings,0.1)} · median ${pct(ratings,0.5)} · p90 ${pct(ratings,0.9)} · p99 ${pct(ratings,0.99)} · max ${ratings[ratings.length-1]}`);
  // histogram by 10s
  const buckets = Array(10).fill(0);
  for (const v of ratings) buckets[Math.min(9, Math.floor((v - 1) / 10))]++;
  log("histogram (rating bucket : count):");
  for (let i = 0; i < 10; i++) {
    const lo = i * 10 + 1, hi = i * 10 + 10;
    const bar = "#".repeat(Math.round((buckets[i] / total) * 80));
    log(`  ${String(lo).padStart(2)}-${String(hi).padStart(2)}: ${String(buckets[i]).padStart(5)} ${bar}`);
  }
  log("");

  // top-5 overall
  const byRating = [...rows].sort((a, b) => b.O - a.O);
  log("## TOP-5 OVERALL (by rating)");
  for (const r of byRating.slice(0, 5)) {
    log(`  ${String(r.rating).padStart(2)}  ${r.name.padEnd(24)} new=${r.newGuard.primary.key.padEnd(14)} old=${(r.oldType||"-").padEnd(14)} O=${r.O.toFixed(2)}`);
  }
  log("");

  // top-3 per NEW type
  log("## TOP-3 PER NEW TYPE");
  for (const k of RIDER_TYPE_KEYS) {
    const members = byRating.filter((r) => r.newGuard.primary.key === k).slice(0, 3);
    log(`  [${k}] (n=${newDist[k]})`);
    for (const r of members) {
      log(`     ${String(r.rating).padStart(2)}  ${r.name.padEnd(24)} O=${r.O.toFixed(2)}  old=${r.oldType||"-"}`);
    }
  }
  log("");

  // named examples
  log("## NAMED EXAMPLES (rating · new type · old type · key abilities)");
  for (const id of NAMED) {
    const r = byId.get(id);
    if (!r) { log(`  [missing ${id}]`); continue; }
    const a = r.abilities;
    log(`  ${r.name.padEnd(20)} rating=${String(r.rating).padStart(2)}  new=${r.newGuard.primary.key}/${r.newGuard.secondary.key}  old=${r.oldType}/${r.oldSecondary}`);
    log(`     spr=${a.sprint} acc=${a.acceleration} climb=${a.climbing} tt=${a.time_trial} punch=${a.punch} cob=${a.cobblestone} flat=${a.flat} agg=${a.aggression} | O=${r.O.toFixed(2)}`);
  }
  log("");

  // SANITY CHECKS
  log("## SANITY CHECKS");
  const oldTt = oldDist["tt"], newTt = newDist["tt"];
  log(`- tt catch-all: OLD ${oldTt} (${((oldTt/total)*100).toFixed(1)}%) -> NEW ${newTt} (${((newTt/total)*100).toFixed(1)}%) [${newTt < oldTt ? "DROPPED" : "NOT dropped"}]`);
  // any new catch-all? biggest new type
  const newSorted = RIDER_TYPE_KEYS.map((k) => [k, newDist[k]]).sort((a, b) => b[1] - a[1]);
  log(`- biggest NEW type: ${newSorted[0][0]} = ${newSorted[0][1]} (${((newSorted[0][1]/total)*100).toFixed(1)}%); 2nd ${newSorted[1][0]} = ${newSorted[1][1]}`);
  // weak riders still low-rated? mean13 of low raters
  const weakest = [...rows].sort((a, b) => a.O - b.O).slice(0, 5);
  log(`- weakest 5 by O (rating): ${weakest.map((r) => `${r.name}=${r.rating}`).join(", ")}`);
  // GC all-rounder vs pure specialist
  const ramirez = byId.get("a9dce93e-430e-4d91-ab55-0740e2726b28");
  const vega = byId.get("263b0af8-7d5a-43f8-8969-8e40fd86378b");
  const brivio = byId.get("602f0dca-0f17-4fd8-89ea-2d9639564d0c");
  if (ramirez && vega) log(`- GC all-rounder vs pure tt: Ramírez(gc) rating=${ramirez.rating} O=${ramirez.O.toFixed(2)} vs Vega(tt) rating=${vega.rating} O=${vega.O.toFixed(2)} vs Brivio(climber) rating=${brivio.rating} O=${brivio.O.toFixed(2)}`);

  return out.join("\n");
}

(async () => {
  const rows = await fetchAll();
  main(rows);
  // also expose machine-readable summary line for the scorecard writer
  process.stdout.write("\n<<<REPORT_END>>>\n");
})();
