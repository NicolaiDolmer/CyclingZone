#!/usr/bin/env node
// backend/scripts/convertHillyToMountainClassics.js (#2755, ejer-valg A 23/7)
//
// MÅLRETTET konvertering: giver division 2 og 3 bjergklassikere i sæson 2 ved at
// konvertere et HÅNDPLUKKET sæt eksisterende hilly-endagsløb til mountain/
// high_mountain — IKKE en bred regen. Målt fordeling (23/7, sæson 2, endagsløb
// pr. tier via race_stage_profiles.profile_type):
//   T1: 12 i alt, 1 high_mountain · T2: 18 i alt, 0 bjerg (6 hilly)
//   T3: 140 i alt, 0 bjerg (52 hilly) · T4: 96 i alt, 8 mountain (8.3%)
//
// Kandidater er valgt efter: (1) højeste elevation_gain_m blandt hilly-endagsløb
// i den tier, (2) at samme RIGTIGE løb (external_id) konverteres i ALLE puljer i
// tieren — puljerne i en tier viser samme rigtige løb (jf. raceStageProfileGenerator
// seedIdentityFor-kommentaren: "SAMME rigtige løb skal have det SAMME parcours i
// alle en divisions parallelle puljer"); at konvertere kun ÉN pulje ville bryde
// den garanti. D2 har 2 puljer, D3 har 4 puljer (IKKE 8 — verificeret 23/7 mod
// league_divisions; briefen der nævnte "D3's 8 puljer" tog fejl, se PR-body).
//
// D2 (2 rigtige løb × 2 puljer = 4 rækker):
//   Limburgse Klassieker        (f1c33846c869ff29) dag 17, 1803 hm, puncheur
//   Grand Prix du Saint-Laurent (64a2a18688621713) dag 4,  1673 hm, puncheur
// D3 (3 rigtige løb × 4 puljer = 12 rækker — 12/140 = 8.6%, tæt på T4's 8.3%):
//   Brabantse Klassieker   (50c62405df6384e4) dag 24, 2291 hm, puncheur
//   Trofeo Ligure          (b2eb3c7fe98f5f5c) dag 5,  2200 hm, hilly_classic
//   Classique de la Drôme  (f56c0f3f0a8995b7) dag 2,  2023 hm, hilly_classic
// Total: 16 race_stage_profiles-rækker (5 rigtige løb).
//
// Metode: INGEN håndskrevne demand_vector/climbs/elevation. For hver kandidat
// bygges en SKYGGE-race (kun i hukommelsen — race_pool.terrain_archetype
// røres ALDRIG, så andre tiers' kopier af samme rigtige løb er upåvirkede) med
// terrain_archetype="mountain_classic" (ARCHETYPE_PROFILES: 50% high_mountain /
// 50% mountain, samme arketype T4's egne mountain-endagsløb ville kunne bruge).
// generateRaceStageProfiles() (samme generator som backfillRaceStageProfiles.js)
// afgør så profile_type/finale_type/demand_vector/rute deterministisk fra
// seedIdentityFor (external_id) + season_id — 100% generator-kode, ingen
// hardkodede vektorer. Resultatet skrives med is_manual=true, så en FREMTIDIG
// backfillRaceStageProfiles-kørsel (som stadig ser terrain_archetype="puncheur"/
// "hilly_classic" i kataloget) springer disse rækker over i stedet for at rulle
// dem tilbage til hilly (samme is_manual-kontrakt som håndkuraterede løb).
//
// Idempotent: en allerede-konverteret række (is_manual=true + profile_type i
// {mountain, high_mountain}) springes over ved gentagne kørsler.
//
// Rører KUN race_stage_profiles-rækker for de 16 hardkodede race_id'er herunder.
// Ingen andre løb, ingen andre sæsoner, ingen races/scheduling/season-felter.
//
//   node scripts/convertHillyToMountainClassics.js --season 2 [--dry-run|--apply]
//
// Orkestratoren (ikke denne workers session) kører --apply mod prod efter merge.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateRaceStageProfiles, GENERATOR_VERSION } from "../lib/raceStageProfileGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DRY_RUN = !process.argv.includes("--apply"); // default: dry-run (apply kræver eksplicit --apply)
const seasonIdx = process.argv.indexOf("--season");
const SEASON = seasonIdx >= 0 ? Number(process.argv[seasonIdx + 1]) : 2;

const MOUNTAIN_PROFILE_TYPES = new Set(["mountain", "high_mountain"]);

