#!/usr/bin/env node
// backend/scripts/raceRouteRealismScorecard.js
// GATEN (#2769): regenerér en sæsons profiler IN-MEMORY (rører INTET i DB) mod live-katalog
// og print scorecardet pr. tier. Bruges FØR nogen apply/regen.
//
//   node scripts/raceRouteRealismScorecard.js --season 2
//
// Regenererer via generateRaceStageProfiles (samme seed-kontekst som materializeren:
// external_id + terrain_archetype + season_id), så tallene matcher det en fuld regen ville give.
//
// Data-laget (collectSeasonTierRaces) og render-laget (formatScorecard) er eksporteret,
// så gatens beslutning kan testes uden DB (jf. audit-league-size-invariant.js).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { scoreSeason } from "../lib/raceRouteRealismMetrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

/**
 * Læser sæsonens kalender og regenererer profilerne in-memory (READ-ONLY).
 * Én pulje pr. tier er nok: alle puljer i en tier har identisk løbssæt, og
 * seed-nøglen (external_id::season_id) er division-uafhængig → identisk parcours.
 */
export async function collectSeasonTierRaces({ supabase, seasonNumber, generateProfiles = generateRaceStageProfiles }) {
  const { data: season } = await supabase.from("seasons").select("id").eq("number", seasonNumber).single();
  if (!season) throw new Error(`Sæson ${seasonNumber} ikke fundet`);

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
    const stages = generateProfiles(seedRace);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({ name: r.name, race_type: r.race_type, terrain_archetype: seedRace.terrain_archetype, stages });
  }

  return [...byTier.keys()].sort((a, b) => a - b).map((tier) => ({ tier, races: byTier.get(tier) }));
}

/** Render-lag: summary → linjer. Ren funktion, så outputtet kan asserteres i test. */
export function formatScorecard(summary, seasonNumber) {
  const lines = [`\n=== Rute-realisme-scorecard — sæson ${seasonNumber} (in-memory regen, generator v4) ===\n`];
  for (const t of summary.tiers) {
    const s = t.score;
    const mark = s.pass ? "✅" : "❌";
    lines.push(`${mark} Tier ${t.tier}: summit=${s.summit_finishes} · M-Down=${s.mdown_pct}% · fritstående ITT=${s.standalone_itt} · brosten-i-etapeløb=${s.cobbles_in_stagerace} · dist-outliers=${s.distanceOutliers}`);
    if (!s.pass) lines.push(`     BRUD: ${s.failures.join(" · ")}`);
    for (const gt of t.grandTours) {
      lines.push(`     GT (${gt.stageCount} et.): ${gt.totalKm} km · ${gt.categorizedClimbs} stigninger · ${gt.hcClimbs} HC ${gt.pass ? "✅" : "❌ " + gt.failures.join(", ")}`);
    }
  }
  lines.push(`\n${summary.verdict === "GO" ? "✅ GO — alle gatede tiers grønne" : "❌ NO-GO — mindst én tier under mål"}\n`);
  return lines;
}

// ---------------------------------------------------------------------------
// CLI entry — kun når scriptet køres direkte (ikke ved import i tests).
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const seasonIdx = process.argv.indexOf("--season");
  const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : 2;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE creds"); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const tierEntries = await collectSeasonTierRaces({ supabase, seasonNumber: SEASON });
    const summary = scoreSeason(tierEntries);
    for (const line of formatScorecard(summary, SEASON)) console.log(line);
    process.exit(summary.exitCode);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
