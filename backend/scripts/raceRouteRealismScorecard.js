#!/usr/bin/env node
// backend/scripts/raceRouteRealismScorecard.js
// GATEN (#2769): regenerér en sæsons profiler IN-MEMORY (rører INTET i DB) mod live-katalog
// og print scorecardet pr. tier. Bruges FØR nogen apply/regen.
//
//   node scripts/raceRouteRealismScorecard.js --season 2              (plan-tilstand)
//   node scripts/raceRouteRealismScorecard.js --season 3 --mod-prod   (prod-tilstand)
//
// TO TILSTANDE — og de måler IKKE det samme (#4219):
//
//   PLAN (default): regenerér profilerne in-memory via generateRaceStageProfiles (samme
//     seed-kontekst som materializeren: external_id + terrain_archetype + season_id).
//     Svarer på "ville en fuld regen give en lovlig kalender?". Kræver intet skrevet i
//     DB og er derfor den eneste tilstand der giver mening FØR en apply/regen — og i CI.
//
//   --mod-prod: læs `races` + `race_stage_profiles` for sæsonen og score DE rækker.
//     Svarer på "er den kalender der FAKTISK står i basen lovlig?".
//
// #4219, fundet 25/8 under S3-ombygningen: kun plan-tilstanden fandtes, og gaten meldte
// NO-GO med 5 båndbrud mens den skrevne kalender opfyldte alle fire bånd. Det kostede
// tre unødvendige wipe/regen-runder. Konsekvensen går begge veje, og den anden vej er
// værre: et reparations-script eller ad-hoc-SQL kan ændre den LIVE kalender uden at
// plan-tilstanden opdager det — præcis #4155-fejlklassen, hvor TIER_OVERLAP_CAP blev
// brudt i alle fire divisioner uopdaget. Gaten skal køre BEGGE steder; forskellen
// mellem dem er netop der fejlene gemmer sig (#4176 punkt 3).
//
// EXIT-KONTRAKT (#2854 — tre udfald, ikke to):
//   0 = GO      · hver gatet delscore (tier-bånd OG GT-bånd) kørte og bestod.
//   1 = NO-GO   · mindst én delscore kørte og fejlede sit bånd.
//   2 = UKENDT  · gaten kunne ikke vurdere det den skal vurdere (0 løb, ukendt tier,
//                 en GT der ikke kan måles, generator-/DB-fejl). Aldrig GO på tomt grundlag.
// Kun exit 0 er grønt lys; 1 og 2 blokerer begge, men fortæller forskellige ting.
//
// #3347: gaten scorer tierens RESOLVEREDE træk (raceRouteRealismDraw.js) — dvs. det
// deterministiske gen-træk skrive-stierne også vil persistere. Gaten er UÆNDRET hård:
// er alle gen-træk brugt uden at båndene holder, scores det kanoniske træk og verdicten
// bliver NO-GO (exit 1). Re-draw fjerner terningkastet, ikke kravet.
//
// Data-laget (collectSeasonTierRaces) og render-laget (formatScorecard) er eksporteret,
// så gatens beslutning kan testes uden DB (jf. audit-league-size-invariant.js).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles, GENERATOR_VERSION } from "../lib/raceStageProfileGenerator.js";
import { scoreSeason } from "../lib/raceRouteRealismMetrics.js";
import { resolveSeasonDraw } from "../lib/raceRouteRealismDraw.js";

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
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({ ...r, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null, season_id: season.id });
  }

  // #3347: gaten scorer det træk der FAKTISK ville blive persisteret — dvs. tierens
  // deterministiske re-draw-variant, ikke altid attempt 0. Skrive-stierne
  // (tierCalendarMaterializer / backfillRaceStageProfiles) løser variantet med SAMME
  // rene funktion, så scorecardet og databasen aldrig kan komme til at måle hver sit
  // parcours. Selve generator-fejl-kontrakten (#2854) bor nu i drawTierAttempt: et løb
  // der kaster bogføres som "kunne ikke vurderes", aldrig tavst væk.
  const draws = resolveSeasonDraw({
    tierSeedRaces: [...byTier.keys()].sort((a, b) => a - b).map((tier) => ({ tier, seedRaces: byTier.get(tier) })),
    generateProfiles,
  });
  return draws.map((d) => ({ ...d.entry, draw: { attempt: d.attempt, exhausted: d.exhausted, attemptsTried: d.attemptsTried, firstDrawFailures: d.firstDrawFailures } }));
}

