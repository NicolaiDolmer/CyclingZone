#!/usr/bin/env node
// backend/scripts/dev/s4CatalogDryRun.mjs
// #4270 — mål hvad database/2026-09-03-4270-s4-catalog-expansion.sql gør ved sæson 4.
//
// 100 % READ-ONLY. Scriptet laver ÉN slags DB-adgang: `select` mod race_pool,
// league_divisions og teams — samme forespørgsels-form som de verificerede read-only
// scripts scripts/dev/dumpRacePoolFixture.mjs og scripts/s3CalendarPackageScorecard.js.
// Ingen insert/update/delete, ingen migration, ingen --apply. Resten er ren funktion.
//
// HVORFOR DEN LÆSER SQL'EN OG IKKE EN KOPI. Målingen skal beskrive PRÆCIS de rækker der
// bliver applyet. En JSON-tvilling af seed'en ville kunne drifte fra migrationen uden at
// nogen opdagede det — samme fejlklasse som CALENDAR_RULES.md §12's sidste forward-guard.
// Derfor parses INSERT-blokken i selve .sql-filen, og scriptet fejler hvis den ikke kan
// læses. Ét sted at rette.
//
// D4 PÅ 3 ETAPER/DAG (ejer-beslutning 3/9). `buildTierMaterializationPlan` tager density,
// quotas og slots som PARAMETRE (tierCalendarMaterializer.js:236-244), så D4's nye tæthed
// injiceres her uden at røre calendarTierCaps.js — den fil ejes af regel-sporet.
// `--d4-density=2` måler mod den nuværende konstant i stedet.
//
//   node scripts/dev/s4CatalogDryRun.mjs                       (henter prod-kataloget)
//   node scripts/dev/s4CatalogDryRun.mjs --cache=.tmp-pool.json (henter én gang, genbruger)
//   node scripts/dev/s4CatalogDryRun.mjs --json
//
// Refs #4270 #4278 #4105 #3864 #4103 #3469

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { TIER_STAGE_SLOTS } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import {
  computeCompositionStats, ACTIVE_TARGET, CATEGORY_LABELS, COMPOSITION_CATEGORIES,
  computeUniformTierStats, TIER_UNIFORM_TARGET_FRACTIONS,
} from "../../lib/calendarCompositionTargets.js";
import { scoreTier } from "../../lib/raceRouteRealismMetrics.js";
import { detectEmptyCalendarDays } from "../../lib/calendarDailyCoverage.js";
import { arg as devArg } from "./lib/devCalendarArgs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");
const EXPANSION_SQL = join(REPO, "database", "2026-09-03-4270-s4-catalog-expansion.sql");

const arg = (name, fallback) => devArg(process.argv.slice(2), name, fallback);

// Ejer-beslutning 3/9: S4 = 28 løbsdatoer, mandag 28/9 → søndag 25/10, uden tilt.
const FIRST_RACE_DAY = arg("first-day", "2026-09-28");
const REAL_DAYS = Number(arg("days", "28"));
const NOW = new Date(`${arg("now", "2026-09-03")}T12:00:00Z`);
const D4_DENSITY = Number(arg("d4-density", "3"));
const SEASON_UUID = "00000000-0000-0000-0000-000000000004";
const LAST_RACE_DAY = new Date(
  Date.parse(`${FIRST_RACE_DAY}T00:00:00Z`) + (REAL_DAYS - 1) * 86_400_000
).toISOString().slice(0, 10);

