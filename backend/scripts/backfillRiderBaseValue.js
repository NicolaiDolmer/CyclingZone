#!/usr/bin/env node
// Backfill riders.base_value fra den fittede model (#1101) — SHADOW.
//
// Tynd CLI-wrapper om backend/lib/backfillCores.js → runBaseValueBackfill (#1103).
// Idempotent + deterministisk. Påvirker INTET i økonomien (kolonnen er ikke wired
// ind i price/market_value/salary før cutover, slice 2).
//
//   node scripts/backfillRiderBaseValue.js            # apply
//   node scripts/backfillRiderBaseValue.js --dry-run  # beregn + rapportér gammel vs ny
//
// Deterministisk: base_value afhænger kun af abilities + primary_type + den
// committede model (ingen alder/dato). Re-kør efter enhver re-fit/re-derive.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runBaseValueBackfill } from "../lib/backfillCores.js";

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
  console.log(`=== Backfill base_value ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} ===`);
  const s = await runBaseValueBackfill(supabase, { dryRun: DRY_RUN, log: console.log });
  console.log(
    `\n${DRY_RUN ? "(DRY-RUN) Skriver intet." : "✅ Skrev base_value."} ` +
    `Værdisat ${s.valued} · skrevet ${s.written}`
  );
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
