#!/usr/bin/env node
// backend/scripts/dev/recomposeSeason3Stages4103.mjs
//
// #4103 (ejer-beslutning 23/8, kommentar samme dag 16:05): S3's etape-komposition er
// skæv PÅ TVÆRS AF DIVISIONER — samme mål (ITT 10 % · brosten 5 % · high_mountain 12 %,
// målt som andel af DIVISIONENS EGNE løbsdage, alle etaper inkl. endagsløb i nævneren)
// skal gælde i alle 4 divisioner. Målt 23/8 (se PR-body/dry-run-rapporten for tallene):
// ITT spredte sig 1,8 %–15,5 %, brosten 1,8 %–8,3 %, high_mountain 4,5 %–19,6 %.
//
// KUN etaper INDE I ETAPELØB (races.stages > 1, race_type='stage_race') må skifte
// profiltype. Endagsløb, navne, datoer, race_stage_schedule, antal etaper RØRES ALDRIG
// — det er den bindende ramme fra ejer-beslutningen, håndhævet ved at endagsløb aldrig
// optræder som konverterings-kandidater nedenfor (de tælles KUN i nævneren).
//
// ── Puljedublet-invariant (#2276) ───────────────────────────────────────────────────
// Alle puljer i én tier kører IDENTISK løbssæt med IDENTISK parcours (samme rigtige løb,
// samme seed-identitet — jf. seedIdentityFor i raceStageProfileGenerator.js). Et løb er
// derfor en GRUPPE af races-rækker (én pr. pulje i tieren) der deler race_pool.id
// (pool_race_id). Enhver ændring anvendes på ALLE gruppens medlemmer identisk, ellers
// brydes puljeparallel-garantien (verificeret 23/8: alle 36 tier-3-grupper havde
// byte-identiske profile_type-sekvenser på tværs af deres 4 puljer, FØR denne kørsel).
//
// ── Måltal pr. division (#4103/calendarCompositionTargets.js) ──────────────────────
// targetCount(tier, kategori) = nærmeste multiplum af GRUPPESTØRRELSEN (antal puljer i
// tieren: 1/2/4/8) til round(tierTotalDays × fraktion). Multiplum-kravet er strukturelt
// nødvendigt: enhver ægte ændring rammer ALLE en gruppes puljekopier på én gang, så det
// opnåelige antal berørte løbsdage i en tier er ALTID et multiplum af gruppestørrelsen.
//
// ── Udvalgsregler (deterministisk, seed pr. løbs-identitet) ────────────────────────
// Se markdown-rapportens "Regler"-sektion / PR-body for den fulde tekst (identisk med
// ejer-beslutningens ordlyd 23/8). Kort:
//   ITT tilføj:    flad/rolling → itt (itt_hilly i mountain_tour/summit_tour). Cap 2
//                  (GT, stages≥15) / 1 (kortere). Aldrig to ITT i træk. Prolog/midte foretrukket.
//   ITT fjern:     itt/itt_hilly → flad/rolling (seedet 70/30-vægt). Behold ≥1 i GT'er
//                  (stages≥15) og itt-bundne arketyper (grand_tour/balanced_week/
//                  sprinter_tour_summits).
//   Brosten tilføj: flad → cobbles. Maks 1 pr. løb. Ikke i summit_tour.
//   Brosten fjern: cobbles → flad. Ikke i cobbled_tour (identitet).
//   HM tilføj:     mountain → high_mountain i mountain_tour/grand_tour/summit_tour.
//                  Aldrig ny nabo-high_mountain (ingen forlængede blokke). Finale foretrukket.
//   HM fjern:      high_mountain → mountain/hilly (alternerende). Behold ≥1 pr.
//                  summit_tour/grand_tour (identitet).
// Kan et gab ikke lukkes uden at bryde disse regler, rapporteres gabet — der tvinges ALDRIG.
//
// ── Rute/finale/demand_vector ────────────────────────────────────────────────────────
// Genererede 100 % via generatorens EGNE funktioner (finaleFor/DEMAND_VECTORS fra
// raceStageProfileGenerator.js, attachRoute fra raceRouteGenerator.js,
// attachSegmentsAndWeather fra routeSegments.js) — ingen håndskrevne vektorer/climbs.
// season_variant løses via resolveVariantByRaceId (samme funktion backfill/materializer
// bruger), så ruten ligger på SAMME re-draw-akse som resten af tierens etaper.
// finale_type bruger en DEDIKERET rng-strøm (":recompose4103:<etape>") — rører aldrig
// pass 1/pass 2/segments/weather-strømmene for andre (urørte) etaper.
//
// ── Skrivning ────────────────────────────────────────────────────────────────────────
// UPDATE by id (race_stage_profiles.id), kun de berørte rækker. is_manual=true (samme
// kontrakt som convertHillyToMountainClassics.js): en FREMTIDIG backfillRaceStageProfiles-
// kørsel springer disse rækker over i stedet for at rulle dem tilbage.
//
// Idempotent: planen genberegnes fra LIVE DB-state hver kørsel — en 2. kørsel finder
// diff=0 for allerede-lukkede gab og skriver intet ekstra.
//
// Robusthed mod reorderShortStageRaces3371.mjs (kører EFTER dette script, bytter
// stage_number i korte etapeløb): dette script identificerer rækker udelukkende via
// FRISK hentede (race_id, stage_number)-par fra DB ved kørselstidspunktet — ingen
// hardkodede stage_number-antagelser uden for selve valg-heuristikkerne (som selv kun
// bruger CURRENT stagesMap), så en efterfølgende omlabelling af stage_number påvirker
// ikke dette scripts korrekthed.
//
//   node scripts/dev/recomposeSeason3Stages4103.mjs                 # dry-run (default)
//   CONFIRM_4103=yes node scripts/dev/recomposeSeason3Stages4103.mjs --apply
//
// Kør begge via: infisical run --env=prod --silent -- node scripts/dev/recomposeSeason3Stages4103.mjs [...]
//
// Refs #4103

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

