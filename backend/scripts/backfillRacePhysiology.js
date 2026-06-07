#!/usr/bin/env node
// Race Engine V1 (#676) — backfill physiology + udledte abilities fra legacy stats.
//
// Kører mod den DB der peges på af env (SUPABASE_URL + SUPABASE_SERVICE_KEY,
// Infisical-injiceret eller backend/.env). Ikke-destruktivt: upsert pr. rider_id i
// to nye tabeller, idempotent → sikker at re-køre (fx efter FORMULA_VERSION-bump).
//
//   node scripts/backfillRacePhysiology.js                 # apply begge faser
//   node scripts/backfillRacePhysiology.js --dry-run       # beregn + rapportér, skriv intet
//   node scripts/backfillRacePhysiology.js --physiology-only
//
// Abilities percentil-skaleres mod hele pool'en, så pool bygges in-memory fra de
// netop seedede profiler (samme tal der upsertes) — ingen ekstra DB-roundtrip.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { STAT_KEYS } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy, FORMULA_VERSION } from "../lib/physiologySeeding.js";
import { deriveAbilities, FORMULA_VERSION as ABILITY_FORMULA_VERSION } from "../lib/abilityDerivation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const PHYSIOLOGY_ONLY = process.argv.includes("--physiology-only");
const UPSERT_BATCH = 500;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function upsertBatched(table, rows, onConflict) {
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert fejlede ved ${i}: ${error.message}`);
    n += batch.length;
    console.log(`  ✅ ${table} batch ${Math.floor(i / UPSERT_BATCH) + 1}: ${batch.length}`);
  }
  return n;
}

function spread(values) {
  const s = [...values].sort((a, b) => a - b);
  const avg = (s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(1);
  return `min ${s[0]} · median ${s[Math.floor(s.length / 2)]} · max ${s[s.length - 1]} · avg ${avg}`;
}

async function main() {
  console.log(`=== Race physiology + abilities backfill ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} ===`);

  const select = ["id", "height", "weight", "birthdate", "potentiale", ...STAT_KEYS].join(", ");
  const riders = await fetchAllRows(() =>
    supabase.from("riders").select(select).order("id", { ascending: true }),
  );
  console.log(`🔎 Hentede ${riders.length} ryttere.`);

  // ── Fase 1: physiology ──────────────────────────────────────────────────────
  const now = new Date().toISOString();
  let missingBody = 0;
  const profiles = riders.map((r) => {
    if (!r.height || !r.weight) missingBody++;
    return { ...seedPhysiologyFromLegacy(r), updated_at: now };
  });
  console.log(`\n📊 Physiology (formula_version=${FORMULA_VERSION}) — ${profiles.length} ryttere, ${missingBody} brugte default-krop`);
  console.log(`  ftp_wkg: ${spread(profiles.map((p) => p.ftp_wkg))}`);

  // ── Fase 2: udledte abilities (v2 — direkte fra PCM-stats, ingen pool) ──────
  let abilities = [];
  if (!PHYSIOLOGY_ONLY) {
    abilities = profiles.map((p, i) => ({ ...deriveAbilities(p, riders[i]), generated_at: now }));
    console.log(`\n📊 Abilities (formula_version=${ABILITY_FORMULA_VERSION}) — ${abilities.length} ryttere`);
    console.log(`  climbing: ${spread(abilities.map((a) => a.climbing))}`);
    console.log(`  sprint:   ${spread(abilities.map((a) => a.sprint))}`);
  }

  if (DRY_RUN) {
    console.log("\n🔍 DRY-RUN — ingen DB rørt. Kør uden --dry-run for at upserte.");
    return;
  }

  console.log("\n⬆️  Upserter physiology...");
  await upsertBatched("rider_physiology_profiles", profiles, "rider_id");
  if (!PHYSIOLOGY_ONLY) {
    console.log("⬆️  Upserter abilities...");
    await upsertBatched("rider_derived_abilities", abilities, "rider_id");
  }

  const after = await fetchAllRows(() =>
    supabase.from("rider_physiology_profiles").select("rider_id").order("rider_id", { ascending: true }),
  );
  console.log(`\n✅ Færdig. Physiology-profiler i DB: ${after.length}.`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
