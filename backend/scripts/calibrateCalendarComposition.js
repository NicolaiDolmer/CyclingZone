#!/usr/bin/env node
// backend/scripts/calibrateCalendarComposition.js
// #3295 fase B: find de filler-vægte der bringer den GENEREREDE kalender tættest på
// K-B-målprofilen — empirisk, ikke gættet. RØRER INTET I DB (kun SELECT).
//
//   node scripts/calibrateCalendarComposition.js --season 2
//   node scripts/calibrateCalendarComposition.js --season 2 --rounds 4
//   node scripts/calibrateCalendarComposition.js --season 2 --tilt '{"mountain":0.6,"itt":2}'   # evaluér ét tilt
//
// SÅDAN MÅLES DET
// Hver kandidat-tilt køres gennem den FULDE generator-pipeline på sæsonens faktiske
// løbssæt (alle fire tiers, én repræsentativ pulje hver) og scores på TO ting samtidig:
//
//   1. K-B-afstanden — summen af absolutte afvigelser i procentpoint, plus en straf for
//      hver kategori der ligger uden for ±2 pp.
//   2. Realisme-båndene (#2755/#2769/#3347) — summit-finaler, M-Down-andel, fritstående
//      ITT, brosten i etapeløb, GT'ernes km/stigninger/HC.
//
// BEGGE, fordi de trækker mod hinanden: K-B vil have bjerg NED fra 32,9 % til 28 %, mens
// tier 3's realisme-bånd kræver mindst 8 summit-finaler og 78 % af dem kommer fra kun 4
// summit_tour-løb (raceRouteRealismMetrics.js-docstringen). Et tilt der rammer K-B ved at
// udsulte bjergene er ikke en løsning — det er at flytte problemet. Realisme-brud straffes
// derfor HÅRDT i scoren, så søgningen ikke kan købe komposition for realisme.
//
// Determinisme: ingen RNG i søgningen (koordinat-descent fra neutral tilt, fast step-liste).
// Samme sæson + samme katalog → samme anbefaling.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles, ARCHETYPE_PROFILES } from "../lib/raceStageProfileGenerator.js";
import { resolveSeasonDraw } from "../lib/raceRouteRealismDraw.js";
import { scoreSeason } from "../lib/raceRouteRealismMetrics.js";
import {
  ACTIVE_TARGET, COMPOSITION_CATEGORIES, CATEGORY_LABELS, COMPOSITION_TOLERANCE_PP,
  computeCompositionStats, aggregateCompositionStats,
} from "../lib/calendarCompositionTargets.js";
import {
  NEUTRAL_TILT, applyCompositionTilt, compositionDistance, worstDeviation, searchTilt,
} from "../lib/calendarCompositionCalibration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

// Straf pr. procentpoint uden for tolerancen. Skal være stor nok til at søgningen
// foretrækker "alle inden for ±2 pp" over "meget lav sum, men én kategori 3 pp ude".
export const OUT_OF_BAND_PENALTY = 5;
// Straf pr. realisme-båndbrud. Sat markant højere end noget kompositions-bidrag: et
// brud på et bånd ejeren allerede har godkendt må ALDRIG kunne handles væk for et
// pænere kompositions-tal.
export const REALISM_BREACH_PENALTY = 100;
// Vægt på den GENNEMSNITLIGE tier-afvigelse. En spiller ser sin egen divisions kalender,
// ikke sæson-gennemsnittet — et tilt der rammer 24/32/28 samlet ved at give tier 1
// 20 % flad og tier 4 37 % bjerg har ikke løst noget for nogen. Vægten er under 1, så
// sæson-aggregatet stadig fører, men tier-spredningen kan bryde et uafgjort.
export const TIER_SPREAD_WEIGHT = 0.5;

/**
 * Læs sæsonens løbssæt (én repræsentativ pulje pr. tier) — samme udvalg som
 * raceRouteRealismScorecard.js måler på. READ-ONLY.
 */