/**
 * #4219 PROD-TILSTAND: læs den SKREVNE kalender (races + race_stage_profiles) og
 * returnér samme form som collectSeasonTierRaces, så scoreSeason/formatScorecard er
 * uændrede. READ-ONLY.
 *
 * Forskelle fra plan-tilstanden, bevidst:
 *   · Ingen generator kaldes. Der er intet gen-træk (#3347) at rapportere, så `draw`
 *     udelades — et re-draw hører til en plan, ikke til rækker der allerede står skrevet.
 *   · `race_class` hentes med. Plan-tilstanden henter den ikke, så dens `_race_class` er
 *     null og distance-outliers falder tilbage på det brede profil-bånd. Prod-tilstanden
 *     måler mod det snævrere klasse-bånd. Kun advisory, gater ikke — men de to
 *     tilstande kan derfor rapportere forskelligt antal outliers på samme kalender.
 *   · Et løb uden profil-rækker er IKKE nul etaper. Det er fravær af evidens og bogføres
 *     som "kunne ikke vurderes" (exit 2), aldrig som et bånd der bestod på tom luft
 *     (#2854). Præcis den fejl gaten findes for at undgå.
 */
export async function collectSeasonTierRacesFromDb({ supabase, seasonNumber }) {
  const { data: season } = await supabase.from("seasons").select("id").eq("number", seasonNumber).single();
  if (!season) throw new Error(`Sæson ${seasonNumber} ikke fundet`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  const tierByDiv = new Map(divisions.map((d) => [d.id, d.tier]));
  // Samme én-pulje-pr-tier-stikprøve som plan-tilstanden: alle puljer i en tier har
  // identisk løbssæt, og seed-nøglen er division-uafhængig → identisk parcours.
  const onePoolByTier = new Map();
  for (const d of [...divisions].sort((a, b) => a.id - b.id)) if (!onePoolByTier.has(d.tier)) onePoolByTier.set(d.tier, d.id);
  const samplePools = new Set(onePoolByTier.values());

  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, { external_id: c.external_id, terrain_archetype: c.terrain_archetype }]));

  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, race_type, race_class, stages, pool_race_id, league_division_id").eq("season_id", season.id).order("id"));
  const sampled = races.filter((r) => samplePools.has(r.league_division_id));
  const sampledIds = new Set(sampled.map((r) => r.id));

  // fetchAllRows: 1.239 etaper i S3 er langt over PostgREST's 1000-row-loft, og en
  // trunkeret side ville gøre en GT for kort → falsk "kan ikke vurderes", eller værre,
  // et for lavt km-tal der scorer som båndbrud. Stabil order på (race_id, stage_number).
  const profileRows = await fetchAllRows(() =>
    supabase.from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, distance_km, elevation_gain_m, climbs, sprints")
      .order("race_id").order("stage_number"));
  const stagesByRace = new Map();
  for (const prof of profileRows) {
    if (!sampledIds.has(prof.race_id)) continue;
    if (!stagesByRace.has(prof.race_id)) stagesByRace.set(prof.race_id, []);
    stagesByRace.get(prof.race_id).push(prof);
  }
  for (const list of stagesByRace.values()) list.sort((a, b) => a.stage_number - b.stage_number);

  const byTier = new Map();
  for (const r of sampled) {
    const tier = tierByDiv.get(r.league_division_id);
    const meta = metaByPool.get(r.pool_race_id) || {};
    if (!byTier.has(tier)) byTier.set(tier, { tier, races: [], errors: [] });
    const stages = stagesByRace.get(r.id) || [];
    if (!stages.length) {
      byTier.get(tier).errors.push(`Løb ikke vurderet: ${r.name ?? r.id} har ingen race_stage_profiles-rækker — kalenderen er skrevet, profilerne er ikke`);
      continue;
    }
    byTier.get(tier).races.push({
      ...r, stages,
      external_id: meta.external_id ?? null,
      terrain_archetype: meta.terrain_archetype ?? null,
      season_id: season.id,
    });
  }
  return [...byTier.keys()].sort((a, b) => a - b).map((t) => byTier.get(t));
}

/**
 * Render-lag: summary → linjer. Ren funktion, så outputtet kan asserteres i test.
 * tierEntries er valgfri og bruges KUN til at rapportere #3347's re-draw-varianter —
 * et re-draw må aldrig ske i tavshed.
 */
