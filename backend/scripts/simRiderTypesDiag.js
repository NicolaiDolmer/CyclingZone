#!/usr/bin/env node
// Diagnostic for the positive-only fit: WHY does tt explode? Inspect per-type positive
// ability count + how often each type's positive-fit score is max, and Ayoub's per-type scores.
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { RIDER_TYPES, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function z(a, k) {
  const v = Number(a?.[k]); if (!Number.isFinite(v)) return 0;
  return (v - (baseline.mean[k] ?? 0)) / (baseline.std[k] || 1);
}
function posFit(a, w) {
  let s = 0, n = 0;
  for (const [k, x] of Object.entries(w)) if (x > 0) { s += z(a, k) * x; n += x; }
  return n ? s / n : 0;
}

console.log("## Positive-ability count per type (fewer = structurally higher avg):");
for (const t of RIDER_TYPES) {
  const pos = Object.entries(t.weights).filter(([, w]) => w > 0).map(([k]) => k);
  console.log(`  ${t.key.padEnd(15)} ${pos.length}  [${pos.join(", ")}]`);
}

const ABILS = ["climbing","time_trial","sprint","punch","endurance","cobblestone","acceleration","recovery","flat","tempo","durability","descending","aggression"];
const { data } = await supabase
  .from("riders").select(`id, firstname, lastname, rider_derived_abilities!inner(${ABILS.join(",")})`)
  .eq("is_retired", false).limit(5000);

const ayoub = data.find((r) => r.id.startsWith("b896912d"));
const a = ayoub.rider_derived_abilities[0] || ayoub.rider_derived_abilities;
console.log(`\n## Ayoub Cherif per-type positive-fit (z) — abilities: spr21 acc21 agg30 tt12 flat12 climb1:`);
const scored = RIDER_TYPES.map((t) => ({ k: t.key, s: posFit(a, t.weights) })).sort((x, y) => y.s - x.s);
for (const x of scored) console.log(`  ${x.k.padEnd(15)} ${x.s.toFixed(3)}`);
console.log(`  (z(time_trial)=${z(a,"time_trial").toFixed(3)}, z(sprint)=${z(a,"sprint").toFixed(3)}, z(acceleration)=${z(a,"acceleration").toFixed(3)})`);

// How often is tt's single-ability score simply the argmax across the population (no guards)?
let ttWins = 0;
const winBy = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
for (const r of data) {
  const ab = r.rider_derived_abilities[0] || r.rider_derived_abilities;
  if (!ab) continue;
  const best = RIDER_TYPES.map((t) => ({ k: t.key, s: posFit(ab, t.weights) })).sort((x, y) => y.s - x.s)[0];
  winBy[best.k]++;
  if (best.k === "tt") ttWins++;
}
console.log(`\n## Argmax winner (no guards, full pop n=${data.length}):`);
for (const k of RIDER_TYPE_KEYS) console.log(`  ${k.padEnd(15)} ${winBy[k]}`);
