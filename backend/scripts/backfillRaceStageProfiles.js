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
import { generateRaceStageProfiles, balanceFinaleQuotas, GENERATOR_VERSION, PROFILE_TYPES, toStageProfileRow } from "../lib/raceStageProfileGenerator.js";
import { resolveVariantByRaceId } from "../lib/raceRouteRealismDraw.js";

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
    let q = supabase.from("races").select("id, name, race_type, stages, season_id, pool_race_id, league_division_id").order("id");
    if (seasonId) q = q.eq("season_id", seasonId);
    return q;
  });
}

async function loadTierByDivision() {
  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  return new Map((divisions || []).map((d) => [d.id, d.tier]));
}

// #3347: hvilken re-draw-variant hører hvert løb til? Uden det ville en backfill
// overskrive gatens træk med det kanoniske og gøre realisme-scorecardet til en løgn.
// Grupperings-reglen (pr. season_id+tier, laveste pulje som repræsentant) bor i
// raceRouteRealismDraw.js, så scorecardet, materializeren og backfill'ene deler den.
async function loadVariantByRaceId(races, catalogMeta, tierByDivision) {
  return resolveVariantByRaceId({
    races, catalogMeta, tierByDivision,
    onDraw: ({ seasonId, tier, draw }) => {
      if (draw.attempt > 0) console.log(`  ↻ sæson ${seasonId} tier ${tier}: kanonisk træk brød realisme-båndene (${draw.firstDrawFailures.join(" · ")}) → gen-træk ${draw.attempt} (#3347)`);
      if (draw.exhausted) console.log(`  ⚠ sæson ${seasonId} tier ${tier}: alle ${draw.attemptsTried} gen-træk brød båndene — bruger det kanoniske træk (#3347)`);
    },
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

// #5405: finale-typerne i en sæsons pulje er kvote-fordelt over puljens løbssæt
// (balanceFinaleQuotas) — det kan et træk pr. løb ikke genskabe. Uden dette ville en
// backfill tavst skrive frie finaler over dem materializeren skrev, og realisme-gaten ville
// have målt et andet parcours end det der står i basen.
//
// Grupperet pr. (season_id, pulje), ikke pr. tier: normalt kører alle puljer i en tier
// samme løbssæt (#2276), og fordelingen er deterministisk og uafhængig af rækkefølgen, så
// hver pulje får præcis de samme finaler. Men en pulje der aktiveres midt i sæsonen (§2e)
// kan have sit EGET løbssæt, og materializeren fordelte finalerne over netop det sæt. En
// tier-repræsentant ville give den puljes løb et andet sæts fordeling (fundet af CodeRabbit).
const raceKey = (race, tierByDivision) => {
  const tier = tierByDivision.get(race.league_division_id);
  return tier == null || !race.season_id || !race.pool_race_id
    ? null
    : `${race.season_id}|${race.league_division_id}|${race.pool_race_id}`;
};

function poolProfilesByRaceKey(races, tierByDivision, seedRaceOf) {
  const racesByPool = new Map();
  for (const r of races) {
    if (raceKey(r, tierByDivision) == null) continue;
    const pool = `${r.season_id}|${r.league_division_id}`;
    if (!racesByPool.has(pool)) racesByPool.set(pool, []);
    racesByPool.get(pool).push(r);
  }
  const out = new Map();
  for (const poolRaces of racesByPool.values()) {
    const balanced = balanceFinaleQuotas(poolRaces.map((r) => generateRaceStageProfiles(seedRaceOf(r))));
    poolRaces.forEach((r, i) => out.set(raceKey(r, tierByDivision), balanced[i]));
  }
  return out;
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
  const tierByDivision = await loadTierByDivision();
  const variantByRaceId = await loadVariantByRaceId(races, catalogMeta, tierByDivision);
  const seedRaceOf = (race) => {
    const meta = catalogMeta.get(race.pool_race_id) || {};
    // race.season_id er allerede på rækken → indgår i seed via seedKeyFor (sæson-akse).
    // season_variant (#3347) = tierens resolverede re-draw, samme tal som gaten scorer.
    return { ...race, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null, season_variant: variantByRaceId.get(race.id) ?? 0 };
  };
  const poolProfiles = poolProfilesByRaceKey(races, tierByDivision, seedRaceOf);

  const dist = Object.fromEntries(PROFILE_TYPES.map((p) => [p, 0]));
  const sample = [];
  let racesProcessed = 0;
  let racesSkippedManual = 0;
  let stageRowsWritten = 0;

  for (const race of races) {
    if (manualRaceIds.has(race.id)) { racesSkippedManual++; continue; }

    // #5405: et sæson-løb får puljens profiler (finaler kvote-fordelt over puljens løbssæt,
    // som materializeren skrev dem). Løb uden sæson/division genereres alene, som før.
    const profiles = poolProfiles.get(raceKey(race, tierByDivision)) ?? generateRaceStageProfiles(seedRaceOf(race));
    for (const p of profiles) dist[p.profile_type]++;
    if (sample.length < 12) {
      sample.push(`  ${race.name}${race.race_type === "stage_race" ? ` (${profiles.length} etaper)` : ""}: ${profiles.map((p) => p.profile_type).join(" → ")}`);
    }

    if (!DRY_RUN) {
      const { error: delErr } = await supabase.from("race_stage_profiles").delete().eq("race_id", race.id);
      if (delErr) throw new Error(`delete ${race.id}: ${delErr.message}`);
      const rows = profiles.map((p) => toStageProfileRow(race.id, p));
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
