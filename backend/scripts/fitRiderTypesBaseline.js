#!/usr/bin/env node
// Fit baseline for ryttertype-z-score (#49) — skriver backend/lib/riderTypesBaseline.json.
//
// Beregner middel + spredning pr. legacy stat over den aktive population. Bruges
// af computeRiderTypes() til at normalisere stats til z-scores før #49's vægte
// anvendes, så type = relativ styrke mod feltet (ikke absolut niveau).
//
// Idempotent + deterministisk (samme population → samme tal). Kør igen når
// populationen ændrer sig markant (fx ved relaunch til fiktive ryttere, #1105).
//
//   node scripts/fitRiderTypesBaseline.js            # fit + skriv JSON
//   node scripts/fitRiderTypesBaseline.js --dry-run  # vis tal, skriv ikke

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { STAT_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const OUT_PATH = join(__dirname, "../lib/riderTypesBaseline.json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`=== Fit ryttertype-baseline ${DRY_RUN ? "(DRY-RUN)" : "(WRITE)"} ===`);
  const riders = await fetchAllRows(() =>
    supabase.from("riders").select(`id,${STAT_KEYS.join(",")}`).eq("is_retired", false).order("id"));
  const n = riders.length;

  const mean = {};
  const std = {};
  for (const s of STAT_KEYS) {
    const vals = riders.map((r) => Number(r[s])).filter((v) => Number.isFinite(v));
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    mean[s] = Math.round(m * 1000) / 1000;
    std[s] = Math.round((Math.sqrt(variance) || 1) * 1000) / 1000;
  }

  console.log(`\nAktive ryttere: ${n}`);
  console.log("stat        mean     std");
  for (const s of STAT_KEYS) {
    console.log(`  ${s.padEnd(10)} ${String(mean[s]).padStart(7)} ${String(std[s]).padStart(7)}`);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke.");
    return;
  }
  const payload = {
    description: "Population baseline (mean/std pr. legacy stat) til ryttertype-z-score (#49). Fittet over aktive (ikke-retired) ryttere.",
    n,
    mean,
    std,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\n✅ Skrev ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