export async function loadSeedRacesByTier({ supabase, seasonNumber }) {
  const { data: season } = await supabase.from("seasons").select("id").eq("number", seasonNumber).single();
  if (!season) throw new Error(`Season ${seasonNumber} not found`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  const tierByDiv = new Map(divisions.map((d) => [d.id, d.tier]));
  const onePoolByTier = new Map();
  for (const d of [...divisions].sort((a, b) => a.id - b.id)) if (!onePoolByTier.has(d.tier)) onePoolByTier.set(d.tier, d.id);
  const samplePools = new Set(onePoolByTier.values());

  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, c]));

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
  return [...byTier.keys()].sort((a, b) => a - b).map((tier) => ({ tier, seedRaces: byTier.get(tier) }));
}

/**
 * Kør den fulde pipeline for ét kandidat-tilt og score det.
 * Ren funktion af (tierSeedRaces, tilt) — al DB-læsning er sket på forhånd.
 */
export function evaluateTilt({ tierSeedRaces, tilt, target = ACTIVE_TARGET, skipArchetypes = [] }) {
  const profiles = applyCompositionTilt({ tilt, skipArchetypes });
  const generateProfiles = (race) => generateRaceStageProfiles(race, { archetypeProfiles: profiles });

  // Samme re-draw-maskineri som skrive-stien: tilt'et skal vurderes på det parcours der
  // FAKTISK ville blive persisteret, ikke på attempt 0.
  const draws = resolveSeasonDraw({ tierSeedRaces, generateProfiles });
  const realism = scoreSeason(draws.map((d) => d.entry));

  const tierStats = draws.map((d) => ({ tier: d.tier, stats: computeCompositionStats(d.entry.races) }));
  const season = aggregateCompositionStats(tierStats.map((t) => t.stats));

  const l1 = compositionDistance(season.pct, target);
  const { worst, category: worstCategory } = worstDeviation(season.pct, target);
  const outOfBand = COMPOSITION_CATEGORIES.filter((c) => Math.abs((season.pct[c] ?? 0) - (target[c] ?? 0)) > COMPOSITION_TOLERANCE_PP);
  const outOfBandPp = outOfBand.reduce((s, c) => s + (Math.abs((season.pct[c] ?? 0) - (target[c] ?? 0)) - COMPOSITION_TOLERANCE_PP), 0);

  // Tier-spredning: gennemsnitlig L1 pr. tier. Vægtes ind, så søgningen ikke kan opnå et
  // pænt sæson-tal ved at lade tiers trække i hver sin retning og udligne hinanden.
  const tierL1 = tierStats.map((t) => compositionDistance(t.stats.pct, target));
  const tierSpread = tierL1.length ? tierL1.reduce((a, b) => a + b, 0) / tierL1.length : 0;

  const score = l1
    + OUT_OF_BAND_PENALTY * outOfBandPp
    + REALISM_BREACH_PENALTY * realism.failures.length
    + TIER_SPREAD_WEIGHT * tierSpread;

  return {
    score, l1, worst, worstCategory, outOfBand, tierSpread,
    season, tierStats, draws,
    realismFailures: realism.failures, realismUnassessed: realism.unassessed, realismVerdict: realism.verdict,
  };
}

function formatComposition(pct, target) {
  return COMPOSITION_CATEGORIES.map((c) => {
    const d = (pct[c] ?? 0) - (target[c] ?? 0);
    const flag = Math.abs(d) > COMPOSITION_TOLERANCE_PP ? "!" : " ";
    return `${CATEGORY_LABELS[c]} ${(pct[c] ?? 0).toFixed(1)}${flag}`;
  }).join(" · ");
}

