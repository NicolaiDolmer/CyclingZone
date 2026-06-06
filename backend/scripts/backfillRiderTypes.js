#!/usr/bin/env node
// Backfill riders.primary_type / secondary_type (#49).
//
// Idempotent + deterministisk: kører computeRiderTypes for hver rytter ud fra de
// 14 legacy stats + den fittede baseline (riderTypesBaseline.json) og skriver
// top-2 type-nøgler. Påvirker ikke økonomien — kolonnerne bruges kun til
// visning + filtrering.
//
//   node scripts/backfillRiderTypes.js            # apply
//   node scripts/backfillRiderTypes.js --dry-run  # beregn + vis fordeling, skriv ikke
//
// Kør fitRiderTypesBaseline.js først hvis populationen har ændret sig markant.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { computeRiderTypes, RIDER_TYPE_KEYS, STAT_KEYS } from "../lib/riderTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const BASELINE_PATH = join(__dirname, "../lib/riderTypesBaseline.json");
const WRITE_CONCURRENCY = 25;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

async function updateInBatches(updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, primary_type, secondary_type }) =>
        supabase.from("riders").update({ primary_type, secondary_type }).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
    if (written % 1000 < WRITE_CONCURRENCY) console.log(`  ✅ ${written}/${updates.length}`);
  }
  return written;
}

async function main() {
  console.log(`=== Backfill ryttertyper ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — baseline n=${baseline.n} ===`);
  const riders = await fetchAllRows(() =>
    supabase.from("riders").select(`id,${STAT_KEYS.join(",")}`).eq("is_retired", false).order("id"));

  const updates = [];
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  for (const r of riders) {
    const { primary, secondary } = computeRiderTypes(r, baseline);
    updates.push({ id: r.id, primary_type: primary.key, secondary_type: secondary.key });
    dist[primary.key]++;
  }

  console.log(`\nRyttere: ${riders.length}`);
  console.log("Primær-fordeling:");
  for (const k of RIDER_TYPE_KEYS) {
    console.log(`  ${k.padEnd(12)} ${String(dist[k]).padStart(5)} (${((dist[k] / riders.length) * 100).toFixed(1).padStart(5)}%)`);
  }

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver intet.");
    return;
  }
  const n = await updateInBatches(updates);
  console.log(`\n✅ Skrev primary_type/secondary_type for ${n} ryttere.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