import {
  finaleFor, DEMAND_VECTORS, GENERATOR_VERSION, seedIdentityFor,
} from "../../lib/raceStageProfileGenerator.js";
import { attachRoute } from "../../lib/raceRouteGenerator.js";
import { attachSegmentsAndWeather } from "../../lib/routeSegments.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seasonSeedSuffix } from "../../lib/raceSeedAxis.js";
import { resolveVariantByRaceId } from "../../lib/raceRouteRealismDraw.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { TIER_UNIFORM_TARGET_FRACTIONS, TIER_UNIFORM_TARGET_CATEGORIES } from "../../lib/calendarCompositionTargets.js";
import { repoRoot } from "../lib/repoRoot.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });

const SEASON_ID = "00000000-0000-0000-0000-000000000003";
const REPORT_DATE = "2026-08-23";
// #4274: ankret på git-toplevel, ikke __dirname — se scripts/lib/repoRoot.mjs.
const SNAPSHOT_DIR = join(repoRoot(), "docs/snapshots/4103");

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_4103 === "yes";
const DRY_RUN = !APPLY;

if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også miljøvariablen CONFIRM_4103=yes.");
  console.error("  CONFIRM_4103=yes infisical run --env=prod --silent -- node scripts/dev/recomposeSeason3Stages4103.mjs --apply");
  process.exit(1);
}

// ── FNV-1a 32-bit (lokal kopi — samme mønster som raceRouteGenerator.js/routeSegments.js:
// selvstændig fil, ingen krydsimport af selve hash-funktionen). ─────────────────────────
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rankOf(key) { return stableSeed(key); }

// ── Rene hjælpefunktioner (eksporteret for testbarhed) ──────────────────────────────

/** Nærmeste multiplum af `step` til `value` (almindelig afrunding, ties op). step ≥ 1. */
export function nearestMultiple(value, step) {
  if (!(step > 0)) return Math.round(value);
  return Math.round(value / step) * step;
}

const ITT_BOUND_ARCHETYPES = new Set(["grand_tour", "balanced_week", "sprinter_tour_summits"]);
const HIGH_MOUNTAIN_ARCHETYPES = new Set(["mountain_tour", "grand_tour", "summit_tour"]);
const HIGH_MOUNTAIN_KEEP_ARCHETYPES = new Set(["summit_tour", "grand_tour"]);
const GT_MIN_STAGES = 15;

