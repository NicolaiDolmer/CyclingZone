#!/usr/bin/env node
// Fit baseline for ryttertype-z-score (#49 / #1101) — skriver backend/lib/riderTypesBaseline.json.
//
// Beregner mean + std pr. game-ability over en population. computeRiderTypes() bruger
// baseline til z-score-normalisering før kontrast-vægtene, så median-skævheden mellem
// evner fjernes (se backend/lib/riderTypes.js).
//
// To populationer:
//   (default) PROD       — aktive ryttere i rider_derived_abilities (kræver DB-creds).
//   --fictional          — den fiktive launch-population (LAUNCH_POPULATION), genereret
//                          deterministisk via generatoren + deriveAbilities. INGEN DB.
//                          Brug denne ved relaunch til fiktive ryttere (#1105/#1122):
//                          PCM-baselinen passer ikke den fysiologi-drevne fordeling.
//
// Idempotent + deterministisk (samme population → samme tal). Kør igen når populationen
// ændrer sig markant (fx relaunch) ELLER når abilities re-deriveres.
//
//   node scripts/fitRiderTypesBaseline.js                # prod-fit + skriv JSON
//   node scripts/fitRiderTypesBaseline.js --fictional    # fiktiv-launch-fit + skriv JSON
//   node scripts/fitRiderTypesBaseline.js --dry-run      # vis tal, skriv ikke

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../lib/riderTypes.js";
import { generateFictionalRiders } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { LAUNCH_POPULATION } from "../lib/fictionalLaunchPopulation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const FICTIONAL = process.argv.includes("--fictional");
const OUT_PATH = join(__dirname, "../lib/riderTypesBaseline.json");

// Henter ability-rækker fra enten den fiktive launch-population (deterministisk,
// ingen DB) eller prod. Begge returnerer et array af ability-objekter (r[ability]).
async function getAbilityRows() {
  if (FICTIONAL) {
    const { seed, count, referenceYear } = LAUNCH_POPULATION;
    const { riders } = generateFictionalRiders({ seed, count, referenceYear });
    return riders.map((r, i) =>
      deriveAbilities({}, { ...r, id: `fic-${seed}-${i}` }, { asOfYear: referenceYear }));
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${ABILITY_KEYS.join(", ")}, riders!inner(is_retired)`)
      .eq("riders.is_retired", false)
      .order("rider_id"));
}

async function main() {
  const src = FICTIONAL
    ? `fiktiv launch-population (seed ${LAUNCH_POPULATION.seed}, count ${LAUNCH_POPULATION.count})`
    : "rider_derived_abilities (prod)";
  console.log(`=== Fit ryttertype-baseline ${DRY_RUN ? "(DRY-RUN)" : "(WRITE)"} — fra ${src} ===`);
  const rows = await getAbilityRows();
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

  console.log(`\nRyttere med abilities: ${n}`);
  console.log("ability          mean     std");
  for (const a of ABILITY_KEYS) {
    console.log(`  ${a.padEnd(13)} ${String(mean[a]).padStart(7)} ${String(std[a]).padStart(7)}`);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver ikke.");
    return;
  }
  const payload = {
    description: FICTIONAL
      ? "Population baseline (mean/std pr. game-ability) til ryttertype-z-score (#49/#1101). Fittet over den fiktive launch-population (LAUNCH_POPULATION) — relaunch #1105/#1122."
      : "Population baseline (mean/std pr. game-ability) til ryttertype-z-score (#49/#1101). Fittet over aktive ryttere i rider_derived_abilities.",
    population: FICTIONAL ? "fictional-launch" : "prod",
    n,
    mean,
    std,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\n✅ Skrev ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
