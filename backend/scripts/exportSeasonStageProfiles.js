#!/usr/bin/env node
// backend/scripts/exportSeasonStageProfiles.js
//
// Race Engine v4 head-to-head-harness (#4030, #3855): eksporterer HELE en
// sæsons kalender af race_stage_profiles-rækker som --stages-input til
// headToHeadV4.js. SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-
// intra-stage-design.md §5 + headToHeadV4.js's egen "fuld saeson-scope"-TODO
// (linje ~330): "hent race_stage_profiles-raekker for S3 (read-only SELECT)
// og feed dem ind som --stages".
//
// 100% READ-ONLY mod prod — kun SELECT. Ingen insert/update/delete/rpc.
//
// Dedup-strategi: en sæsons kalender kører IDENTISK på tværs af alle
// divisioner (samme pool_race_id = samme rute/demand_vector pr. etape, verificeret
// stikprøvevis 23/8) — kun races.id differerer pr. division-instans. Denne
// eksport tager derfor ÉN repræsentant-race pr. pool_race_id (mindste id,
// deterministisk), ikke alle ~470 race-raekker, så scorecardet maaler
// kalenderens FAKTISKE indholds-mangfoldighed uden at gentaelle identiske
// etaper 15x (én pr. division) og uden at blaese compute-tiden unoedigt op.
//
// Usage:
//   node backend/scripts/exportSeasonStageProfiles.js --season=3 [--out=path/to/file.json]

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllPaged, selectInChunks } from "../lib/dbChunk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL og/eller SUPABASE_SERVICE_KEY (se backend/.env).");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

const SEASON_NUMBER = Number(argValue("season", "3"));
const OUT_PATH = argValue("out")
  || join(REPO_ROOT, "backend", "scripts", "out", `season-${SEASON_NUMBER}-stage-profiles.json`);

/**
 * Reducerer en liste af races (samme season) til én repraesentant-race
 * pr. pool_race_id (mindste id — deterministisk, uafhaengig af hvilken
 * raekkefoelge Postgres returnerer i). Races uden pool_race_id (bør ikke
 * forekomme i S3, men defensivt) behandles hver som deres eget "pool" —
 * medtages individuelt, IKKE droppet.
 * @param {Array<{id:string, pool_race_id:string|null}>} races
 * @returns {Array<{id:string, pool_race_id:string|null}>}
 */
export function pickRepresentativeRaces(races) {
  const byPool = new Map();
  for (const r of races) {
    const key = r.pool_race_id ?? `__solo__:${r.id}`;
    const existing = byPool.get(key);
    if (!existing || String(r.id) < String(existing.id)) byPool.set(key, r);
  }
  return [...byPool.values()];
}

async function loadSeasonId(seasonNumber) {
  const { data, error } = await supabase.from("seasons").select("id, number").eq("number", seasonNumber).limit(1);
  if (error) throw new Error(`seasons-select fejlede: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`ingen season med number=${seasonNumber}`);
  return data[0].id;
}

async function loadSeasonRaces(seasonId) {
  const { data, error } = await fetchAllPaged(() =>
    supabase.from("races").select("id, name, race_type, stages, race_class, pool_race_id, game_day_start").eq("season_id", seasonId).order("id"),
  );
  if (error) throw new Error(`races-select fejlede: ${error.message}`);
  return data || [];
}

async function loadStageProfiles(raceIds) {
  const columns = [
    "race_id", "stage_number", "profile_type", "finale_type", "demand_vector",
    "distance_km", "elevation_gain_m", "climbs", "sprints", "sectors", "segments", "generator_version",
  ].join(", ");
  const { data, error } = await selectInChunks({ supabase, table: "race_stage_profiles", columns, inColumn: "race_id", ids: raceIds });
  if (error) throw new Error(`race_stage_profiles-select fejlede: ${error.message}`);
  return data || [];
}

async function main() {
  console.log(`Henter season ${SEASON_NUMBER}...`);
  const seasonId = await loadSeasonId(SEASON_NUMBER);

  console.log("Henter races (alle divisioner)...");
  const allRaces = await loadSeasonRaces(seasonId);
  console.log(`  ${allRaces.length} race-raekker total.`);

  const representatives = pickRepresentativeRaces(allRaces);
  console.log(`  ${representatives.length} unikke pool_race_id-repraesentanter (dedupet paa tvaers af divisioner).`);

  const stages = await loadStageProfiles(representatives.map((r) => r.id));
  console.log(`  ${stages.length} race_stage_profiles-raekker hentet.`);

  const missingDemandVector = stages.filter((s) => !s.demand_vector);
  if (missingDemandVector.length > 0) {
    console.log(`  ADVARSEL: ${missingDemandVector.length} etaper mangler demand_vector (v3-krav) — headToHeadV4.js vil kaste paa disse.`);
  }

  const nameByRaceId = new Map(representatives.map((r) => [r.id, r.name]));
  const output = {
    meta: {
      season_number: SEASON_NUMBER,
      season_id: seasonId,
      exported_at: new Date().toISOString(),
      race_count: representatives.length,
      stage_count: stages.length,
      dedup_strategy: "one representative race per pool_race_id (min id) — identical route/demand_vector verified across divisions 23/8",
    },
    stages: stages
      .map((s) => ({ ...s, race_name: nameByRaceId.get(s.race_id) ?? null }))
      .sort((a, b) => String(a.race_id).localeCompare(String(b.race_id)) || a.stage_number - b.stage_number),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output));
  console.log(`Output: ${OUT_PATH} (${stages.length} etaper, ${representatives.length} loeb)`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("exportSeasonStageProfiles.js")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
