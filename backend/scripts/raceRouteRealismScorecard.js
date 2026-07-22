#!/usr/bin/env node
// backend/scripts/raceRouteRealismScorecard.js
// GATEN (#2769): regenerér en sæsons profiler IN-MEMORY (rører INTET i DB) mod live-katalog
// og print scorecardet pr. tier. Bruges FØR nogen apply/regen.
//
//   node scripts/raceRouteRealismScorecard.js --season 2
//
// Regenererer via generateRaceStageProfiles (samme seed-kontekst som materializeren:
// external_id + terrain_archetype + season_id), så tallene matcher det en fuld regen ville give.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { scoreTier, scoreGrandTour } from "../lib/raceRouteRealismMetrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const seasonIdx = process.argv.indexOf("--season");
const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : 2;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE creds"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data: season } = await supabase.from("seasons").select("id").eq("number", SEASON).single();
  if (!season) throw new Error(`Sæson ${SEASON} ikke fundet`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  const tierByDiv = new Map(divisions.map((d) => [d.id, d.tier]));
  // Én pulje pr. tier (alle er identiske) — brug laveste div-id pr. tier.
  const onePoolByTier = new Map();
  for (const d of [...divisions].sort((a, b) => a.id - b.id)) if (!onePoolByTier.has(d.tier)) onePoolByTier.set(d.tier, d.id);
  const samplePools = new Set(onePoolByTier.values());

  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, { external_id: c.external_id, terrain_archetype: c.terrain_archetype }]));

  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, race_type, stages, pool_race_id, league_division_id").eq("season_id", season.id).order("id"));

  const byTier = new Map();
  for (const r of races) {
    if (!samplePools.has(r.league_division_id)) continue;
    const tier = tierByDiv.get(r.league_division_id);
    const meta = metaByPool.get(r.pool_race_id) || {};
    const seedRace = { ...r, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null, season_id: season.id };
    const stages = generateRaceStageProfiles(seedRace);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({ race_type: r.race_type, stages });
  }

  console.log(`\n=== Rute-realisme-scorecard — sæson ${SEASON} (in-memory regen, generator v4) ===\n`);
  let allPass = true;
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const s = scoreTier(tier, byTier.get(tier));
    allPass = allPass && s.pass;
    const mark = s.pass ? "✅" : "❌";
    console.log(`${mark} Tier ${tier}: summit=${s.summit_finishes} · M-Down=${s.mdown_pct}% · fritstående ITT=${s.standalone_itt} · brosten-i-etapeløb=${s.cobbles_in_stagerace} · dist-outliers=${s.distanceOutliers}`);
    if (!s.pass) console.log(`     BRUD: ${s.failures.join(" · ")}`);
    for (const r of byTier.get(tier)) {
      if (r.stages.length >= 21) {
        const gt = scoreGrandTour(r.stages);
        console.log(`     GT (${r.stages.length} et.): ${gt.totalKm} km · ${gt.categorizedClimbs} stigninger · ${gt.hcClimbs} HC ${gt.pass ? "✅" : "❌ " + gt.failures.join(", ")}`);
      }
    }
  }
  console.log(`\n${allPass ? "✅ GO — alle gatede tiers grønne" : "❌ NO-GO — mindst én tier under mål"}\n`);
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
