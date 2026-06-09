#!/usr/bin/env node
// Race Engine V1 (#676) — backfill physiology + udledte abilities fra legacy stats.
//
// Tynd CLI-wrapper om backend/lib/backfillCores.js → runPhysiologyBackfill (#1103).
// Kerne-logikken (beregning + upsert) bor nu i lib'en, så relaunch-orchestratoren
// og dette script deler ÉN implementering. Ikke-destruktivt: upsert pr. rider_id i
// to nye tabeller, idempotent → sikker at re-køre.
//
//   node scripts/backfillRacePhysiology.js                 # apply begge faser
//   node scripts/backfillRacePhysiology.js --dry-run       # beregn + rapportér, skriv intet
//   node scripts/backfillRacePhysiology.js --physiology-only

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runPhysiologyBackfill } from "../lib/backfillCores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const PHYSIOLOGY_ONLY = process.argv.includes("--physiology-only");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log(`=== Race physiology + abilities backfill ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} ===`);
  const s = await runPhysiologyBackfill(supabase, {
    dryRun: DRY_RUN,
    physiologyOnly: PHYSIOLOGY_ONLY,
    log: console.log,
  });
  console.log(
    `\n${DRY_RUN ? "🔍 DRY-RUN — ingen DB rørt." : "✅ Færdig."} ` +
    `Ryttere ${s.riders} · profiler ${s.profiles} · abilities ${s.abilities} · skrevet ${s.written}`
  );
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