// Kandidat-race_id'er (jf. kommentar-blok ovenfor). Navn/pulje/dag kun til log —
// selve selektionen er den hardkodede id-liste, ikke et query mod DB.
export const CANDIDATES = Object.freeze([
  // --- Division 2 (tier 2) — 2 rigtige løb × 2 puljer ---
  { race_id: "a3651e9c-8637-4bb2-ad6b-04edbee591db", name: "Limburgse Klassieker", tier: 2, pool_index: 0, game_day_start: 17 },
  { race_id: "939489fb-fe6a-4d3f-bb1a-ad9a58cc9e37", name: "Limburgse Klassieker", tier: 2, pool_index: 1, game_day_start: 17 },
  { race_id: "3e80936f-c213-4cc9-9d33-fd7b0766eab6", name: "Grand Prix du Saint-Laurent", tier: 2, pool_index: 0, game_day_start: 4 },
  { race_id: "d7fe055f-5432-4905-833e-1e38b0405e31", name: "Grand Prix du Saint-Laurent", tier: 2, pool_index: 1, game_day_start: 4 },

  // --- Division 3 (tier 3) — 3 rigtige løb × 4 puljer ---
  { race_id: "cbc95f00-6d17-4c10-ac6c-bc672e300749", name: "Brabantse Klassieker", tier: 3, pool_index: 0, game_day_start: 24 },
  { race_id: "ba72a2e5-7190-4ed8-a977-b829b67b01c8", name: "Brabantse Klassieker", tier: 3, pool_index: 1, game_day_start: 24 },
  { race_id: "5a6c36df-82e7-4907-9009-f9f6f0d73c41", name: "Brabantse Klassieker", tier: 3, pool_index: 2, game_day_start: 24 },
  { race_id: "040a48ec-ec0e-40db-81d4-d108c0a9e427", name: "Brabantse Klassieker", tier: 3, pool_index: 3, game_day_start: 24 },

  { race_id: "1a4eeeac-da95-4617-a158-a029b1ed8135", name: "Trofeo Ligure", tier: 3, pool_index: 0, game_day_start: 5 },
  { race_id: "0ec0da2b-91bb-4eb3-8537-f7aea37f272f", name: "Trofeo Ligure", tier: 3, pool_index: 1, game_day_start: 5 },
  { race_id: "7fd98e65-8f9e-480e-b57f-dd92b78737db", name: "Trofeo Ligure", tier: 3, pool_index: 2, game_day_start: 5 },
  { race_id: "4b6ab114-74e1-43b6-b32a-b99f17aef40a", name: "Trofeo Ligure", tier: 3, pool_index: 3, game_day_start: 5 },

  { race_id: "b284828f-1010-476d-afc7-8c633fa9559f", name: "Classique de la Drôme", tier: 3, pool_index: 0, game_day_start: 2 },
  { race_id: "0904937a-097f-4017-94c6-904d821f6fe4", name: "Classique de la Drôme", tier: 3, pool_index: 1, game_day_start: 2 },
  { race_id: "9674c538-a2ed-45f7-b11c-8218bb1c814c", name: "Classique de la Drôme", tier: 3, pool_index: 2, game_day_start: 2 },
  { race_id: "c01e7027-27cc-4ef7-99d6-e1a659ec5a50", name: "Classique de la Drôme", tier: 3, pool_index: 3, game_day_start: 2 },
]);

export const CANDIDATE_RACE_IDS = Object.freeze(CANDIDATES.map((c) => c.race_id));

// Ren funktion (testbar uden DB): bygger konverterings-planen for ét kandidat-løb.
// race: { id, race_type, season_id, pool_race_id, name }
// profileRow: { race_id, stage_number, profile_type, finale_type, distance_km, elevation_gain_m, is_manual } | undefined
// externalId: race_pool.external_id for race.pool_race_id (kan være null → generator falder tilbage til race.id-seed)
export function planOne({ race, profileRow, externalId, expectedSeasonId }) {
  const meta = { race_id: race?.id };
  if (!race) return { ...meta, status: "error", reason: "race ikke fundet" };
  if (race.race_type !== "single") return { ...meta, status: "error", reason: `race_type=${race.race_type} (kun endagsløb konverteres)` };
  if (expectedSeasonId && race.season_id !== expectedSeasonId) {
    return { ...meta, status: "error", reason: "season_id matcher ikke forventet sæson — springer over af sikkerhed" };
  }
  if (!profileRow) return { ...meta, status: "error", reason: "ingen race_stage_profiles-række (stage_number=1) fundet" };

  const before = {
    profile_type: profileRow.profile_type,
    finale_type: profileRow.finale_type,
    distance_km: profileRow.distance_km,
    elevation_gain_m: profileRow.elevation_gain_m,
    is_manual: !!profileRow.is_manual,
  };

  if (before.is_manual && MOUNTAIN_PROFILE_TYPES.has(before.profile_type)) {
    return { ...meta, name: race.name, status: "skip_already_converted", before };
  }

  // Skygge-race: KUN i hukommelsen. race_pool.terrain_archetype røres aldrig —
  // andre tiers' kopier af samme rigtige løb (fx D1/D4) er derfor upåvirkede.
  const shadowRace = {
    id: race.id,
    race_type: "single",
    external_id: externalId ?? null,
    terrain_archetype: "mountain_classic",
    season_id: race.season_id,
  };
  const [generated] = generateRaceStageProfiles(shadowRace);

  const after = {
    profile_type: generated.profile_type,
    finale_type: generated.finale_type,
    distance_km: generated.distance_km,
    elevation_gain_m: generated.elevation_gain_m,
    is_manual: true,
  };

  return {
    ...meta,
    name: race.name,
    status: "convert",
    before,
    after,
    update: {
      race_id: race.id,
      stage_number: profileRow.stage_number,
      profile_type: generated.profile_type,
      finale_type: generated.finale_type,
      demand_vector: generated.demand_vector,
      distance_km: generated.distance_km,
      elevation_gain_m: generated.elevation_gain_m,
      climbs: generated.climbs,
      sprints: generated.sprints,
      sectors: generated.sectors,
      generator_version: GENERATOR_VERSION,
      is_manual: true,
    },
  };
}

