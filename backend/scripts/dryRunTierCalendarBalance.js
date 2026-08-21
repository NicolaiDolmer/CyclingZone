#!/usr/bin/env node
// #3327/#3328 dry-run — mål Division 2's kalender-mix FØR/EFTER de nye dæknings-
// garantier, mod det ÆGTE race_pool-katalog. 100% read-only: buildTierMaterializationPlan
// er ren (ingen DB), og selv "apply"-siden kaldes ALDRIG her — kun .select()-kald mod
// Supabase (league_divisions/teams/race_pool), ingen writes nogen steder. Rører ALDRIG
// den live sæson-2-kalender.
//
// FØR = samme selection-algoritme som produktionskoden kørte MED før denne PR (ét
// sammenlagt størrelses-sorteret prestige-walk, intet klasse↔længde-bånd) — kørt på det
// AKTUELLE katalog, så FØR/EFTER er en ren A/B på samme data (ikke en sammenligning mod en
// historisk generering på et ældre katalog-snapshot).
// EFTER = de nye #3327/#3328-garantier (data i tierCalendarGuarantees.js).
//
//   node scripts/dryRunTierCalendarBalance.js
//
// Kræver SUPABASE_URL + SUPABASE_SERVICE_KEY i backend/.env (samme som server.js).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildTierMaterializationPlan } from "../lib/tierCalendarMaterializer.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { computeTierCoverageStats, CLASS_STAGE_LENGTH_BAND } from "../lib/tierCalendarGuarantees.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env"), quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler i backend/.env.");
  process.exit(1);
}
const supabase = createClient(url, key);

