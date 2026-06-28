#!/usr/bin/env node
// Backfill race_stage_profiles (#1102 slice 1).
//
// Idempotent + deterministisk: genererer terræn + demand_vector pr. etape for
// hvert løb via raceStageProfileGenerator.js (seed = løbets external_id, jf.
// seedIdentityFor) og persisterer dem. Samme rigtige løb → samme parcours i alle
// en divisions puljer; en re-run efter v2-fixet reparerer v1's pulje-divergens.
// Påvirker INTET i runtime endnu — race-simulatoren (slice 2) læser kolonnerne
// bag RACE_ENGINE_V2_ENABLED. Spiller-synlig visning er slice 3.
//
//   node scripts/backfillRaceStageProfiles.js              # alle løb
//   node scripts/backfillRaceStageProfiles.js --season 1   # kun sæson 1
//   node scripts/backfillRaceStageProfiles.js --dry-run    # vis fordeling + sample, skriv intet
//
// Håndredigerede løb (mindst én række med is_manual=true) springes HELT over, så
// kuratering aldrig overskrives. Øvrige løb: slet + genindsæt (idempotent, og
// håndterer at en races etape-antal er ændret).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles, GENERATOR_VERSION, PROFILE_TYPES } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const seasonIdx = process.argv.indexOf("--season");
const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : null;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function loadRaces() {
  let seasonId = null;
  if (SEASON != null) {
    const { data, error } = await supabase.from("seasons").select("id").eq("number", SEASON).single();
    if (error || !data) throw new Error(`Sæson ${SEASON} ikke fundet: ${error?.message}`);
    seasonId = data.id;
  }
  return fetchAllRows(() => {
    let q = supabase.from("races").select("id, name, race_type, stages, season_id, pool_race_id").order("id");
    if (seasonId) q = q.eq("season_id", seasonId);
    return q;
  });
}

// Katalog-meta pr. pool_race_id → { external_id (seed-identitet), terrain_archetype
// (terrænkarakter) }. Et løb uden pool_race_id (legacy/ad-hoc) får intet match →
// generatoren falder tilbage til race.id + generisk fordeling.
async function loadCatalogMeta() {
  const rows = await fetchAllRows(() =>
    supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  return new Map((rows || []).map((r) => [r.id, { external_id: r.external_id ?? null, terrain_archetype: r.terrain_archetype ?? null }]));
}

// race_id'er der har mindst én håndredigeret etape → spring løbet helt over.
async function loadManualRaceIds() {
  const rows = await fetchAllRows(() =>
    supabase.from("race_stage_profiles").select("race_id").eq("is_manual", true).order("race_id"));
  return new Set((rows || []).map((r) => r.race_id));
}

async function main() {
  console.log(`=== Backfill race_stage_profiles ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"}${SEASON != null ? ` — sæson ${SEASON}` : ""} — generator v${GENERATOR_VERSION} ===`);
  const races = await loadRaces();
  const catalogMeta = await loadCatalogMeta();
  const manualRaceIds = DRY_RUN ? new Set() : await loadManualRaceIds();

  const dist = Object.fromEntries(PROFILE_TYPES.map((p) => [p, 0]));
  const sample = [];
  let racesProcessed = 0;
  let racesSkippedManual = 0;
  let stageRowsWritten = 0;

  for (const race of races) {
    if (manualRaceIds.has(race.id)) { racesSkippedManual++; continue; }

    const meta = catalogMeta.get(race.pool_race_id) || {};
    // race.season_id er allerede på rækken → indgår i seed via seedKeyFor (sæson-akse).
    const seedRace = { ...race, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null };
    const profiles = generateRaceStageProfiles(seedRace);
    for (const p of profiles) dist[p.profile_type]++;
    if (sample.length < 12) {
      sample.push(`  ${race.name}${race.race_type === "stage_race" ? ` (${profiles.length} etaper)` : ""}: ${profiles.map((p) => p.profile_type).join(" → ")}`);
    }

    if (!DRY_RUN) {
      const { error: delErr } = await supabase.from("race_stage_profiles").delete().eq("race_id", race.id);
      if (delErr) throw new Error(`delete ${race.id}: ${delErr.message}`);
      const rows = profiles.map((p) => ({
        race_id: race.id,
        stage_number: p.stage_number,
        profile_type: p.profile_type,
        finale_type: p.finale_type,
        demand_vector: p.demand_vector,
        generator_version: GENERATOR_VERSION,
        is_manual: false,
      }));
      const { error: insErr } = await supabase.from("race_stage_profiles").insert(rows);
      if (insErr) throw new Error(`insert ${race.id}: ${insErr.message}`);
      stageRowsWritten += rows.length;
    } else {
      stageRowsWritten += profiles.length;
    }
    racesProcessed++;
  }

  console.log(`\nLøb behandlet: ${racesProcessed}${racesSkippedManual ? ` (sprang ${racesSkippedManual} håndredigerede over)` : ""}`);
  console.log(`Etape-rækker: ${stageRowsWritten}`);
  console.log("Terræn-fordeling (etaper):");
  for (const p of PROFILE_TYPES) {
    if (!dist[p]) continue;
    console.log(`  ${p.padEnd(14)} ${String(dist[p]).padStart(4)} (${((dist[p] / stageRowsWritten) * 100).toFixed(1).padStart(5)}%)`);
  }
  console.log("\nSample:");
  console.log(sample.join("\n"));

  if (DRY_RUN) console.log("\n(DRY-RUN) Skriver intet.");
  else console.log(`\n✅ Skrev ${stageRowsWritten} etape-rækker for ${racesProcessed} løb.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