// ── 1. Katalog-rækkerne fra migrationen ──────────────────────────────────────────
// Parser `('ext', 'navn', 'klasse', 'type', N, 'arketype', 'land', 'date_text'),`.
// Bevidst striks: en linje der IKKE matcher, og som ikke er kommentar/insert/values/
// on-conflict, får scriptet til at fejle frem for at måle et ufuldstændigt sæt.
function fnv12(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + str.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

export function parseExpansionSql(sqlText) {
  const start = sqlText.indexOf("values");
  if (start < 0) throw new Error("kunne ikke finde 'values' i expansion-SQL'en");
  const end = sqlText.indexOf("on conflict", start);
  if (end < 0) throw new Error("kunne ikke finde 'on conflict' i expansion-SQL'en");
  const body = sqlText.slice(start + "values".length, end);
  const rows = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--")) continue;
    const m = line.match(
      /^\(\s*'([^']*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*,?\s*$/
    );
    if (!m) throw new Error(`kunne ikke parse katalog-linje: ${line}`);
    rows.push({
      external_id: m[1],
      name: m[2].replace(/''/g, "'"),
      race_class: m[3],
      race_type: m[4],
      stages: Number(m[5]),
      terrain_archetype: m[6],
      country: m[7],
      date_text: m[8],
      // Deterministisk pseudo-uuid, KUN til dry-run (samme mønster som
      // proposeCatalogExpansion.js's toCatalogRow). Hash frem for tegn-filtrering:
      // to external_id'er der kun adskiller sig på ikke-hex-tegn skal ikke kollidere.
      id: `ffffffff-4270-4000-8000-${fnv12(m[1])}`,
    });
  }
  return rows;
}

// ── 2. Prod-kataloget (read-only) ────────────────────────────────────────────────
async function loadPool() {
  const cachePath = arg("cache", null);
  if (cachePath && existsSync(cachePath)) {
    const j = JSON.parse(readFileSync(cachePath, "utf8"));
    console.log(`[cache] ${j.catalog.length} løb / ${j.pools.length} puljer fra ${cachePath}`);
    return j;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: join(__dirname, "..", "..", ".env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { fetchAllRows } = await import("../../lib/supabasePagination.js");

  const { data: divisions, error: dErr } = await sb.from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const { data: teams, error: tErr } = await sb.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  // fetchAllRows tager EN builder-funktion (supabasePagination.js:25). NB:
  // scripts/dev/dumpRacePoolFixture.mjs kalder den med (sb, builder) og ville kaste —
  // den fil er dokumenteret "skrevet, ikke koert", saa fejlen er aldrig blevet ramt.
  const catalogRows = await fetchAllRows(() =>
    sb.from("race_pool")
      .select("id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text")
      .is("retired_at", null)
      .order("id", { ascending: true })
  );

  const isReal = (t) => t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
  const realByDiv = new Map();
  for (const t of teams ?? []) {
    if (isReal(t) && t.league_division_id != null) {
      realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) ?? 0) + 1);
    }
  }
  const out = {
    hentet: new Date().toISOString().slice(0, 10),
    pools: (divisions ?? []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) ?? 0 })),
    catalog: (catalogRows ?? []).map((r) => ({
      id: r.id, external_id: r.external_id, terrain_archetype: r.terrain_archetype,
      name: r.name, race_class: r.race_class, race_type: r.race_type, stages: r.stages, date_text: r.date_text,
    })),
  };
  console.log(`[prod] ${out.catalog.length} aktive katalog-løb / ${out.pools.length} puljer (read-only)`);
  if (cachePath) writeFileSync(cachePath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  return out;
}

