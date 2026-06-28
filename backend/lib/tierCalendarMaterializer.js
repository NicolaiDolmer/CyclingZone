// backend/lib/tierCalendarMaterializer.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec + ejer-billede): bind den rene pipeline
// sammen til en MATERIALISERINGS-PLAN pr. division (tier) og fan-out den IDENTISKE kalender til
// hver LIVE pulje ("Division 3 kører samme løb, parallelt i sine 4 puljer").
//
// Form (ejer-låst): hver division fylder en PRÆCIS game-day-kvote (140/112/84/56) med DE STØRSTE
// løb (prestige), pakket så HVER IRL-dag rammer præcis density (5/4/3/2) stage-events: Grand Tours
// komprimeret som spredt rygrad MED overlap, klassikere fylder op. Hver etape kører i sin banes
// faste tids-slot (div 3 = 12/15/18). Monumenter binding-fri (game_day i højt bånd).
//
// buildTierMaterializationPlan er REN (ingen DB) → testbar. materializeTierCalendars = I/O-wrapper.

import { poolHasCalendar } from "./divisionCalendarGenerator.js";
import { selectTierRaceSet, TIER_GAME_DAY_QUOTA, GRAND_TOUR_MIN_STAGES } from "./tierRaceSelection.js";
import { packLaneCalendar, MONUMENT_GAMEDAY_BASE } from "./raceCalendarLanePacker.js";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { generateRaceStageProfiles, GENERATOR_VERSION } from "./raceStageProfileGenerator.js";

export { MONUMENT_GAMEDAY_BASE };

const INSERT_BATCH = 500;

// Tæthed pr. division (= "løbsdage kørt om dagen", ejer-låst). quota = density × realDays.
export const TIER_DENSITY = Object.freeze({ 1: 5, 2: 4, 3: 3, 4: 2 });

// Overlap-cap pr. division (ejer-låst 2026-06-28): max antal FORSKELLIGE løb der må binde en rytter
// samtidig (= samtidige løb pr. in-game-dag). Div 1/2 = 3, Div 3/4 = 2. Adskilt fra tæthed: tætheden
// er pacing (etaper/IRL-dag), cap'en er binding-tryk (forskellige løb/game-dag).
export const TIER_OVERLAP_CAP = Object.freeze({ 1: 3, 2: 3, 3: 2, 4: 2 });

// Etape-tids-slots pr. division: bane k → slots[k] (ejer-låst: div 3 = 12/15/18). Antal slots =
// density, så en dag aldrig har flere etaper end slots.
export const TIER_STAGE_SLOTS = Object.freeze({
  1: ["11:00", "13:00", "15:00", "17:00", "19:00"],
  2: ["12:00", "14:00", "16:00", "18:00"],
  3: ["12:00", "15:00", "18:00"],
  4: ["12:00", "18:00"],
});

function isRealManagerRow(t) {
  return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
}
function editionYearFrom(startDate) {
  if (!startDate) return null;
  const y = Number.parseInt(String(startDate).slice(0, 4), 10);
  return Number.isFinite(y) && y >= 2000 && y <= 2099 ? y : null;
}

/**
 * @param {{ pools, catalog, from?, realDays?, quotas?, density?, slots?, baseSeed? }} args
 * @returns {{ tierPlans: Array<object> }}
 */