// Bygger hele planen for CANDIDATES ud fra allerede-hentede races/profiles/catalogMeta.
export function buildConversionPlan({ candidates, races, profiles, catalogMeta, expectedSeasonId }) {
  const raceById = new Map(races.map((r) => [r.id, r]));
  const profileByRaceId = new Map(profiles.map((p) => [p.race_id, p]));
  return candidates.map((c) => {
    const race = raceById.get(c.race_id);
    const externalId = race ? catalogMeta.get(race.pool_race_id)?.external_id ?? null : null;
    const profileRow = profileByRaceId.get(c.race_id);
    return { tier: c.tier, pool_index: c.pool_index, game_day_start: c.game_day_start, ...planOne({ race, profileRow, externalId, expectedSeasonId }) };
  });
}

function fmtRow(p) {
  const loc = `T${p.tier}/pulje${p.pool_index}`;
  if (p.status === "error") return `  ❌ ${loc} ${p.race_id} — ${p.reason}`;
  if (p.status === "skip_already_converted") return `  ⏭️  ${loc} ${p.name} (${p.race_id}) — allerede konverteret (${p.before.profile_type}, is_manual)`;
  const b = p.before, a = p.after;
  return `  ✅ ${loc} ${p.name.padEnd(28)} dag ${String(p.game_day_start).padStart(2)} — ${b.profile_type}/${b.elevation_gain_m}hm → ${a.profile_type}/${a.elevation_gain_m}hm (${a.finale_type})`;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE creds"); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: season, error: seasonErr } = await supabase.from("seasons").select("id").eq("number", SEASON).single();
  if (seasonErr || !season) throw new Error(`Sæson ${SEASON} ikke fundet: ${seasonErr?.message}`);

  const ids = [...CANDIDATE_RACE_IDS];
  const [{ data: races, error: racesErr }, { data: profiles, error: profilesErr }] = await Promise.all([
    supabase.from("races").select("id, name, race_type, season_id, pool_race_id").in("id", ids),
    supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type, finale_type, distance_km, elevation_gain_m, is_manual").in("race_id", ids).eq("stage_number", 1),
  ]);
  if (racesErr) throw new Error(`races select: ${racesErr.message}`);
  if (profilesErr) throw new Error(`race_stage_profiles select: ${profilesErr.message}`);

  const poolRaceIds = [...new Set((races || []).map((r) => r.pool_race_id).filter(Boolean))];
  const { data: catalog, error: catalogErr } = await supabase.from("race_pool").select("id, external_id").in("id", poolRaceIds);
  if (catalogErr) throw new Error(`race_pool select: ${catalogErr.message}`);
  const catalogMeta = new Map((catalog || []).map((c) => [c.id, { external_id: c.external_id }]));

  console.log(`=== convertHillyToMountainClassics ${DRY_RUN ? "(DRY-RUN)" : "(APPLY)"} — sæson ${SEASON} — ${ids.length} kandidater ===\n`);
  const plan = buildConversionPlan({ candidates: CANDIDATES, races: races || [], profiles: profiles || [], catalogMeta, expectedSeasonId: season.id });
  for (const p of plan) console.log(fmtRow(p));

  const toConvert = plan.filter((p) => p.status === "convert");
  const skipped = plan.filter((p) => p.status === "skip_already_converted");
  const errors = plan.filter((p) => p.status === "error");

  console.log(`\nKonverteres: ${toConvert.length} · allerede konverteret (sprunget over): ${skipped.length} · fejl: ${errors.length}`);
  if (errors.length) {
    console.error("\n❌ Fejl fundet — apply afbrydes.");
    process.exit(1);
  }

  if (!DRY_RUN) {
    for (const p of toConvert) {
      const { error } = await supabase.from("race_stage_profiles").update(p.update).eq("race_id", p.update.race_id).eq("stage_number", p.update.stage_number);
      if (error) throw new Error(`update ${p.race_id}: ${error.message}`);
    }
    console.log(`\n✅ Skrev ${toConvert.length} rækker (is_manual=true).`);
  } else {
    console.log("\n(DRY-RUN) Skriver intet. Kør med --apply for at skrive.");
  }
}

// Kør kun main() når filen eksekveres direkte (ikke ved import i tests) — samme
// mønster som backfillRaceScheduledFor.js (URL-sammenligning er skrøbelig på Windows).
if (process.argv[1] && process.argv[1].endsWith("convertHillyToMountainClassics.js")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
