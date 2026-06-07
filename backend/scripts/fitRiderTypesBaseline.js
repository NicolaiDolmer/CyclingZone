#!/usr/bin/env node
// Fit baseline for ryttertype-z-score (#49 / #1101) — skriver backend/lib/riderTypesBaseline.json.
//
// Beregner mean + std pr. game-ability over den aktive population (rider_derived_abilities).
// computeRiderTypes() bruger baseline til z-score-normalisering før kontrast-vægtene,
// så median-skævheden mellem evner fjernes (se backend/lib/riderTypes.js).
//
// Idempotent + deterministisk (samme population → samme tal). Kør igen når populationen
// ændrer sig markant (fx ved relaunch til fiktive ryttere, #1105) ELLER når abilities
// re-deriveres (previewDerivedAbilities.js --apply).
//
//   node scripts/fitRiderTypesBaseline.js            # fit + skriv JSON
//   node scripts/fitRiderTypesBaseline.js --dry-run  # vis tal, skriv ikke

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../lib/riderTypes.js";

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
  console.log(`=== Fit ryttertype-baseline ${DRY_RUN ? "(DRY-RUN)" : "(WRITE)"} — fra rider_derived_abilities ===`);
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${ABILITY_KEYS.join(", ")}, riders!inner(is_retired)`)
      .eq("riders.is_retired", false)
      .order("rider_id"));
  const n = rows.length;

  const mean = {};
  const std = {};
  for (const a of ABILITY_KEYS) {
    const vals = rows.map((r) => Number(r[a])).filter((v) => Number.isFinite(v));
    const m = vals.reduce((x, y) => x + y, 0) / vals.length;
    const variance = vals.reduce((x, y) => x + (y - m) ** 2, 0) / vals.length;
    mean[a] = Math.round(m * 1000) / 1000;
    std[a] = Math.round((Math.sqrt(variance) || 1) * 1000) / 1000;
  }

  console.log(`\nAktive ryttere med abilities: ${n}`);
  console.log("ability          mean     std");
  for (const a of ABILITY_KEYS) {
    console.log(`  ${a.padEnd(13)} ${String(mean[a]).padStart(7)} ${String(std[a]).padStart(7)}`);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke.");
    return;
  }
  const payload = {
    description: "Population baseline (mean/std pr. game-ability) til ryttertype-z-score (#49/#1101). Fittet over aktive ryttere i rider_derived_abilities.",
    n,
    mean,
    std,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\n✅ Skrev ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