function currentCategoryCount(category, stagesMap) {
  let n = 0;
  for (const pt of stagesMap.values()) {
    if (category === "itt" && (pt === "itt" || pt === "itt_hilly")) n++;
    else if (category === "cobbles" && pt === "cobbles") n++;
    else if (category === "high_mountain" && pt === "high_mountain") n++;
  }
  return n;
}

function ittCap(group) { return group.stages >= GT_MIN_STAGES ? 2 : 1; }

function isAdjacentToItt(stagesMap, stageNumber) {
  const before = stagesMap.get(stageNumber - 1);
  const after = stagesMap.get(stageNumber + 1);
  return before === "itt" || before === "itt_hilly" || after === "itt" || after === "itt_hilly";
}
function isAdjacentToHighMountain(stagesMap, stageNumber) {
  return stagesMap.get(stageNumber - 1) === "high_mountain" || stagesMap.get(stageNumber + 1) === "high_mountain";
}

// ── ADD-kandidater ───────────────────────────────────────────────────────────────────
export function bestAddCandidateStage(category, group) {
  const stagesMap = group.stagesMap;
  if (category === "itt") {
    if (currentCategoryCount("itt", stagesMap) >= ittCap(group)) return null;
    let best = null, bestScore = Infinity;
    const mid = Math.ceil(group.stages / 2);
    for (const [sn, pt] of stagesMap) {
      if (pt !== "flat" && pt !== "rolling") continue;
      if (isAdjacentToItt(stagesMap, sn)) continue;
      const score = sn === 1 ? 0 : Math.abs(sn - mid) + 1;
      if (score < bestScore) { bestScore = score; best = sn; }
    }
    if (best == null) return null;
    // itt_hilly (#3546 D) hvis etapen ligger i et mountain_tour/summit_tour-løb — jf.
    // ejer-beslutningens ordlyd. IKKE grand_tour (som allerede har sin egen
    // markSecondIttAsHilly-mekanik i generatoren for GT'ens ANDEN itt).
    const toType = (group.terrainArchetype === "mountain_tour" || group.terrainArchetype === "summit_tour") ? "itt_hilly" : "itt";
    return { stageNumber: best, fromType: stagesMap.get(best), toType };
  }
  if (category === "cobbles") {
    if (group.terrainArchetype === "summit_tour") return null; // aldrig i summit_tour
    if (currentCategoryCount("cobbles", stagesMap) >= 1) return null; // maks 1 pr. løb
    let best = null;
    for (const [sn, pt] of stagesMap) { if (pt === "flat" && (best == null || sn < best)) best = sn; }
    if (best == null) return null;
    return { stageNumber: best, fromType: "flat", toType: "cobbles" };
  }
  if (category === "high_mountain") {
    if (!HIGH_MOUNTAIN_ARCHETYPES.has(group.terrainArchetype)) return null;
    let best = null, bestScore = -Infinity;
    for (const [sn, pt] of stagesMap) {
      if (pt !== "mountain") continue;
      if (isAdjacentToHighMountain(stagesMap, sn)) continue; // aldrig NY nabo-high_mountain
      const score = sn; // finalen (højeste stage_number) foretrækkes
      if (score > bestScore) { bestScore = score; best = sn; }
    }
    if (best == null) return null;
    return { stageNumber: best, fromType: "mountain", toType: "high_mountain" };
  }
  return null;
}

// ── REMOVE-kandidater ────────────────────────────────────────────────────────────────
function minKeepForRemove(category, group) {
  if (category === "itt") return (group.stages >= GT_MIN_STAGES || ITT_BOUND_ARCHETYPES.has(group.terrainArchetype)) ? 1 : 0;
  if (category === "cobbles") return group.terrainArchetype === "cobbled_tour" ? 1 : 0;
  if (category === "high_mountain") return HIGH_MOUNTAIN_KEEP_ARCHETYPES.has(group.terrainArchetype) ? 1 : 0;
  return 0;
}

