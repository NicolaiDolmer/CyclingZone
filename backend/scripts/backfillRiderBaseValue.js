#!/usr/bin/env node
// Backfill riders.base_value fra den fittede model (#1101) — SHADOW.
//
// Idempotent + deterministisk: kører predictBaseValue for hver rytter med
// abilities og skriver base_value. Påvirker INTET i økonomien (kolonnen er ikke
// wired ind i price/market_value/salary før cutover, slice 2).
//
//   node scripts/backfillRiderBaseValue.js            # apply
//   node scripts/backfillRiderBaseValue.js --dry-run  # beregn + rapportér gammel vs ny
//
// asOf-datoen tages fra modellens fitted_at, så alder (og dermed base_value)
// er reproducerbar mellem fit og backfill.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { calculateRiderMarketValue } from "../lib/marketUtils.js";
import { predictBaseValue } from "../lib/riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL_PATH = join(__dirname, "../lib/riderValuationModel.json");
const WRITE_CONCURRENCY = 25;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
const asOf = model.fitted_at;

const pct = (sortedAsc, p) =>
  sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

async function updateInBatches(updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, base_value }) =>
        supabase.from("riders").update({ base_value }).eq("id", id).then(({ error }) => {
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
  console.log(`=== Backfill base_value ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — model ${model.fitted_at} (λ=${model.lambda}, R²=${model.cv_r2}) ===`);

  const [riders, abilities] = await Promise.all([
    fetchAllRows(() => supabase.from("riders").select("id, birthdate, potentiale, popularity, is_u25, uci_points, prize_earnings_bonus").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));

  const updates = [];
  let noAbilities = 0;
  const oldVals = [];
  const newVals = [];
  for (const r of riders) {
    const ab = abilityByRider.get(r.id);
    const bv = predictBaseValue(r, ab, model, { asOf });
    if (bv == null) { noAbilities++; continue; }
    updates.push({ id: r.id, base_value: bv });
    oldVals.push(calculateRiderMarketValue(r));
    newVals.push(bv);
  }

  oldVals.sort((a, b) => a - b);
  newVals.sort((a, b) => a - b);
  console.log(`\nRyttere: ${riders.length} · værdisat: ${updates.length} · uden abilities (springes): ${noAbilities}`);
  console.log("Fordeling (CZ$):           p10        median        p90          max");
  console.log(`  GAMMEL (uci): ${fmt(pct(oldVals, 0.1)).padStart(12)} ${fmt(pct(oldVals, 0.5)).padStart(12)} ${fmt(pct(oldVals, 0.9)).padStart(12)} ${fmt(oldVals[oldVals.length - 1]).padStart(12)}`);
  console.log(`  NY  (base):   ${fmt(pct(newVals, 0.1)).padStart(12)} ${fmt(pct(newVals, 0.5)).padStart(12)} ${fmt(pct(newVals, 0.9)).padStart(12)} ${fmt(newVals[newVals.length - 1]).padStart(12)}`);

  if (DRY_RUN) {
    console.log("\n(DRY-RUN) Skriver intet.");
    return;
  }
  const n = await updateInBatches(updates);
  console.log(`\n✅ Skrev base_value for ${n} ryttere.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