// ── 3. Mål én plan ───────────────────────────────────────────────────────────────
function measure({ pools, catalog, label }) {
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const density = { ...TIER_DENSITY, 4: D4_DENSITY };
  const slots = { ...TIER_STAGE_SLOTS, 4: Math.max(TIER_STAGE_SLOTS[4], D4_DENSITY) };
  const quotas = Object.fromEntries(Object.entries(density).map(([t, d]) => [t, d * REAL_DAYS]));

  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, from, realDays: REAL_DAYS, quotas, density, slots, baseSeed: 1,
  });

  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));
  const stageDays = [];
  const rows = [];

  for (const plan of tierPlans) {
    const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
    for (const s of pool.stageRows ?? []) stageDays.push({ division: plan.tier, date: String(s.scheduled_at).slice(0, 10) });

    const profilesByPoolRaceId = new Map();
    for (const r of pool.raceRows ?? []) {
      profilesByPoolRaceId.set(r.pool_race_id, generateRaceStageProfiles({
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
        race_class: r.race_class ?? null,
        season_id: SEASON_UUID, season_variant: 0,
      }));
    }
    const målbare = (pool.raceRows ?? []).map((r) => ({
      name: r.name, race_type: r.race_type, race_class: r.race_class ?? null,
      terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
      stages: profilesByPoolRaceId.get(r.pool_race_id) ?? [],
    }));

    let etaper = 0, rolling = 0, gravel = 0, cobblesStages = 0;
    for (const r of målbare) {
      for (const st of r.stages ?? []) {
        etaper += 1;
        if (st.profile_type === "rolling") rolling += 1;
        if (st.profile_type === "gravel") gravel += 1;
        if (st.profile_type === "cobbles") cobblesStages += 1;
      }
    }
    const composition = computeCompositionStats(målbare);
    const uniform = computeUniformTierStats(målbare);
    const realism = scoreTier(plan.tier, målbare);
    // Grus-etapeløb tælles SAMMEN med brosten-etapeløb her: grus hører til brostens-
    // familien i kalenderens dækning (ejer-ramme 3/9), men raceRouteRealismMetrics.js's
    // cobbles_in_stagerace kender kun `cobbles` — den mapping ejes af regel-sporet.
    const gravelStageRaces = målbare.filter(
      (r) => r.race_type === "stage_race" && (r.stages || []).some((s) => s.profile_type === "gravel")
    ).length;

    rows.push({
      tier: plan.tier,
      løb: (pool.raceRows ?? []).length,
      etaper,
      kvote: quotas[plan.tier],
      kvoteOpfyldelse: quotas[plan.tier] ? etaper / quotas[plan.tier] : 0,
      kalenderdage: new Set((pool.stageRows ?? []).map((s) => String(s.scheduled_at).slice(0, 10))).size,
      løbsdage: new Set((pool.stageRows ?? []).map((s) => s.game_day)).size,
      maxOverlap: plan.maxOverlap, overlapCap: plan.overlapCap,
      planViolations: plan.calendarViolations ?? [],
      rolling, rollingPct: etaper ? (100 * rolling) / etaper : 0,
      gravel, cobblesStages,
      højbjergPct: uniform.pct.high_mountain, brostenPct: uniform.pct.cobbles, ittPct: uniform.pct.itt,
      composition: composition.pct,
      ukendteProfiler: composition.unknown,
      nedkørselsFinaler: realism.descent_finale_stage_days,
      brostenIEtapeløb: realism.cobbles_in_stagerace + gravelStageRaces,
      realismeBrud: realism.failures,
    });
  }

  const dækning = detectEmptyCalendarDays({
    stageDays, from: FIRST_RACE_DAY, to: LAST_RACE_DAY, divisions: tierPlans.map((p) => p.tier),
  });
  return { label, rows, dækning };
}

// ── 4. Rapport ───────────────────────────────────────────────────────────────────
const pp = (n) => `${n.toFixed(1)}`;
const KB = { flat: ACTIVE_TARGET.flat, hilly: ACTIVE_TARGET.hilly, mountain: ACTIVE_TARGET.mountain, itt: ACTIVE_TARGET.itt, cobbles: ACTIVE_TARGET.cobbles, ttt: ACTIVE_TARGET.ttt };