export function buildTierMaterializationPlan({
  pools = [],
  catalog = [],
  from = new Date(),
  realDays = 28,
  quotas = TIER_GAME_DAY_QUOTA,
  density = TIER_DENSITY,
  overlapCaps = TIER_OVERLAP_CAP,
  slots = TIER_STAGE_SLOTS,
  baseSeed = 1,
} = {}) {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const liveByTier = new Map();
  for (const p of pools) {
    if (!poolHasCalendar(p.tier, p.realManagerCount)) continue;
    if (!liveByTier.has(p.tier)) liveByTier.set(p.tier, []);
    liveByTier.get(p.tier).push(p);
  }

  // Cross-tier dedup: øverste tier vælger først (de største løb), lavere fra resten.
  const usedRaceIds = new Set();
  const tierPlans = [];
  for (const [tier, tierPools] of [...liveByTier.entries()].sort((a, b) => a[0] - b[0])) {
    const availableCatalog = usedRaceIds.size ? catalog.filter((c) => !usedRaceIds.has(c.id)) : catalog;
    const quota = quotas[tier] ?? 0;
    const dens = density[tier] ?? 1;
    const cap = overlapCaps[tier] ?? 2;
    const tierSlots = slots[tier] ?? slots[3];

    const sel = selectTierRaceSet({ catalog: availableCatalog, quota, seed: (baseSeed ^ tier) >>> 0 });
    for (const r of sel.stageRaces) usedRaceIds.add(r.id);
    for (const r of sel.oneDayRaces) usedRaceIds.add(r.id);

    const packed = packLaneCalendar({ stageRaces: sel.stageRaces, oneDayRaces: sel.oneDayRaces, density: dens, days: realDays, overlapCap: cap, spineMinStages: GRAND_TOUR_MIN_STAGES });
    const { raceUpdates, stageRows } = buildScheduleRows({ placements: packed.placements, from, slots: tierSlots });

    const scheduledForById = new Map(raceUpdates.map((u) => [u.id, u.scheduled_for]));
    // game_day_start = løbets første IRL-dag (real_day), IKKE binding-nøglen (monumenter har bånd).
    const gameDayStartById = new Map();
    for (const pl of packed.placements) gameDayStartById.set(pl.id, Math.min(...pl.stagesPlaced.map((s) => s.real_day)));

    const poolPlans = tierPools.slice().sort((a, b) => a.id - b.id).map((pool) => {
      const raceRows = packed.placements.map((pl) => {
        const cat = catalogById.get(pl.id) || {};
        return {
          pool_race_id: pl.id,
          name: cat.name ?? null,
          race_class: cat.race_class ?? pl.race_class ?? null,
          race_type: cat.race_type ?? (pl.type === "single" ? "single" : "stage_race"),
          stages: pl.stages,
          game_day_start: gameDayStartById.get(pl.id),
          scheduled_for: scheduledForById.get(pl.id) ?? null,
        };
      });
      const poolStageRows = stageRows.map((s) => ({ pool_race_id: s.race_id, stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day }));
      return { leagueDivisionId: pool.id, tier, raceRows, stageRows: poolStageRows };
    });

    tierPlans.push({
      tier, quota, density: dens, overlapCap: cap,
      totalGameDays: sel.totalGameDays, quotaHit: sel.quotaHit, shortfall: sel.shortfall,
      raceCount: packed.placements.length,
      load: packed.load, emptyDays: packed.emptyDays, underfilledDays: packed.underfilledDays,
      overlapDays: packed.overlapDays, maxOverlap: packed.maxOverlap,
      overlapHistogram: packed.overlapHistogram, timelineLength: packed.timelineLength,
      straddleGameDays: packed.straddleGameDays,
      unplacedStages: packed.unplaced.length, unplacedSingles: packed.leftoverSingles.length,
      pools: poolPlans,
    });
  }

  return { tierPlans };
}

/**
 * I/O-wrapper: byg planen mod live data og (apply) skriv den pr. pulje. dryRun=true → ingen writes.
 * Kræver at season-løb er ryddet først for en ren rebuild.
 */