// --with-expansion: tilføj den FORESLÅEDE (IKKE-appliede) katalog-udvidelse fra
// database/2026-08-04-3327-3328-race-pool-expansion.sql IN-MEMORY (rører intet i DB) for at
// måle den PROJICEREDE effekt — race_pool mangler i dag nok WorldTour B/C-etapeløb til at
// D2 kan få reel WorldTour-tilstedeværelse, fordi tier 1 (D1, klasse-whitelist=null) æder
// stort set hele den eksisterende WT-B/C-forsyning som filler under GT/Monuments/OWA FØR
// tier 2 overhovedet vælger (cross-tier-dedup: øverste tier vælger først). Se PR-body.
const WITH_EXPANSION = process.argv.includes("--with-expansion");
const CATALOG_EXPANSION = [
  { id: "exp-owb-1", external_id: "26a1914e9391d46f", name: "Ronde van Limburg", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 7, terrain_archetype: "balanced_week" },
  { id: "exp-owb-2", external_id: "7c89cea334c5dd5c", name: "Tour du Massif Central", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 6, terrain_archetype: "mountain_tour" },
  { id: "exp-owb-3", external_id: "8e16015cf1f35207", name: "Settimana Ligure", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 7, terrain_archetype: "hilly_tour" },
  { id: "exp-owb-4", external_id: "c654f5de25847b55", name: "Bayern Rundfahrt", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 6, terrain_archetype: "sprinters_week" },
  { id: "exp-owb-5", external_id: "b82d89d64e488328", name: "Tour de Bretagne", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 6, terrain_archetype: "cobbled_tour" },
  { id: "exp-owb-6", external_id: "92e05a8bd2376062", name: "Volta a Portugal Maior", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 8, terrain_archetype: "summit_tour" },
  { id: "exp-owc-1", external_id: "94d0a93648e19393", name: "Tour of Scandinavia", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 6, terrain_archetype: "balanced_week" },
  { id: "exp-owc-2", external_id: "1d1063f10467a909", name: "Kroatien Rundfahrt", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 7, terrain_archetype: "sprinters_week" },
  { id: "exp-owc-3", external_id: "8abd38ba643bc1bc", name: "Tour de Tunisie", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 7, terrain_archetype: "sprinter_tour_summits" },
  { id: "exp-owc-4", external_id: "bd5d230bce30433a", name: "Ronde van Nederland Maior", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 6, terrain_archetype: "cobbled_tour" },
  { id: "exp-owc-5", external_id: "3175cdde86ba575c", name: "Vuelta a Murcia Mayor", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 8, terrain_archetype: "mountain_tour" },
  { id: "exp-owb-od-1", external_id: "6a7e48230d6d4983", name: "Scheldeprijs Groot", race_class: "OtherWorldTourB", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic" },
  { id: "exp-owb-od-2", external_id: "f9036e873eb0bfbf", name: "Grote Prijs Jef Scherens", race_class: "OtherWorldTourB", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic" },
  { id: "exp-owc-od-1", external_id: "d88ec518fff5a605", name: "Handzame Classic", race_class: "OtherWorldTourC", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic" },
  { id: "exp-owc-od-2", external_id: "80c642a40efe81fc", name: "Le Samyn Groot", race_class: "OtherWorldTourC", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic" },
];

const FROM = new Date("2026-01-01T00:00:00Z"); // vilkårlig — kun brugt til scheduling-tider, ikke målt her.

// ── 1. Læs read-only kildedata ────────────────────────────────────────────────
const { data: divisions, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
const { data: teams, error: tErr } = await supabase.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
if (tErr) throw new Error(`teams: ${tErr.message}`);
const { data: catalogRaw, error: cErr } = await supabase.from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages").is("retired_at", null);
if (cErr) throw new Error(`race_pool: ${cErr.message}`);
const catalog = WITH_EXPANSION ? [...(catalogRaw || []), ...CATALOG_EXPANSION] : catalogRaw;

const isReal = (t) => t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
const realByDiv = new Map();
for (const t of teams || []) if (isReal(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

console.log(`\n${"═".repeat(90)}`);
console.log(`#3327/#3328 DRY-RUN — Division 2 kalender-rebalance, mod ${WITH_EXPANSION ? "UDVIDET (projiceret, IKKE appliet)" : "ÆGTE"} race_pool (${(catalog || []).length} løb)`);
console.log(`${"═".repeat(90)}`);

// ── 2. Byg FØR-planen (gammel adfærd: intet mix-target, intet klasse↔længde-bånd) ──
const { tierPlans: beforePlans } = buildTierMaterializationPlan({
  pools, catalog: catalog || [], from: FROM,
  oneDayShareTargets: {}, classStageLengthBand: null, priorityArchetypes: null,
});

// ── 3. Byg EFTER-planen (produktions-default: #3327/#3328-garantierne) ──
const { tierPlans: afterPlans } = buildTierMaterializationPlan({ pools, catalog: catalog || [], from: FROM });

// ── 4. Mål — samme stil som #3327/#3328's audit-SQL (én repræsentativ pulje pr. tier,
// da alle puljer i en tier deler identisk kalender) ──
const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));

function measure(tierPlans) {
  const byTier = new Map();
  for (const tp of tierPlans) {
    const repPool = tp.pools[0];
    if (!repPool) continue;
    const profilesByPoolRaceId = new Map();
    for (const r of repPool.raceRows) {
      const seedRace = {
        id: r.pool_race_id, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
        season_id: "dry-run-3327",
      };
      profilesByPoolRaceId.set(r.pool_race_id, generateRaceStageProfiles(seedRace));
    }
    const stats = computeTierCoverageStats({ raceRows: repPool.raceRows, profilesByPoolRaceId, classStageLengthBand: CLASS_STAGE_LENGTH_BAND });

    // Klasse → etapeantal-fordeling (kun etapeløb).
    const byClass = new Map();
    for (const r of repPool.raceRows.filter((x) => x.race_type === "stage_race")) {
      if (!byClass.has(r.race_class)) byClass.set(r.race_class, []);
      byClass.get(r.race_class).push(r.stages);
    }
    const classSummary = [...byClass.entries()].map(([rc, stagesArr]) => ({
      race_class: rc, n: stagesArr.length,
      min: Math.min(...stagesArr), avg: (stagesArr.reduce((a, b) => a + b, 0) / stagesArr.length), max: Math.max(...stagesArr),
    }));

    byTier.set(tp.tier, {
      quota: tp.quota, totalGameDays: tp.totalGameDays, quotaHit: tp.quotaHit, shortfall: tp.shortfall,
      calendarViolations: tp.calendarViolations, stats, classSummary,
    });
  }
  return byTier;
}

const before = measure(beforePlans);
const after = measure(afterPlans);

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const row = (label, b, a) => console.log(`  ${label.padEnd(38)} ${String(b).padStart(10)}   →   ${String(a).padStart(10)}`);

for (const tier of [1, 2, 3, 4]) {
  const b = before.get(tier), a = after.get(tier);
  if (!b || !a) continue;
  console.log(`\n── Tier ${tier} ${tier === 2 ? "(Division 2 — kerne-target for #3327/#3328)" : ""} ──────────────────────`);
  row("Kvote (game-days)", b.quota, a.quota);
  row("Total game-days ramt", b.totalGameDays, a.totalGameDays);
  row("Shortfall (uopfyldt kvote)", b.shortfall, a.shortfall);
  row("Endagsløb", b.stats.oneDayRaces, a.stats.oneDayRaces);
  row("Etapeløb", b.stats.stageRaces, a.stats.stageRaces);
  row("Andel endagsløb", pct(b.stats.oneDayShare), pct(a.stats.oneDayShare));
  row("Brosten-etaper (cobbles)", b.stats.familyCounts.cobbles, a.stats.familyCounts.cobbles);
  row("Classic-etaper (rapport-kolonne)", b.stats.classicStages, a.stats.classicStages);
  row("Flad/sprint-etaper", b.stats.familyCounts.flat_sprint, a.stats.familyCounts.flat_sprint);
  row("ITT-etaper", b.stats.familyCounts.itt, a.stats.familyCounts.itt);
  row("Kuperet-etaper (hilly)", b.stats.familyCounts.hilly, a.stats.familyCounts.hilly);
  row("Etapeløb UDEN bjerg-etape", b.stats.mountainFreeStageRaces, a.stats.mountainFreeStageRaces);
  row("Klasse↔længde-bånd-brud", b.stats.classBandViolations.length, a.stats.classBandViolations.length);
  console.log(`  ${"Etapeantal pr. klasse (EFTER)".padEnd(38)}`);
  for (const c of a.classSummary.sort((x, y) => x.race_class.localeCompare(y.race_class))) {
    console.log(`    ${c.race_class.padEnd(20)} n=${String(c.n).padStart(3)}  min=${c.min}  avg=${c.avg.toFixed(2)}  max=${c.max}`);
  }
  if (a.calendarViolations.length) {
    console.log(`  ⚠️  EFTER-planen har ${a.calendarViolations.length} violation(s) (apply ville NÆGTES):`);
    for (const v of a.calendarViolations) console.log(`      - ${v}`);
  } else {
    console.log(`  ✅ EFTER-planen har 0 violations — alle #3327/#3328-garantier opfyldt for tier ${tier}.`);
  }
}

console.log(`\n${"═".repeat(90)}\n`);