export function bestRemoveCandidateStage(category, group) {
  const stagesMap = group.stagesMap;
  const minKeep = minKeepForRemove(category, group);
  const currentCount = currentCategoryCount(category, stagesMap);
  if (currentCount <= minKeep) return null;

  const typeMatches = (pt) => (
    (category === "itt" && (pt === "itt" || pt === "itt_hilly")) ||
    (category === "cobbles" && pt === "cobbles") ||
    (category === "high_mountain" && pt === "high_mountain")
  );
  let best = null, bestScore = Infinity;
  for (const [sn, pt] of stagesMap) {
    if (!typeMatches(pt)) continue;
    // itt: fjern fra ENDEN først (behold åbnings-enkeltstarten). cobbles/high_mountain:
    // fjern fra START først (behold en evt. finale/identitet sidst).
    const score = category === "itt" ? (group.stages - sn) : sn;
    if (score < bestScore) { bestScore = score; best = sn; }
  }
  if (best == null) return null;
  return { stageNumber: best, fromType: stagesMap.get(best) };
}

function ittRemoveToType(group, stageNumber) {
  const rng = makeRng(stableSeed(`${group.externalId ?? group.poolRaceId}:4103:itt-remove-totype:${stageNumber}`));
  return rng() < 0.7 ? "flat" : "rolling";
}

