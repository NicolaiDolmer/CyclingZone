#!/usr/bin/env node
// backend/scripts/simulateSeasonProduction.js
// Værdimodel v4 slice 1 (#2428), TRIN A — sæson-produktions-simulering.
//
// Kører den ÆGTE aktive sæsons løb-kalender gennem den ÆGTE, UÆNDREDE race-motor
// (buildRaceResults, raceRunner.js) mod den ÆGTE prod-population (real-population-
// prædikat, samme som exportPopulationSnapshot.js) — K deterministiske Monte
// Carlo-runs, in-memory. Skriver backend/lib/riderProductionSample.json
// (Kontrakt 1, se scratchpad v4-slice1-contracts.md).
//
// READ-ONLY mod prod (kun SELECT — INGEN insert/update/delete/rpc-mutationer).
// Rører ALDRIG database/*.sql, riderValuationModel.json (v3) eller
// riderValuation.predictBaseValue. v4 er en SEPARAT, parallel sti (shadow).
//
// Felt-tildeling (hvilke ryttere kører hvilke løb) er FAST på tværs af alle K
// runs — kun race-motorens interne per-etape-seed varierer per run (afledt af
// `${race.id}::mc${k}`, se seasonProductionSim.js's header-kommentar). Det giver
// "1 rytter = 1 løb/dag som i drift" og gør K-runs sammenlignelige (samme felt,
// forskelligt udfald), i stedet for K uafhængige felt-udtræk.
//
// Usage:
//   cd backend && node scripts/simulateSeasonProduction.js
//   node scripts/simulateSeasonProduction.js --k=30 --seed=2026 --v3 \
//        --out=lib/riderProductionSample.json --season=<uuid>
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, se backend/.env)

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { selectInChunks } from "../lib/dbChunk.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../lib/raceSimulator.js";
import { ABILITY_KEYS as VALUE_ABILITY_KEYS } from "../lib/riderTypes.js";
import { buildRaceResults } from "../lib/raceRunner.js";
import { buildRacePointsLookup, PRIZE_PER_POINT } from "../lib/raceResultsEngine.js";
import { riderOverall } from "../lib/riderValuation.js";
import {
  assignSeasonFields,
  computeRacesEnteredByRider,
  aggregateSeasonSamples,
} from "../lib/seasonProductionSim.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(`--${name}=`.length);
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const K = parseInt(arg("k", "30"), 10);
// BASE_SEED salter hele Monte Carlo-draw'et: hver races per-run-seed afledes af
// `${race.id}::s${BASE_SEED}:mc${k}` (se K-loopet nedenfor). Samme (population, K,
// seed, v3) → bit-identiske samples (determinisme-gate); forskellig --seed →
// uafhængige-men-reproducerbare sample-sæt (seed-robusthed i scorecardet).
const BASE_SEED = parseInt(arg("seed", "2026"), 10);
const V3_SCORING = !!arg("v3", false);
const OUT_PATH = resolve(arg("out", join(__dirname, "../lib/riderProductionSample.json")));
const SEASON_ARG = arg("season", null);

