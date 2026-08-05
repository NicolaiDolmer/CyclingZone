#!/usr/bin/env node
// Backfill riders.primary_type / secondary_type (#49 / #1101-kæden).
//
// Tynd CLI-wrapper om backend/lib/backfillCores.js → runRiderTypesBackfill (#1103).
// Idempotent + deterministisk: computeRiderTypes pr. rytter ud fra dens
// ability_caps (POTENTIALE, #3325 — ikke de nuværende evner) + den caps-fittede
// baseline.
//
// ØKONOMISK SIDE-EFFEKT (#3325, ikke længere "kun visning"): predictBaseValue
// bruger primary_type som en kategorisk offset (riderValuation.js), så en type-
// ændring HER flytter base_value/market_value på næste refreshChangedRiderValues-
// sweep (daglig trænings-tick / API-kald), selvom ingen abilities ændrede sig.
// Kør IKKE denne backfill uden at have læst PR-beskrivelsen for #3325's målte
// værdi-pyramide-forskydning (fictionalLaunchPopulation.test.js).
//
//   node scripts/backfillRiderTypes.js            # apply
//   node scripts/backfillRiderTypes.js --dry-run  # beregn + vis fordeling, skriv ikke

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runRiderTypesBackfill } from "../lib/backfillCores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`=== Backfill ryttertyper ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — fra rider_derived_abilities ===`);
  const s = await runRiderTypesBackfill(supabase, { dryRun: DRY_RUN, log: console.log });
  console.log(
    `\n${DRY_RUN ? "🔍 DRY-RUN — skriver intet." : "✅ Færdig."} ` +
    `Ryttere ${s.riders} · skrevet ${s.written}`
  );
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