export async function materializeTierCalendars({
  supabase, seasonId, seasonStartDate = null, from = new Date(),
  baseSeed = 1, tiers = null, dryRun = true, log = () => {},
} = {}) {
  const editionYear = editionYearFrom(seasonStartDate);

  const { data: divisions, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const { data: teams, error: tErr } = await supabase.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const realByDiv = new Map();
  for (const t of teams || []) if (isRealManagerRow(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
  const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

  const { data: catalog, error: cErr } = await supabase.from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages");
  if (cErr) throw new Error(`race_pool: ${cErr.message}`);
  // Seed-nøgle pr. katalog-løb: external_id binder parcours til løbets VIRKELIGE
  // identitet (identisk parcours i en divisions puljer); terrain_archetype driver
  // terrænfordelingen (jf. raceStageProfileGenerator.js).
  const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));

  const { data: existing, error: exErr } = await supabase.from("races").select("league_division_id, pool_race_id").eq("season_id", seasonId);
  if (exErr) throw new Error(`races (existing): ${exErr.message}`);
  const existingKey = new Set((existing || []).map((r) => `${r.league_division_id}:${r.pool_race_id}`));

  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog || [], from, baseSeed });
  const summary = { dryRun, editionYear, racesInserted: 0, stageProfiles: 0, stageSchedules: 0, tiers: [] };

  for (const tierPlan of tierPlans) {
    if (tiers && !tiers.includes(tierPlan.tier)) continue;
    const tLine = {
      tier: tierPlan.tier, quota: tierPlan.quota, totalGameDays: tierPlan.totalGameDays, quotaHit: tierPlan.quotaHit,
      shortfall: tierPlan.shortfall, emptyDays: tierPlan.emptyDays, overlapDays: tierPlan.overlapDays,
      unplacedStages: tierPlan.unplacedStages, unplacedSingles: tierPlan.unplacedSingles, pools: [],
    };
    for (const poolPlan of tierPlan.pools) {
      const fresh = poolPlan.raceRows.filter((r) => !existingKey.has(`${poolPlan.leagueDivisionId}:${r.pool_race_id}`));
      const pLine = { pool_id: poolPlan.leagueDivisionId, selected: poolPlan.raceRows.length, fresh: fresh.length, inserted: 0 };
      if (dryRun || fresh.length === 0) { tLine.pools.push(pLine); continue; }

      const toInsert = fresh.map((r) => ({
        season_id: seasonId, league_division_id: poolPlan.leagueDivisionId, pool_race_id: r.pool_race_id,
        name: r.name, race_class: r.race_class, race_type: r.race_type, stages: r.stages,
        edition_year: editionYear, status: "scheduled", game_day_start: r.game_day_start, scheduled_for: r.scheduled_for,
      }));
      const inserted = [];
      for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
        const { data, error } = await supabase.from("races").insert(toInsert.slice(i, i + INSERT_BATCH)).select("id, pool_race_id, name, race_type, stages");
        if (error) throw new Error(`races insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
        inserted.push(...(data || []));
      }
      summary.racesInserted += inserted.length;
      const idByPoolRace = new Map(inserted.map((x) => [x.pool_race_id, x.id]));

      const profileRows = [];
      for (const race of inserted) {
        // external_id (samme parcours i alle puljer) + terrain_archetype (terrænkarakter)
        // + season_id (variation pr. sæson) fra konteksten.
        const seedRace = { ...race, external_id: externalIdByPoolRace.get(race.pool_race_id) ?? null, terrain_archetype: archetypeByPoolRace.get(race.pool_race_id) ?? null, season_id: seasonId };
        for (const p of generateRaceStageProfiles(seedRace)) {
          profileRows.push({ race_id: race.id, stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector, generator_version: GENERATOR_VERSION, is_manual: false });
        }
      }
      for (let i = 0; i < profileRows.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("race_stage_profiles").insert(profileRows.slice(i, i + INSERT_BATCH));
        if (error) throw new Error(`race_stage_profiles insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
      }
      summary.stageProfiles += profileRows.length;

      const schedRows = poolPlan.stageRows
        .filter((s) => idByPoolRace.has(s.pool_race_id))
        .map((s) => ({ race_id: idByPoolRace.get(s.pool_race_id), stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day }));
      for (let i = 0; i < schedRows.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("race_stage_schedule").insert(schedRows.slice(i, i + INSERT_BATCH));
        if (error) throw new Error(`race_stage_schedule insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
      }
      summary.stageSchedules += schedRows.length;

      pLine.inserted = inserted.length;
      tLine.pools.push(pLine);
      log(`  pulje ${poolPlan.leagueDivisionId} (tier ${tierPlan.tier}): +${inserted.length} løb · ${profileRows.length} profiler · ${schedRows.length} etape-tider`);
    }
    summary.tiers.push(tLine);
  }
  return summary;
}