if (!Number.isFinite(K) || K < 1) {
  console.error(`❌ Ugyldig --k=${arg("k", "30")} (skal være et positivt heltal).`);
  process.exit(2);
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Mangler SUPABASE_URL og/eller SUPABASE_SERVICE_KEY (se backend/.env).");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// LAUNCH_REFERENCE_YEAR/ageForSeason spejler backend/lib/riderProgressionEngine.js
// PRÆCIST (samme formel: LAUNCH_REFERENCE_YEAR + (seasonNumber-1) - birthYear).
// Bevidst INLINET i stedet for importeret: riderProgressionEngine.js trækker en
// tung DB-orchestrator-modulkæde ind (notificationService, academyGraduation,
// dailyTrainingFlag, ...) for denne ene formel — ingen af dem eksekverer noget ved
// import (kun funktions-/const-eksport), så det ville have virket, men et rent,
// READ-ONLY sim-script bør ikke afhænge af hele den kæde for én linje matematik.
const LAUNCH_REFERENCE_YEAR = 2026;
function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  console.log(`🚴 Sæson-produktions-simulering (#2428 slice 1, TRIN A) — K=${K} seed=${BASE_SEED} v3=${V3_SCORING}`);
  console.log("   100% READ-ONLY mod prod (kun SELECT).\n");

  // ── 1. Load (I/O, ÉN gang) ─────────────────────────────────────────────

  let season;
  if (SEASON_ARG) {
    const { data, error } = await supabase.from("seasons").select("id, number").eq("id", SEASON_ARG).maybeSingle();
    if (error) throw new Error(`seasons: ${error.message}`);
    season = data;
  } else {
    const { data, error } = await supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle();
    if (error) throw new Error(`seasons: ${error.message}`);
    season = data;
  }
  if (!season) {
    console.error("❌ Ingen aktiv sæson fundet (og intet gyldigt --season=<id> angivet).");
    process.exit(1);
  }
  console.log(`Sæson ${season.number} (id=${season.id}).`);

  const races = await fetchAllRows(() => supabase
    .from("races")
    .select("id, race_type, race_class, stages, league_division_id, status")
    .eq("season_id", season.id)
    .order("id", { ascending: true }));
  console.log(`  ${races.length} løb i sæsonen.`);
  const raceIds = races.map((r) => r.id);

  // Stage-profiler pr. løb (chunked .in() — kan overstige IN_CHUNK_SIZE).
  const { data: stageProfilesRaw, error: spErr } = await selectInChunks({
    supabase, table: "race_stage_profiles",
    columns: "race_id, stage_number, profile_type, finale_type, demand_vector",
    inColumn: "race_id", ids: raceIds,
  });
  if (spErr) throw new Error(`race_stage_profiles: ${spErr.message}`);
  const stagesByRace = new Map();
  for (const s of stageProfilesRaw || []) {
    if (!stagesByRace.has(s.race_id)) stagesByRace.set(s.race_id, []);
    stagesByRace.get(s.race_id).push(s);
  }
  for (const arr of stagesByRace.values()) arr.sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));

  // game_day pr. (race, etape) — bruges til felt-tildelingens busy-set.
  const { data: scheduleRaw, error: schErr } = await selectInChunks({
    supabase, table: "race_stage_schedule",
    columns: "race_id, stage_number, game_day",
    inColumn: "race_id", ids: raceIds,
  });
  if (schErr) throw new Error(`race_stage_schedule: ${schErr.message}`);
  const gameDaysByRace = new Map();
  for (const s of scheduleRaw || []) {
    if (s.game_day == null) continue;
    if (!gameDaysByRace.has(s.race_id)) gameDaysByRace.set(s.race_id, new Set());
    gameDaysByRace.get(s.race_id).add(s.game_day);
  }

  // race_points pr. race_class → pointsLookup pr. løb (buildRacePointsLookup, ren).
  const raceClasses = [...new Set(races.map((r) => r.race_class).filter(Boolean))];
  const pointsByClass = new Map();
  for (const raceClass of raceClasses) {
    const { data, error } = await supabase.from("race_points").select("result_type, rank, points").eq("race_class", raceClass);
    if (error) throw new Error(`race_points (${raceClass}): ${error.message}`);
    pointsByClass.set(raceClass, data || []);
  }

  const racesEnriched = races.map((r) => ({
    id: r.id,
    race_type: r.race_type,
    race_class: r.race_class,
    league_division_id: r.league_division_id,
    stages: stagesByRace.get(r.id) || [],
    game_days: [...(gameDaysByRace.get(r.id) || [])].sort((a, b) => a - b),
    pointsLookup: buildRacePointsLookup({ racePoints: pointsByClass.get(r.race_class) || [], raceType: r.race_type }),
  }));
  const raceById = new Map(racesEnriched.map((r) => [r.id, r]));

  // ── Population (real-population-prædikat — spejler exportPopulationSnapshot.js) ──

  console.log("Henter hold (real-population)...");
  const teamsRaw = await fetchAllRows(() => supabase
    .from("teams")
    .select("id, is_test_account, is_frozen, is_bank, league_division_id")
    .order("id", { ascending: true }));
  const teamsIncluded = teamsRaw.filter((t) => !t.is_test_account && !t.is_frozen && !t.is_bank);
  console.log(`  ${teamsRaw.length} hold total → ${teamsIncluded.length} medtaget (ekskl. test/frosne/bank; AI MED).`);

  const teamsByDivision = new Map();
  for (const t of teamsIncluded) {
    if (t.league_division_id == null) continue;
    if (!teamsByDivision.has(t.league_division_id)) teamsByDivision.set(t.league_division_id, []);
    teamsByDivision.get(t.league_division_id).push(t.id);
  }

  console.log("Henter kandidat-ryttere (ikke-akademi, ikke-pensioneret, medtaget-hold)...");
  const includedTeamIds = new Set(teamsIncluded.map((t) => t.id));
  const ridersRaw = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, team_id, primary_type, birthdate")
    .eq("is_academy", false)
    .eq("is_retired", false)
    .not("team_id", "is", null)
    .order("id", { ascending: true }));
  const candidateRiders = ridersRaw.filter((r) => includedTeamIds.has(r.team_id));
  console.log(`  ${candidateRiders.length} kandidat-ryttere.`);

  console.log("Henter abilities (race-motorens 15 nøgler)...");
  const raceAbilityCols = ["rider_id", ...RACE_ABILITY_KEYS].join(", ");
  const { data: abilitiesRaw, error: abErr } = await selectInChunks({
    supabase, table: "rider_derived_abilities", columns: raceAbilityCols,
    inColumn: "rider_id", ids: candidateRiders.map((r) => r.id),
  });
  if (abErr) throw new Error(`rider_derived_abilities: ${abErr.message}`);
  const abilitiesByRider = new Map((abilitiesRaw || []).map((a) => [a.rider_id, a]));

  console.log("Henter condition (form/fatigue)...");
  const { data: conditionRaw, error: condErr } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, form, fatigue",
    inColumn: "rider_id", ids: candidateRiders.map((r) => r.id),
  });
  if (condErr) throw new Error(`rider_condition: ${condErr.message}`);
  const conditionByRider = new Map((conditionRaw || []).map((c) => [c.rider_id, c]));

  // riderRecordById: fulde 15-nøgle abilities + metadata, keyed for O(1)-opslag ved
  // artefakt-bygning. Ryttere UDEN abilities-række droppes (kan ikke scores) —
  // spejler loadEntrantsForRace's defensive skip (raceRunner.js:815).
  let excludedNoAbilities = 0;
  const riderRecordById = new Map();
  const ridersByTeam = new Map();
  for (const r of candidateRiders) {
    const abRow = abilitiesByRider.get(r.id);
    if (!abRow) { excludedNoAbilities++; continue; }
    const { rider_id: _rid, ...abilityValues } = abRow;
    const cond = conditionByRider.get(r.id);
    riderRecordById.set(r.id, {
      team_id: r.team_id,
      primary_type: r.primary_type ?? null,
      birthdate: r.birthdate,
      abilities: abilityValues,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
    });
    const entry = {
      rider_id: r.id,
      abilities: abilityValues,
      ...(cond?.form != null ? { form: cond.form } : {}),
      ...(cond?.fatigue != null ? { fatigue: cond.fatigue } : {}),
    };
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push(entry);
  }
  console.log(`  ${riderRecordById.size} ryttere har abilities (${excludedNoAbilities} ekskluderet: ingen abilities-række).\n`);

  // ── 2. Felt-tildeling (REN, ÉN gang, fast på tværs af alle K runs) ────────

  console.log("Tildeler startfelter (fast felt-tildeling, deterministisk)...");
  const { entrantsByRaceId, stats: assignStats } = assignSeasonFields({
    races: racesEnriched,
    teamsByDivision,
    ridersByTeam,
  });
  console.log(
    `  ${assignStats.races_included}/${assignStats.races_considered} løb fik et felt `
    + `(skip: ${assignStats.skipped_no_division} uden division, `
    + `${assignStats.skipped_no_stages_or_schedule} uden etape-profil/schedule, `
    + `${assignStats.skipped_no_candidate_teams} uden hold i division, `
    + `${assignStats.skipped_no_entrants} uden ledige ryttere).`
  );
  const racesEnteredByRider = computeRacesEnteredByRider(entrantsByRaceId);
  console.log(`  ${racesEnteredByRider.size} ryttere fik mindst ét løb.\n`);

  // ── 3. K deterministiske runs (buildRaceResults er ren — ingen DB) ────────

  console.log(`Kører ${K} Monte Carlo-runs over ${entrantsByRaceId.size} løb...`);
  const runsResultRows = [];
  for (let k = 0; k < K; k++) {
    const rowsThisRun = [];
    for (const [raceId, entrants] of entrantsByRaceId) {
      const race = raceById.get(raceId);
      // Defensiv dobbelt-guard (assignSeasonFields filtrerer allerede disse fra,
      // men skip her matcher kontraktens eksplicitte "skip races der ville kaste").
      if (!race?.stages?.length || !entrants.length) continue;
      const { resultRows } = buildRaceResults({
        // Seed-strøm pr. (race, run). BASE_SEED salter hele draw'et, så to kørsler
        // med forskellig --seed giver uafhængige-men-reproducerbare sample-sæt
        // (bruges til seed-robusthed/sensitivitet i scorecardet). buildRaceResults
        // hasher race.id internt via stableSeed — der er ingen ekstern seed-param,
        // så salt + run-index kodes ind i id-strengen (id bruges ellers kun til
        // seeding + række-tagging i et in-memory-only resultatsæt).
        race: { id: `${race.id}::s${BASE_SEED}:mc${k}`, race_type: race.race_type },
        stages: race.stages,
        entrants,
        pointsLookup: race.pointsLookup,
        v3: V3_SCORING,
      });
      rowsThisRun.push(...resultRows);
    }
    runsResultRows.push(rowsThisRun);
    if ((k + 1) % 10 === 0 || k === K - 1) {
      console.log(`  run ${k + 1}/${K} færdig (${rowsThisRun.length} resultat-rækker).`);
    }
  }

  // ── 4. Aggregér (REN) ─────────────────────────────────────────────────────

  console.log("\nAggregerer K runs pr. rytter...");
  const aggregates = aggregateSeasonSamples({ runsResultRows, racesEnteredByRider });

  // ── 5. Byg + skriv artefakt (Kontrakt 1) ──────────────────────────────────

  const samples = [];
  for (const [riderId, agg] of aggregates) {
    const rec = riderRecordById.get(riderId);
    if (!rec) continue; // defensivt — kan ikke ske (racesEnteredByRider stammer fra ridersByTeam)
    const valueAbilities = {};
    for (const key of VALUE_ABILITY_KEYS) valueAbilities[key] = rec.abilities[key] ?? null;
    samples.push({
      rider_id: riderId,
      primary_type: rec.primary_type,
      overall: riderOverall(rec.abilities),
      age: ageForSeason(rec.birthdate, season.number),
      abilities: valueAbilities,
      races_entered: agg.races_entered,
      e_points: round2(agg.e_points),
      e_prize: round2(agg.e_prize),
      sd_prize: round2(agg.sd_prize),
      p10_prize: round2(agg.p10_prize),
      p50_prize: round2(agg.p50_prize),
      p90_prize: round2(agg.p90_prize),
    });
  }
  samples.sort((a, b) => String(a.rider_id).localeCompare(String(b.rider_id)));

  const artifact = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    season_id: season.id,
    season_number: season.number,
    K,
    base_seed: BASE_SEED,
    v3_scoring: V3_SCORING,
    prize_per_point: PRIZE_PER_POINT,
    population: {
      riders: riderRecordById.size,
      teams: teamsIncluded.length,
      races: entrantsByRaceId.size,
      excluded_no_abilities: excludedNoAbilities,
    },
    samples,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`\n✅ Skrev ${samples.length} rytter-samples til ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(`❌ Fejl: ${err.stack || err.message}`);
  process.exit(1);
});