function print(res) {
  console.log(`\n===== ${res.label} =====`);
  console.log(`dækning: ${res.dækning.ok ? "alle divisioner har løb hver dag" : res.dækning.violations.join(" · ")}`);
  for (const r of res.rows) {
    console.log(`\n  D${r.tier}: ${r.løb} løb · ${r.etaper}/${r.kvote} etaper (${(100 * r.kvoteOpfyldelse).toFixed(1)} %) · ${r.kalenderdage} kalenderdage · ${r.løbsdage} løbsdage · overlap ${r.maxOverlap}/${r.overlapCap}`);
    const comp = COMPOSITION_CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} ${pp(r.composition[c])} (mål ${KB[c]})`).join(" · ");
    console.log(`     §6  ${comp}`);
    console.log(`     §6b højbjerg ${pp(r.højbjergPct)} (mål ${100 * TIER_UNIFORM_TARGET_FRACTIONS.high_mountain}) · brosten ${pp(r.brostenPct)} (mål ${100 * TIER_UNIFORM_TARGET_FRACTIONS.cobbles}) · ITT ${pp(r.ittPct)} (mål ${100 * TIER_UNIFORM_TARGET_FRACTIONS.itt})`);
    console.log(`     rolling ${r.rolling} etaper (${pp(r.rollingPct)} %) · grus ${r.gravel} · brosten-etaper ${r.cobblesStages}`);
    console.log(`     nedkørsels-finale-etapedage ${r.nedkørselsFinaler} · brosten/grus-i-etapeløb ${r.brostenIEtapeløb}`);
    if (Object.keys(r.ukendteProfiler).length) console.log(`     ⚠ profiltyper uden kompositions-kategori: ${JSON.stringify(r.ukendteProfiler)}`);
    if (r.planViolations.length) console.log(`     ⚠ plan-brud: ${r.planViolations.join(" · ")}`);
    if (r.realismeBrud.length) console.log(`     ⚠ realisme: ${r.realismeBrud.join(" · ")}`);
  }
}

async function main() {
  const { pools, catalog } = await loadPool();
  const additions = parseExpansionSql(readFileSync(EXPANSION_SQL, "utf8"));

  const eksisterende = new Set(catalog.map((c) => c.name));
  const kollisioner = additions.filter((a) => eksisterende.has(a.name)).map((a) => a.name);
  const extIdKollisioner = additions.filter((a) => catalog.some((c) => c.external_id === a.external_id)).map((a) => a.external_id);
  console.log(`\nMigrationen tilføjer ${additions.length} løb. Navnekollisioner: ${kollisioner.length ? kollisioner.join(", ") : "0"}. external_id-kollisioner: ${extIdKollisioner.length ? extIdKollisioner.join(", ") : "0"}.`);
  console.log(`S4-vindue: ${FIRST_RACE_DAY} → ${LAST_RACE_DAY} (${REAL_DAYS} dage) · D4-density ${D4_DENSITY}`);

  const før = measure({ pools, catalog, label: `FØR — prod-kataloget (${catalog.length} løb)` });
  const efter = measure({ pools, catalog: [...catalog, ...additions], label: `EFTER — med de ${additions.length} nye løb (${catalog.length + additions.length} løb)` });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ additions, kollisioner, extIdKollisioner, før, efter }, null, 2));
    return;
  }
  print(før);
  print(efter);

  console.log(`\n===== FØR → EFTER pr. division =====`);
  for (const a of før.rows) {
    const b = efter.rows.find((x) => x.tier === a.tier);
    const d = (x, y, unit = "") => `${pp(x)}${unit} → ${pp(y)}${unit}`;
    console.log(`  D${a.tier}  kvote ${(100 * a.kvoteOpfyldelse).toFixed(1)} % → ${(100 * b.kvoteOpfyldelse).toFixed(1)} % · kuperet ${d(a.composition.hilly, b.composition.hilly)} · bjerg ${d(a.composition.mountain, b.composition.mountain)} · højbjerg ${d(a.højbjergPct, b.højbjergPct)} · rolling ${a.rolling} → ${b.rolling} · nedkørsels-finaler ${a.nedkørselsFinaler} → ${b.nedkørselsFinaler} · brosten/grus-etapeløb ${a.brostenIEtapeløb} → ${b.brostenIEtapeløb}`);
  }
}

main().catch((e) => { console.error("[fatal]", e?.message ?? e); process.exit(1); });
