#!/usr/bin/env node
// READ-ONLY follow-up probe for #1378. Diagnoses WHERE the new catch-alls under
// per-type standardization come from: are the riders flipping to sprinter /
// baroudeur actually weak/undifferentiated (structural artifact relocated) or
// genuinely that type? Untracked artifact. No mutation.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { ABILITY_KEYS, RIDER_TYPES, RIDER_TYPE_KEYS, GUARDS, scoreRiderType, computeRiderTypes } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const SPEC = ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"];
function guardedOut(a) {
  const out = new Set();
  if (SPEC.some((k) => num(a[k]) >= GUARDS.highSpeciality)) out.add("rouleur");
  if (num(a.sprint) > num(a.cobblestone)) out.add("brostensrytter");
  const isGc = num(a.climbing) >= GUARDS.gcClimbing && num(a.time_trial) >= GUARDS.gcTimeTrial && num(a.recovery) >= GUARDS.gcRecovery && num(a.punch) <= num(a.time_trial);
  if (!isGc) out.add("gc");
  return out;
}
const rawContrast = (a, w) => scoreRiderType(a, w, baseline);

async function fetchAll() {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${ABILITY_KEYS.join(", ")}, riders!inner(id, firstname, lastname, is_retired, primary_type)`)
      .order("rider_id").range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) if (r.riders?.is_retired !== true) out.push(r);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function fitStats(rows) {
  const acc = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, []]));
  for (const r of rows) for (const t of RIDER_TYPES) acc[t.key].push(rawContrast(r, t.weights));
  const stats = {};
  for (const k of RIDER_TYPE_KEYS) {
    const arr = acc[k];
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length);
    stats[k] = { mean, std };
  }
  return stats;
}
function classifyVA(r, stats) {
  const out = guardedOut(r);
  let scored = RIDER_TYPES.filter((t) => !out.has(t.key)).map((t) => {
    const m = stats[t.key];
    return { key: t.key, score: (rawContrast(r, t.weights) - m.mean) / (m.std || 1) };
  });
  if (scored.length < 2) scored = RIDER_TYPES.map((t) => {
    const m = stats[t.key];
    return { key: t.key, score: (rawContrast(r, t.weights) - m.mean) / (m.std || 1) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].key;
}

// "Overall strength" = mean ability across all 13 (how good the rider is at all).
const overall = (r) => ABILITY_KEYS.reduce((s, a) => s + num(r[a]), 0) / ABILITY_KEYS.length;
// "Peak" = max single ability (does the rider have ANY real specialty?).
const peak = (r) => Math.max(...ABILITY_KEYS.map((a) => num(r[a])));

async function main() {
  const rows = await fetchAll();
  const stats = fitStats(rows);
  const vaOf = new Map(rows.map((r) => [r.rider_id, classifyVA(r, stats)]));

  // Distribution of "overall strength" and "peak ability" per VA-assigned type.
  // If sprinter/baroudeur are catch-alls for the weak tail, their members will
  // have LOW peak (no real specialty) and LOW overall.
  console.log("=== #1378 probe: is the VA catch-all the weak/undifferentiated tail? ===");
  console.log("Per VA-type: n, median overall-strength, median peak-ability, %% with peak<55 (no real specialty)\n");
  const byType = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, []]));
  for (const r of rows) byType[vaOf.get(r.rider_id)].push(r);
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  for (const k of RIDER_TYPE_KEYS) {
    const grp = byType[k];
    if (!grp.length) { console.log(`  ${k.padEnd(15)} n=0`); continue; }
    const ov = grp.map(overall);
    const pk = grp.map(peak);
    const noSpec = grp.filter((r) => peak(r) < 55).length;
    console.log(`  ${k.padEnd(15)} n=${String(grp.length).padStart(4)}  medOverall=${median(ov).toFixed(1).padStart(5)}  medPeak=${median(pk).toFixed(0).padStart(3)}  noSpec(peak<55)=${((noSpec / grp.length) * 100).toFixed(0).padStart(3)}%`);
  }

  // Compare: same metrics for the WHOLE population and for the weak tail.
  const allPeak = rows.map(peak).sort((a, b) => a - b);
  const allOverall = rows.map(overall).sort((a, b) => a - b);
  console.log(`\nPopulation: medOverall=${allOverall[Math.floor(allOverall.length / 2)].toFixed(1)}  medPeak=${allPeak[Math.floor(allPeak.length / 2)].toFixed(0)}`);
  const weakTail = rows.filter((r) => peak(r) < 55);
  console.log(`Weak tail (peak<55, no real specialty): ${weakTail.length} riders (${((weakTail.length / rows.length) * 100).toFixed(0)}% of population)`);
  // Where does the weak tail land under V0 vs VA?
  const v0Of = new Map(rows.map((r) => [r.rider_id, computeRiderTypes(r, baseline).primary.key]));
  const tally = (set, of) => {
    const d = {};
    for (const r of set) { const k = of.get(r.rider_id); d[k] = (d[k] || 0) + 1; }
    return Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ");
  };
  console.log(`  weak tail under V0: ${tally(weakTail, v0Of)}`);
  console.log(`  weak tail under VA: ${tally(weakTail, vaOf)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