// ── Tier-plan: konverter N grupper for én (tier, kategori) ─────────────────────────
export function planTierCategory({ category, direction, groups, needGroupConversions }) {
  const eligible = groups.filter((g) => g.raceType === "stage_race" && g.stages > 1);
  const ranked = eligible
    .map((g) => ({ g, rank: rankOf(`${g.externalId ?? g.poolRaceId}:4103:${category}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.g);

  const picks = [];
  let hmRemoveToggle = 0;
  while (picks.length < needGroupConversions) {
    let madeProgress = false;
    for (const g of ranked) {
      if (picks.length >= needGroupConversions) break;
      const cand = direction === "add" ? bestAddCandidateStage(category, g) : bestRemoveCandidateStage(category, g);
      if (!cand) continue;
      let toType = cand.toType;
      if (direction === "remove") {
        if (category === "cobbles") toType = "flat";
        else if (category === "itt") toType = ittRemoveToType(g, cand.stageNumber);
        else if (category === "high_mountain") { toType = hmRemoveToggle % 2 === 0 ? "mountain" : "hilly"; hmRemoveToggle++; }
      }
      g.stagesMap.set(cand.stageNumber, toType);
      picks.push({ group: g, stageNumber: cand.stageNumber, fromType: cand.fromType, toType, category, direction });
      madeProgress = true;
    }
    if (!madeProgress) break;
  }
  return { picks, gapGroups: needGroupConversions - picks.length };
}

// ── Rute/finale/demand_vector-genopbygning via generatorens EGNE funktioner ─────────
export function buildRecomposedStage(seedRace, stageNumber, profileType) {
  const identity = `${seedIdentityFor(seedRace)}${seasonSeedSuffix(seedRace)}`;
  const finaleRng = makeRng(stableSeed(`${identity}:recompose4103:${stageNumber}`));
  const finale_type = finaleFor(finaleRng, profileType);
  const demand_vector = { ...DEMAND_VECTORS[profileType] };
  const base = { stage_number: stageNumber, profile_type: profileType, finale_type, demand_vector };
  const route = attachRoute(base, seedRace, true);
  const merged = { ...base, ...route };
  const { segments, weather } = attachSegmentsAndWeather(merged, seedRace, stageNumber);
  return { ...merged, segments, weather };
}

// ═════════════════════════════════════ main ═══════════════════════════════════════

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE-secrets."); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  console.log(`=== #4103 S3-etapekomposition ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} ===\n`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index").order("id"));
  const tierByDivision = new Map(divisions.map((d) => [d.id, d.tier]));
  const tierGroupSize = new Map();
  for (const d of divisions) tierGroupSize.set(d.tier, (tierGroupSize.get(d.tier) ?? 0) + 1);

  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, race_type, stages, pool_race_id, league_division_id, race_class").eq("season_id", SEASON_ID).order("id"));

  const poolRaceIds = [...new Set(races.map((r) => r.pool_race_id).filter(Boolean))];
  const catalogRows = await fetchAllRowsChunkedIn(poolRaceIds, (chunk) =>
    supabase.from("race_pool").select("id, external_id, terrain_archetype").in("id", chunk).order("id"));
  const catalogMeta = new Map(catalogRows.map((r) => [r.id, { external_id: r.external_id ?? null, terrain_archetype: r.terrain_archetype ?? null }]));

  const raceIds = races.map((r) => r.id);
  const profileRows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("race_stage_profiles").select("id, race_id, stage_number, profile_type").in("race_id", chunk).order("race_id").order("stage_number"));
  const profilesByRace = new Map();
  for (const p of profileRows) {
    if (!profilesByRace.has(p.race_id)) profilesByRace.set(p.race_id, []);
    profilesByRace.get(p.race_id).push(p);
  }

  // season_variant pr. (season, tier) — samme resolver som backfill/materializer bruger.
  const seedRacesForVariant = races.map((r) => ({
    ...r, season_id: SEASON_ID,
    external_id: catalogMeta.get(r.pool_race_id)?.external_id ?? null,
    terrain_archetype: catalogMeta.get(r.pool_race_id)?.terrain_archetype ?? null,
  }));
  const variantByRaceId = resolveVariantByRaceId({ races: seedRacesForVariant, tierByDivision, catalogMeta });
  const variantByTier = new Map();
  for (const r of races) {
    const tier = tierByDivision.get(r.league_division_id);
    if (tier != null && !variantByTier.has(tier)) variantByTier.set(tier, variantByRaceId.get(r.id) ?? 0);
  }

  // ── Grupper (ét rigtigt løb = alle races-rækker der deler pool_race_id) ───────────
  const groupsByPoolRaceId = new Map();
  for (const r of races) {
    if (!groupsByPoolRaceId.has(r.pool_race_id)) groupsByPoolRaceId.set(r.pool_race_id, []);
    groupsByPoolRaceId.get(r.pool_race_id).push(r);
  }

  const groups = [];
  const divergentGroups = [];
  for (const [poolRaceId, members] of groupsByPoolRaceId) {
    const tiers = new Set(members.map((m) => tierByDivision.get(m.league_division_id)));
    if (tiers.size > 1) { divergentGroups.push({ poolRaceId, reason: `spænder over flere tiers: ${[...tiers].join(",")}` }); continue; }
    const tier = [...tiers][0];
    const rep = members.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
    const meta = catalogMeta.get(poolRaceId) ?? {};

    // Verificér byte-identisk profile_type-sekvens på tværs af gruppens medlemmer FØR
    // vi bygger den delte stagesMap — ellers ville en redigering af "gruppen" tavst
    // divergere puljerne yderligere.
    const seqOf = (raceId) => (profilesByRace.get(raceId) ?? []).map((p) => p.profile_type).join(",");
    const repSeq = seqOf(rep.id);
    const identical = members.every((m) => seqOf(m.id) === repSeq);
    if (!identical) { divergentGroups.push({ poolRaceId, name: rep.name, tier, reason: "puljerne har allerede forskellige profile_type-sekvenser — springes over" }); continue; }

    const stagesMap = new Map((profilesByRace.get(rep.id) ?? []).map((p) => [p.stage_number, p.profile_type]));
    groups.push({
      poolRaceId, tier, name: rep.name, raceType: rep.race_type, stages: rep.stages,
      raceClass: rep.race_class, externalId: meta.external_id ?? null, terrainArchetype: meta.terrain_archetype ?? null,
      raceIds: members.map((m) => m.id), groupSize: members.length, stagesMap,
    });
  }

  if (divergentGroups.length) {
    console.log(`⚠ ${divergentGroups.length} grupper sprunget over (data-integritet, ikke #4103's problem):`);
    for (const d of divergentGroups) console.log(`  - ${d.poolRaceId} (tier ${d.tier ?? "?"}, ${d.name ?? "?"}): ${d.reason}`);
    console.log();
  }

  // ── Pr.-tier stats + mål ──────────────────────────────────────────────────────────
  const tierReports = [];
  const allPicks = [];

  for (const tier of [1, 2, 3, 4]) {
    const tierGroups = groups.filter((g) => g.tier === tier);
    const groupSize = tierGroupSize.get(tier);
    const totalDays = tierGroups.reduce((s, g) => s + g.stagesMap.size * g.groupSize, 0);

    const before = {};
    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      before[cat] = tierGroups.reduce((s, g) => s + currentCategoryCount(cat, g.stagesMap) * g.groupSize, 0);
    }

    const categoryPlans = {};
    // Rækkefølge: high_mountain (mountain-pulje, uafhængig) → cobbles (flad-pulje) →
    // itt (flad/rolling-pulje) — cobbles får første ret til flade etaper.
    for (const category of ["high_mountain", "cobbles", "itt"]) {
      const ideal = totalDays * TIER_UNIFORM_TARGET_FRACTIONS[category];
      const targetCount = nearestMultiple(Math.round(ideal), groupSize);
      const diff = targetCount - before[category];
      const diffGroups = diff / groupSize;
      if (!Number.isInteger(diffGroups)) {
        console.log(`⚠ tier ${tier} ${category}: diff (${diff}) er ikke et multiplum af gruppestørrelsen (${groupSize}) — uventet, springer over.`);
        categoryPlans[category] = { picks: [], gapGroups: 0, targetCount, diff: 0, ideal };
        continue;
      }
      if (diffGroups === 0) { categoryPlans[category] = { picks: [], gapGroups: 0, targetCount, diff, ideal }; continue; }
      const direction = diffGroups > 0 ? "add" : "remove";
      const { picks, gapGroups } = planTierCategory({ category, direction, groups: tierGroups, needGroupConversions: Math.abs(diffGroups) });
      categoryPlans[category] = { picks, gapGroups, targetCount, diff, ideal, direction };
      allPicks.push(...picks);
    }

    const after = {};
    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      after[cat] = tierGroups.reduce((s, g) => s + currentCategoryCount(cat, g.stagesMap) * g.groupSize, 0);
    }

    tierReports.push({ tier, totalDays, groupSize, before, after, categoryPlans });
  }

  // ── Konsol-opsummering ─────────────────────────────────────────────────────────────
  for (const t of tierReports) {
    console.log(`── Tier ${t.tier} (${t.totalDays} løbsdage, ${t.groupSize} puljer) ──`);
    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      const p = t.categoryPlans[cat];
      const beforePct = (100 * t.before[cat]) / t.totalDays;
      const afterPct = (100 * t.after[cat]) / t.totalDays;
      const gapNote = p.gapGroups > 0 ? `  ⚠ GAB: ${p.gapGroups * t.groupSize} løbsdage kunne ikke lukkes uden at bryde identitetsregler` : "";
      console.log(`  ${cat.padEnd(14)} ${t.before[cat]} (${beforePct.toFixed(1)}%) → ${t.after[cat]} (${afterPct.toFixed(1)}%)  [mål ${p.targetCount}]${gapNote}`);
    }
    console.log();
  }
  console.log(`I alt ${allPicks.length} etape-konverteringer × puljekopier.\n`);

  // ── Markdown dry-run-rapport ─────────────────────────────────────────────────────
  if (DRY_RUN) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const md = buildDryRunReport({ tierReports, allPicks, divergentGroups });
    const reportPath = join(SNAPSHOT_DIR, `dry-run-${REPORT_DATE}.md`);
    writeFileSync(reportPath, md, "utf8");
    console.log(`Dry-run-rapport skrevet: ${reportPath}`);
    console.log("\n(DRY-RUN) Skriver intet i databasen. Kør med --apply (+ CONFIRM_4103=yes) for at skrive.");
    return;
  }

  // ── APPLY ────────────────────────────────────────────────────────────────────────
  if (!allPicks.length) { console.log("Intet at skrive — alle divisioner er allerede i mål."); return; }

  // Byg de faktiske DB-updates: ét regenereret stage-indhold pr. (gruppe, stage_number),
  // anvendt på ALLE gruppens medlems-races (puljekopier).
  const updates = []; // { id, race_id, stage_number, ...content }
  for (const pick of allPicks) {
    const g = pick.group;
    const seedRace = {
      id: g.raceIds[0], external_id: g.externalId, pool_race_id: g.poolRaceId,
      season_id: SEASON_ID, name: g.name, race_class: g.raceClass,
      season_variant: variantByTier.get(g.tier) ?? 0,
    };
    const content = buildRecomposedStage(seedRace, pick.stageNumber, pick.toType);
    for (const raceId of g.raceIds) {
      const existingRow = (profilesByRace.get(raceId) ?? []).find((p) => p.stage_number === pick.stageNumber);
      if (!existingRow) { console.error(`FEJL: ingen eksisterende race_stage_profiles-række for race ${raceId} etape ${pick.stageNumber} — afbryder.`); process.exit(1); }
      updates.push({
        id: existingRow.id, race_id: raceId, stage_number: pick.stageNumber,
        profile_type: content.profile_type, finale_type: content.finale_type, demand_vector: content.demand_vector,
        distance_km: content.distance_km, elevation_gain_m: content.elevation_gain_m,
        climbs: content.climbs, sprints: content.sprints, sectors: content.sectors,
        segments: content.segments, weather: content.weather,
        generator_version: GENERATOR_VERSION, is_manual: true,
      });
    }
  }

  // Snapshot af ALLE berørte rækker FØR skrivning.
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const beforeIds = updates.map((u) => u.id);
  const beforeRows = await fetchAllRowsChunkedIn(beforeIds, (chunk) =>
    supabase.from("race_stage_profiles").select("*").in("id", chunk).order("id"));
  const beforePath = join(SNAPSHOT_DIR, `before-${REPORT_DATE}.json`);
  writeFileSync(beforePath, JSON.stringify(beforeRows, null, 2), "utf8");
  console.log(`Snapshot af ${beforeRows.length} berørte rækker skrevet: ${beforePath}`);

  let written = 0;
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from("race_stage_profiles").update(patch).eq("id", id);
    if (error) throw new Error(`update id=${id} (race ${u.race_id} etape ${u.stage_number}): ${error.message}`);
    written++;
  }
  console.log(`\n✅ Skrev ${written} rækker (is_manual=true).`);
  console.log("Post-verify: kør node scripts/dev/verifySeason3Calendar.mjs OG node scripts/s3CalendarPackageScorecard.js.");
}

