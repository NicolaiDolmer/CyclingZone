#!/usr/bin/env node
// Backfill riders.primary_type / secondary_type (#49 / #1101-kæden).
//
// Tynd CLI-wrapper om backend/lib/backfillCores.js → runRiderTypesBackfill (#1103).
// Idempotent + deterministisk: computeRiderTypes pr. aktive rytter ud fra dens
// game-abilities + den fittede baseline. Påvirker ikke økonomien — kolonnerne
// bruges kun til visning + filtrering.
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
