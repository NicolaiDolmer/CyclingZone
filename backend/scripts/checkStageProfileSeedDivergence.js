#!/usr/bin/env node
// Diagnostik: kryds-pulje parcours-divergens pr. division (invariant-tjek for v2-
// seed-fixet). En divisions parallelle puljer kører SAMME løb (samme pool_race_id);
// efter v2 (seed = external_id, jf. seedIdentityFor) SKAL de også have IDENTISK
// parcours pr. etape. v1 seedede på den per-pulje races.id → hver pulje fik sit eget.
//
// Read-only. Rapporterer for hver division:
//   • FØR  = antal (pool_race_id, etape)-slots hvor de NUVÆRENDE DB-profiler afviger
//            mellem puljerne.
//   • EFTER = samme, men beregnet på FRISK-genererede profiler (v2-generatoren) —
//            forventet 0.
//   • Løb hvis parcours ÆNDRES af en regenerering (NUVÆRENDE vs frisk).
//
//   node scripts/checkStageProfileSeedDivergence.js            # default sæson = aktiv
//   node scripts/checkStageProfileSeedDivergence.js --season 1
//
// Skriver INTET. Brug backfillRaceStageProfiles.js --season N for at anvende.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const seasonIdx = process.argv.indexOf("--season");
const SEASON_NUMBER = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : null;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Rute-identitet pr. etape = profile_type|finale_type (demand_vector er afledt af
// profile_type, så den følger med).
const routeKey = (p) => `${p.profile_type}|${p.finale_type ?? ""}`;

async function resolveSeason() {
  if (SEASON_NUMBER != null) {
    const { data, error } = await supabase.from("seasons").select("id, number").eq("number", SEASON_NUMBER).single();
    if (error || !data) throw new Error(`Sæson ${SEASON_NUMBER} ikke fundet: ${error?.message}`);
    return data;
  }
  const { data, error } = await supabase.from("seasons").select("id, number").eq("status", "active").order("number", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`Ingen aktiv sæson fundet: ${error?.message}`);
  return data;
}

// Slots der afviger mellem puljer for ét sæt løb (grupperet pr. (tier, pool_race_id)).
// profilesByRaceId: Map<race_id, Array<{stage_number, profile_type, finale_type}>>
function divergenceByTier(racesOfSeason, divisionByPool, profilesByRaceId) {
  // tier -> pool_race_id -> stage_number -> Set(routeKey)
  const tierMap = new Map();
  for (const r of racesOfSeason) {
    const div = divisionByPool.get(r.league_division_id);
    if (!div) continue;
    const tier = div.tier;
    if (!tierMap.has(tier)) tierMap.set(tier, new Map());
    const byPoolRace = tierMap.get(tier);
    if (!byPoolRace.has(r.pool_race_id)) byPoolRace.set(r.pool_race_id, new Map());
    const byStage = byPoolRace.get(r.pool_race_id);
    for (const p of profilesByRaceId.get(r.id) || []) {
      if (!byStage.has(p.stage_number)) byStage.set(p.stage_number, new Set());
      byStage.get(p.stage_number).add(routeKey(p));
    }
  }
  const out = new Map(); // tier -> { stageSlots, divergingSlots }
  for (const [tier, byPoolRace] of tierMap) {
    let stageSlots = 0, divergingSlots = 0;
    for (const byStage of byPoolRace.values()) {
      for (const set of byStage.values()) {
        stageSlots++;
        if (set.size > 1) divergingSlots++;
      }
    }
    out.set(tier, { stageSlots, divergingSlots });
  }
  return out;
}

async function main() {
  const season = await resolveSeason();
  console.log(`=== Stage-profil seed-divergens — sæson ${season.number} (${season.id}) ===\n`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index"));
  const divisionByPool = new Map((divisions || []).map((d) => [d.id, d]));
  const poolCountByTier = new Map();
  for (const d of divisions || []) poolCountByTier.set(d.tier, (poolCountByTier.get(d.tier) || 0) + 1);

  const races = await fetchAllRows(() => supabase.from("races").select("id, pool_race_id, race_type, stages, league_division_id").eq("season_id", season.id).order("id"));
  const externalIdByPoolRace = new Map((await fetchAllRows(() => supabase.from("race_pool").select("id, external_id").order("id"))).map((r) => [r.id, r.external_id ?? null]));

  // NUVÆRENDE DB-profiler.
  const dbProfiles = await fetchAllRows(() => supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type, finale_type, is_manual").order("race_id").order("stage_number"));
  const currentByRaceId = new Map();
  for (const p of dbProfiles) {
    if (!currentByRaceId.has(p.race_id)) currentByRaceId.set(p.race_id, []);
    currentByRaceId.get(p.race_id).push(p);
  }
  // Håndredigerede løb springes over af backfill → AFTER skal bruge deres NUVÆRENDE
  // profiler, ellers divergerer rapporten fra hvad et apply faktisk skriver.
  const manualRaceIds = new Set(dbProfiles.filter((p) => p.is_manual).map((p) => p.race_id));

  // Identitets-guard: AFTER=0 forudsætter at hvert løb har en DELT, non-blank seed-nøgle
  // (external_id, eller mindst pool_race_id). Et løb der KUN har race.id falder tilbage
  // til per-pulje-seed og KAN divergere mellem puljer — fang det højlydt.
  const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");
  const noSharedKey = races.filter((r) => blank(externalIdByPoolRace.get(r.pool_race_id)) && blank(r.pool_race_id));
  if (noSharedKey.length) {
    console.log(`⚠️  ${noSharedKey.length} løb mangler både external_id og pool_race_id — seedes på race.id, kan divergere. AFTER=0 er IKKE garanteret.\n`);
  }

  // FRISK-genererede profiler (v2-generatoren, seedet på external_id). Manual-løb beholder
  // deres nuværende profiler (mirror af backfill's skip).
  const freshByRaceId = new Map();
  for (const r of races) {
    if (manualRaceIds.has(r.id)) { freshByRaceId.set(r.id, currentByRaceId.get(r.id) || []); continue; }
    const seedRace = { id: r.id, race_type: r.race_type, stages: r.stages, pool_race_id: r.pool_race_id, external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null };
    freshByRaceId.set(r.id, generateRaceStageProfiles(seedRace));
  }

  const before = divergenceByTier(races, divisionByPool, currentByRaceId);
  const after = divergenceByTier(races, divisionByPool, freshByRaceId);

  // Løb hvis parcours ÆNDRES af regenerering.
  let racesChanged = 0;
  for (const r of races) {
    const cur = (currentByRaceId.get(r.id) || []).map(routeKey).join(">");
    const fresh = (freshByRaceId.get(r.id) || []).map(routeKey).join(">");
    if (cur !== fresh) racesChanged++;
  }

  console.log("Division | puljer | etape-slots | divergerende FØR | divergerende EFTER");
  console.log("---------|--------|-------------|------------------|-------------------");
  for (const tier of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(tier) || { stageSlots: 0, divergingSlots: 0 };
    const a = after.get(tier) || { stageSlots: 0, divergingSlots: 0 };
    const pools = poolCountByTier.get(tier) || 0;
    const note = pools < 2 ? "  (1 pulje — ingen kryds-pulje-sammenligning)" : "";
    console.log(`Div ${tier}    |   ${pools}    |     ${String(b.stageSlots).padStart(3)}     |       ${String(b.divergingSlots).padStart(3)}        |        ${String(a.divergingSlots).padStart(3)}${note}`);
  }
  console.log(`\nLøb i alt: ${races.length} · profil-rækker: ${dbProfiles.length} · håndredigerede (springes over): ${manualRaceIds.size}`);
  console.log(`Løb hvis parcours ÆNDRES ved regenerering: ${racesChanged}/${races.length}`);

  const totalAfter = [...after.values()].reduce((s, x) => s + x.divergingSlots, 0);
  if (totalAfter === 0) console.log(`\n✅ EFTER: 0 divergerende slots i alle divisioner — alle puljer deler parcours.`);
  else console.log(`\n❌ EFTER: ${totalAfter} divergerende slots tilbage — fix virker ikke som forventet.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
