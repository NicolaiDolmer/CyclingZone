// Slice 09 — Seed race_pool fra CSV (idempotent)
//
// Brug: node backend/scripts/seedRacePool.js [path/to/csv] [--prune] [--dry-run]
// Default: scripts/race_pool_seed.csv
//
// Re-kør efter sheet-opdateringer for at upsert nye løb.
//
// --prune  (WS3 #1571): efter upsert, slet forældreløse pool-rækker hvis
//          external_id IKKE er i den aktuelle seed — men KUN rækker som ingen
//          races/whitelist peger på (FK-sikkert via computeStalePoolPrune).
//          Nødvendigt fordi external_id = hash(name+date), så omdøbte løb
//          INDSÆTTER nye rækker og efterlader de gamle real-navngivne rækker.
//          Default OFF: ren re-seed forbliver idempotent uden sletninger.
// --dry-run: print hvad der ville ske (upsert-antal + prune-plan) uden writes.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseRacePoolCsv, computeStalePoolPrune } from "../lib/racePoolImport.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const PRUNE = args.includes("--prune");
const DRY_RUN = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const csvPath = path.resolve(positional[0] || "scripts/race_pool_seed.csv");
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

if (DRY_RUN) {
  console.log(`[dry-run] ville upserte ${payload.length} pool-løb (ingen writes)`);
} else {
  const { data, error } = await supabase
    .from("race_pool")
    .upsert(payload, { onConflict: "external_id" })
    .select("id, external_id");

  if (error) {
    console.error("Supabase upsert fejlede:", error.message);
    process.exit(1);
  }
  console.log(`✔ Upserted ${data?.length || 0} pool-løb`);
}

// --prune (WS3 #1571): fjern forældreløse pool-rækker hvis external_id ikke længere
// er i seed-CSV'en (fx gamle real-navngivne løb efter omdøbning). FK-sikkert:
// rækker som et races-løb (pool_race_id) eller en sæson-whitelist peger på bevares.
if (PRUNE) {
  const seedExternalIds = new Set(rows.map((r) => r.external_id));

  // 1. Alle nuværende pool-rækker (pagineret — kataloget kan vokse).
  const poolRows = await fetchAllRows(() =>
    supabase.from("race_pool").select("id, external_id, name").order("id"),
  );

  // 2. Reference-sæt: race_pool.id som er FK-/whitelist-refereret.
  //    a) races.pool_race_id (ægte FK, ON DELETE SET NULL — men aldrig slet en
  //       række et løb peger på; det er reference-tab).
  const referencingRaces = await fetchAllRows(() =>
    supabase.from("races").select("pool_race_id").not("pool_race_id", "is", null).order("id"),
  );
  const referencedPoolIds = new Set(referencingRaces.map((r) => r.pool_race_id).filter(Boolean));

  //    b) seasons.stage_race_priority / single_race_boost (UUID-array-whitelists).
  const seasonWhitelists = await fetchAllRows(() =>
    supabase.from("seasons").select("id, stage_race_priority, single_race_boost").order("id"),
  );
  for (const s of seasonWhitelists) {
    for (const id of s.stage_race_priority || []) referencedPoolIds.add(id);
    for (const id of s.single_race_boost || []) referencedPoolIds.add(id);
  }

  const { toDelete, skippedReferenced, keptInSeed } = computeStalePoolPrune({
    seedExternalIds,
    poolRows,
    referencedPoolIds,
  });

  console.log(
    `[prune] pool=${poolRows.length} i-seed=${keptInSeed.length} ` +
      `forældreløse=${toDelete.length + skippedReferenced.length} ` +
      `→ slet=${toDelete.length} bevar-refereret=${skippedReferenced.length}`,
  );
  if (skippedReferenced.length > 0) {
    console.log(
      `[prune] bevarer ${skippedReferenced.length} forældreløse men refererede rækker:`,
    );
    for (const r of skippedReferenced) console.log(`  - ${r.name} (${r.id})`);
  }

  if (toDelete.length === 0) {
    console.log("[prune] ingen trygge sletninger — afslutter.");
  } else if (DRY_RUN) {
    console.log(`[dry-run] ville slette ${toDelete.length} forældreløse pool-rækker:`);
    for (const r of toDelete) console.log(`  - ${r.name} (${r.external_id})`);
  } else {
    const idsToDelete = toDelete.map((r) => r.id);
    const { error: delError } = await supabase.from("race_pool").delete().in("id", idsToDelete);
    if (delError) {
      console.error("Supabase prune-delete fejlede:", delError.message);
      process.exit(1);
    }
    console.log(`✔ Prunede ${idsToDelete.length} forældreløse pool-løb`);
  }
}