export function formatReport({ seasonNumber, baseline, best, tilt, evaluations, target }) {
  const lines = [
    ``,
    `=== Kompositions-kalibrering — sæson ${seasonNumber} (${evaluations} evalueringer, ingen DB-skrivning) ===`,
    ``,
    `Mål:      ${COMPOSITION_CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} ${target[c]}`).join(" · ")}`,
    `Baseline: ${formatComposition(baseline.season.pct, target)}`,
    `          L1 ${baseline.l1.toFixed(1)} pp · tier-spredning ${baseline.tierSpread.toFixed(1)} pp · værste ${CATEGORY_LABELS[baseline.worstCategory] ?? "-"} ${baseline.worst.toFixed(1)} pp · ${baseline.outOfBand.length} uden for ±${COMPOSITION_TOLERANCE_PP} pp · realisme ${baseline.realismVerdict}`,
    `Bedste:   ${formatComposition(best.season.pct, target)}`,
    `          L1 ${best.l1.toFixed(1)} pp · tier-spredning ${best.tierSpread.toFixed(1)} pp · værste ${CATEGORY_LABELS[best.worstCategory] ?? "-"} ${best.worst.toFixed(1)} pp · ${best.outOfBand.length} uden for ±${COMPOSITION_TOLERANCE_PP} pp · realisme ${best.realismVerdict}`,
    ``,
    `Fundet tilt: ${JSON.stringify(tilt)}`,
    ``,
    `Pr. tier med bedste tilt:`,
  ];
  for (const t of best.tierStats) {
    lines.push(`  tier ${t.tier} (${t.stats.raceDays} dage): ${formatComposition(t.stats.pct, target)}`);
  }
  if (best.realismFailures.length) {
    lines.push(``, `❌ Realisme-brud med bedste tilt (${best.realismFailures.length}):`);
    for (const f of best.realismFailures) lines.push(`   · ${f}`);
  } else {
    lines.push(``, `✅ Realisme-båndene holder med bedste tilt (verdict ${best.realismVerdict}).`);
  }
  if (best.outOfBand.length) {
    lines.push(
      ``,
      `⚠ ${best.outOfBand.length} kategori(er) kan IKKE nås med filler-vægte alene: ${best.outOfBand.map((c) => CATEGORY_LABELS[c]).join(", ")}.`,
      `  Filler-vægte kan kun omfordele inden for det KATALOGET forsyner. Rest-gappet kræver`,
      `  enten katalog-udvidelse (flere løb med den ønskede arketype) eller en strukturel`,
      `  garanti-ændring — begge er designvalg, ikke noget en søgning må afgøre selv.`,
    );
  }
  lines.push(``);
  return lines;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argOf = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
  const seasonNumber = Number(argOf("--season") ?? 2);
  const rounds = Number(argOf("--rounds") ?? 3);
  const fixedTilt = argOf("--tilt");
  const skipArchetypes = (argOf("--skip") ?? "").split(",").filter(Boolean);

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ Missing SUPABASE creds"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const tierSeedRaces = await loadSeedRacesByTier({ supabase, seasonNumber });
    const evaluate = (tilt) => evaluateTilt({ tierSeedRaces, tilt, skipArchetypes });

    const baseline = evaluate(NEUTRAL_TILT);
    if (fixedTilt) {
      const tilt = { ...NEUTRAL_TILT, ...JSON.parse(fixedTilt) };
      const best = evaluate(tilt);
      for (const l of formatReport({ seasonNumber, baseline, best, tilt, evaluations: 2, target: ACTIVE_TARGET })) console.log(l);
    } else {
      const search = searchTilt({
        evaluate, rounds,
        onProgress: ({ round, axis, score }) => console.log(`  runde ${round}: ${axis} → score ${score.toFixed(2)}`),
      });
      for (const l of formatReport({ seasonNumber, baseline, best: search.result, tilt: search.tilt, evaluations: search.evaluations, target: ACTIVE_TARGET })) console.log(l);
    }
    // Rapport-script: exit 0 medmindre den kastede. Gate-beslutningen hører til
    // calendarCompositionScorecard.js, ikke her.
    process.exitCode = 0;
  } catch (e) {
    console.error(e);
    process.exitCode = 2;
  }
}

export { ARCHETYPE_PROFILES };
