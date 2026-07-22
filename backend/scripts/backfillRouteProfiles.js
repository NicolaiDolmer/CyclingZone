#!/usr/bin/env node
// backend/scripts/backfillRouteProfiles.js
// Rute-ONLY backfill (#2769): UPDATE distance_km/elevation_gain_m/climbs/sprints/sectors på
// EKSISTERENDE race_stage_profiles-rækker, matchet på (race_id, stage_number). Bevarer
// profile_type/finale_type/demand_vector uændret. Idempotent. Rører IKKE races/scheduling/game_day.
// Springer håndredigerede løb (is_manual) over.
//
//   node scripts/backfillRouteProfiles.js --season 2 [--dry-run]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { attachRoute } from "../lib/raceRouteGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const seasonIdx = process.argv.indexOf("--season");
const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : null;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE creds"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  let seasonId = null;
  if (SEASON != null) {
    const { data } = await supabase.from("seasons").select("id").eq("number", SEASON).single();
    if (!data) throw new Error(`Sæson ${SEASON} ikke fundet`);
    seasonId = data.id;
  }
  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, name").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, { external_id: c.external_id, name: c.name }]));

  const races = await fetchAllRows(() => {
    let q = supabase.from("races").select("id, name, race_type, pool_race_id, season_id").order("id");
    if (seasonId) q = q.eq("season_id", seasonId);
    return q;
  });
  const raceById = new Map(races.map((r) => [r.id, r]));

  const profiles = await fetchAllRows(() =>
    supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type, finale_type, is_manual").order("race_id"));

  const manualRaceIds = new Set(profiles.filter((p) => p.is_manual).map((p) => p.race_id));
  let updated = 0, skippedManual = 0;
  for (const p of profiles) {
    const race = raceById.get(p.race_id);
    if (!race) continue; // profil for et andet sæson-løb
    if (manualRaceIds.has(p.race_id)) { skippedManual++; continue; }
    const meta = metaByPool.get(race.pool_race_id) || {};
    const seedRace = { ...race, external_id: meta.external_id ?? null, name: meta.name ?? race.name, season_id: race.season_id };
    const route = attachRoute(
      { stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, is_prolog: p.stage_number === 1 && p.profile_type === "itt" },
      seedRace, race.race_type === "stage_race",
    );
    if (!DRY_RUN) {
      const { error } = await supabase.from("race_stage_profiles")
        .update({ distance_km: route.distance_km, elevation_gain_m: route.elevation_gain_m, climbs: route.climbs, sprints: route.sprints, sectors: route.sectors })
        .eq("race_id", p.race_id).eq("stage_number", p.stage_number);
      if (error) throw new Error(`update ${p.race_id}/${p.stage_number}: ${error.message}`);
    }
    updated++;
  }
  console.log(`${DRY_RUN ? "(DRY-RUN) " : ""}Rute-felter ${DRY_RUN ? "ville opdatere" : "opdaterede"} ${updated} etaper${skippedManual ? ` (sprang ${skippedManual} håndredigerede over)` : ""}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
