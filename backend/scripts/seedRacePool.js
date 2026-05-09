// Slice 09 — Seed race_pool fra CSV (idempotent)
//
// Brug: node backend/scripts/seedRacePool.js [path/to/csv]
// Default: scripts/race_pool_seed.csv
//
// Re-kør efter sheet-opdateringer for at upsert nye løb.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseRacePoolCsv } from "../lib/racePoolImport.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const csvPath = path.resolve(process.argv[2] || "scripts/race_pool_seed.csv");
if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV ikke fundet: ${csvPath}`);
}

const csvText = fs.readFileSync(csvPath, "utf8");
const { rows, errors } = parseRacePoolCsv(csvText);

console.log(`Parsed ${rows.length} rækker fra ${csvPath}`);
if (errors.length > 0) {
  console.log(`⚠ ${errors.length} parse-fejl:`);
  for (const err of errors) {
    console.log(`  L${err.line}: ${err.reason}${err.name ? ` (${err.name})` : ""}`);
  }
}

if (rows.length === 0) {
  console.log("Ingen gyldige rækker — afslutter uden writes.");
  process.exit(0);
}

const now = new Date().toISOString();
const payload = rows.map((r) => ({ ...r, updated_at: now }));

const { data, error } = await supabase
  .from("race_pool")
  .upsert(payload, { onConflict: "external_id" })
  .select("id, external_id");

if (error) {
  console.error("Supabase upsert fejlede:", error.message);
  process.exit(1);
}

console.log(`✔ Upserted ${data?.length || 0} pool-løb`);