function buildDryRunReport({ tierReports, allPicks, divergentGroups }) {
  const lines = [];
  lines.push(`# #4103 — S3 etape-komposition dry-run (${REPORT_DATE})`);
  lines.push("");
  lines.push("Mål (ejer-beslutning 23/8, samme for alle divisioner): ITT 10 % · brosten 5 % · high_mountain 12 % (andel af divisionens løbsdage, alle etaper inkl. endagsløb i nævneren).");
  lines.push("");
  if (divergentGroups.length) {
    lines.push(`> ⚠ ${divergentGroups.length} løbs-grupper sprunget over pga. allerede-divergerende puljekopier (data-integritet, uafhængigt af #4103) — se konsol-output.`);
    lines.push("");
  }

  for (const t of tierReports) {
    lines.push(`## Tier ${t.tier} — ${t.totalDays} løbsdage, ${t.groupSize} ${t.groupSize === 1 ? "pulje" : "puljer"}`);
    lines.push("");
    lines.push("| Kategori | Før | Før % | Mål (antal) | Efter | Efter % | Gab |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      const p = t.categoryPlans[cat];
      const beforePct = (100 * t.before[cat]) / t.totalDays;
      const afterPct = (100 * t.after[cat]) / t.totalDays;
      const gap = p.gapGroups > 0 ? `${p.gapGroups * t.groupSize} løbsdage` : "—";
      lines.push(`| ${cat} | ${t.before[cat]} | ${beforePct.toFixed(1)} % | ${p.targetCount} | ${t.after[cat]} | ${afterPct.toFixed(1)} % | ${gap} |`);
    }
    lines.push("");

    const tierPicks = allPicks.filter((pk) => pk.group.tier === t.tier);
    if (tierPicks.length) {
      lines.push("Ændrede etaper (anvendt på alle puljekopier af løbet):");
      lines.push("");
      lines.push("| Løb | Pulje-arketype | Etape | Fra → Til |");
      lines.push("|---|---|---|---|");
      for (const pk of tierPicks) {
        lines.push(`| ${pk.group.name} | ${pk.group.terrainArchetype ?? "(ukendt)"} | ${pk.stageNumber} | ${pk.fromType} → ${pk.toType} |`);
      }
      lines.push("");
    }

    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      const p = t.categoryPlans[cat];
      if (p.gapGroups > 0) {
        lines.push(`**Gab — ${cat}:** ${p.gapGroups * t.groupSize} løbsdage kunne ikke konverteres uden at bryde identitetsreglerne (arketype-begrænsning, cap, eller nabo-regel udtømte de berettigede kandidater). Ingen tvang anvendt.`);
        lines.push("");
      }
    }
  }

  lines.push("## Samlet");
  lines.push("");
  lines.push(`${allPicks.length} etape-konverteringer (før puljekopiering).`);
  lines.push("");
  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("recomposeSeason3Stages4103.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