export function formatScorecard(summary, seasonNumber, tierEntries = [], mode = "plan") {
  const modeLabel = mode === "prod"
    ? "MOD PROD — den skrevne kalender (races + race_stage_profiles)"
    : `plan — in-memory regen, generator v${GENERATOR_VERSION}`;
  const lines = [`\n=== Rute-realisme-scorecard — sæson ${seasonNumber} (${modeLabel}) ===\n`];
  const redrawn = tierEntries.filter((t) => t.draw && (t.draw.attempt > 0 || t.draw.exhausted));
  for (const t of redrawn) {
    if (t.draw.exhausted) {
      lines.push(`⚠ Tier ${t.tier}: alle ${t.draw.attemptsTried} deterministiske gen-træk brød båndene — scorecardet viser det kanoniske træk (#3347).`);
    } else {
      lines.push(`↻ Tier ${t.tier}: kanonisk træk brød båndene (${t.draw.firstDrawFailures.join(" · ")}) → gen-træk ${t.draw.attempt} valgt deterministisk (#3347).`);
    }
  }
  if (redrawn.length) lines.push("");
  for (const t of summary.tiers) {
    const s = t.score;
    const mark = t.gateState === "gated" ? (s.pass ? "✅" : "❌") : t.gateState === "advisory" ? "–" : "⚠";
    const suffix = t.gateState === "advisory" ? " [ikke gatet — #2755 sætter ingen mål for tieren]"
      : t.gateState === "undefined" ? " [UKENDT TIER — ingen mål i TIER_TARGETS]" : "";
    lines.push(`${mark} Tier ${t.tier}${suffix}: summit=${s.summit_finishes} · M-Down=${s.mdown_pct}% · fritstående ITT=${s.standalone_itt} · brosten-i-etapeløb=${s.cobbles_in_stagerace} · dist-outliers=${s.distanceOutliers}${s.distanceOutliers ? " (advisory)" : ""}`);
    if (t.gateState === "gated" && !s.pass) lines.push(`     BRUD: ${s.failures.join(" · ")}`);
    for (const gt of t.grandTours) {
      const label = gt.name ? `«${gt.name}» ` : "";
      lines.push(`     GT ${label}(${gt.stageCount} et.): ${gt.totalKm} km · ${gt.categorizedClimbs} stigninger · ${gt.hcClimbs} HC ${gt.pass ? "✅" : "❌ " + gt.failures.join(", ")}`);
    }
  }

  if (summary.advisories.length) {
    lines.push(`\nAdvisory (gater IKKE):`);
    for (const a of summary.advisories) lines.push(`   · ${a}`);
  }
  if (summary.unassessed.length) {
    lines.push(`\n⚠ Kunne ikke vurderes (${summary.unassessed.length}):`);
    for (const u of summary.unassessed) lines.push(`   · ${u}`);
  }
  if (summary.failures.length) {
    lines.push(`\n❌ Brud (${summary.failures.length}):`);
    for (const f of summary.failures) lines.push(`   · ${f}`);
  }

  const headline = {
    GO: `✅ GO — ${summary.gatedTiersEvaluated} gatede tiers + ${summary.grandToursEvaluated} grand tours grønne (exit 0)`,
    "NO-GO": `❌ NO-GO — ${summary.failures.length} båndbrud (exit 1)`,
    UKENDT: `⚠ KUNNE IKKE VURDERES — ${summary.unassessed.length} delscore(r) uden datagrundlag; gaten kan hverken sige GO eller NO-GO (exit 2)`,
  }[summary.verdict];
  lines.push(`\n${headline}\n`);
  return lines;
}

// ---------------------------------------------------------------------------
// CLI entry — kun når scriptet køres direkte (ikke ved import i tests).
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const seasonIdx = process.argv.indexOf("--season");
  const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : 2;
  // #4219: default er UÆNDRET plan-tilstand. Prod-tilstanden skal vælges bevidst — et
  // scorecard der stille skiftede måle-grundlag ville være værre end de to separate.
  const MODE = process.argv.includes("--mod-prod") ? "prod" : "plan";

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  // Manglende creds/DB-fejl = "kunne ikke vurderes" (exit 2), ikke "bånd brudt" (exit 1).
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ KUNNE IKKE VURDERES — Missing SUPABASE creds"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // process.exitCode + naturligt exit i stedet for process.exit(): et hårdt exit
  // med åbne supabase-handles fælder libuv på Windows med exit 127, hvilket ville
  // gøre exit-kontrakten ovenfor til et løfte scriptet ikke holder.
  try {
    const tierEntries = MODE === "prod"
      ? await collectSeasonTierRacesFromDb({ supabase, seasonNumber: SEASON })
      : await collectSeasonTierRaces({ supabase, seasonNumber: SEASON });
    const summary = scoreSeason(tierEntries);
    for (const line of formatScorecard(summary, SEASON, tierEntries, MODE)) console.log(line);
    process.exitCode = summary.exitCode;
  } catch (e) {
    console.error(e);
    console.error("\n⚠ KUNNE IKKE VURDERES — scorecardet nåede aldrig en verdict (exit 2)");
    process.exitCode = 2;
  }
}
