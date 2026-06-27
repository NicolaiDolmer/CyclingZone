// backend/lib/tierCalendarMaterializer.js
// Kalender-rebuild (2026-06-27): bind den rene pipeline (udvælgelse → pakker → schedule)
// sammen til en MATERIALISERINGS-PLAN pr. division (tier), og fan-out den IDENTISKE kalender
// til hver LIVE pulje i tieren ("Division 3 kører samme løb, parallelt i sine 4 puljer").
//
// buildTierMaterializationPlan er REN (ingen DB) → testbar. materializeTierCalendars er den
// tynde I/O-wrapper (gated: dryRun returnerer planen, apply skriver). Skema-noter fra recon:
//   races: season_id, league_division_id, pool_race_id, name, race_class, race_type, stages,
//          edition_year, status='scheduled', game_day_start (NY kolonne), scheduled_for
//   race_stage_schedule: race_id, stage_number, scheduled_at, game_day (NY kolonne)
// Idempotens-nøgle (uændret): `${league_division_id}:${pool_race_id}`.

import { poolHasCalendar, DEFAULT_TIER_RACE_CLASSES } from "./divisionCalendarGenerator.js";
import { selectTierRaceSet, DEFAULT_TIER_CALENDAR } from "./tierRaceSelection.js";
import { packDivisionCalendar } from "./raceCalendarPacker.js";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { generateRaceStageProfiles, GENERATOR_VERSION } from "./raceStageProfileGenerator.js";

const INSERT_BATCH = 500;
// Samme "ægte manager"-diskriminator som seasonCalendarMaterializer/aiTeamGenerator — HOLD I SYNC.
function isRealManagerRow(t) {
  return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
}
function editionYearFrom(startDate) {
  if (!startDate) return null;
  const y = Number.parseInt(String(startDate).slice(0, 4), 10);
  return Number.isFinite(y) && y >= 2000 && y <= 2099 ? y : null;
}

/**
 * @param {{
 *   pools: Array<{id, tier, realManagerCount?, label?}>,
 *   catalog: Array<{id, name, race_class, race_type, stages}>,
 *   from?: Date, realDays?: number,
 *   tierRaceClasses?: object, tierConfig?: object, baseSeed?: number,
 * }} args
 * @returns {{ tierPlans: Array<{ tier, emptyDays, truncatedStages, truncatedSingles,
 *   pools: Array<{ leagueDivisionId, tier, raceRows, stageRows }> }> }}
 *   raceRows: { pool_race_id, name, race_class, race_type, stages, game_day_start, scheduled_for }
 *   stageRows: { pool_race_id, stage_number, scheduled_at, game_day }  (pool_race_id remappes til race.id ved write)
 */
export function buildTierMaterializationPlan({
  pools = [],
  catalog = [],
  from = new Date(),
  realDays = 28,
  tierRaceClasses = DEFAULT_TIER_RACE_CLASSES,
  tierConfig = DEFAULT_TIER_CALENDAR,
  baseSeed = 1,
} = {}) {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const liveByTier = new Map();
  for (const p of pools) {
    if (!poolHasCalendar(p.tier, p.realManagerCount)) continue;
    if (!liveByTier.has(p.tier)) liveByTier.set(p.tier, []);
    liveByTier.get(p.tier).push(p);
  }

  const tierPlans = [];
  for (const [tier, tierPools] of [...liveByTier.entries()].sort((a, b) => a - b)) {
    const sel = selectTierRaceSet({
      catalog, raceClasses: tierRaceClasses[tier] || [],
      seed: (baseSeed ^ tier) >>> 0, ...(tierConfig[tier] || {}),
    });
    const packed = packDivisionCalendar({
      stageRaces: sel.stageRaces, oneDayRaces: sel.oneDayRaces, forcedOverlaps: sel.forcedOverlaps, realDays,
    });
    const { raceUpdates, stageRows } = buildScheduleRows({ placements: packed.placements, from });

    const scheduledForById = new Map(raceUpdates.map((u) => [u.id, u.scheduled_for]));
    const gameDayStartById = new Map();
    for (const pl of packed.placements) {
      const g = Math.min(...pl.stagesPlaced.map((s) => s.game_day));
      gameDayStartById.set(pl.id, g);
    }

    // Samme races-/stage-rækker materialiseres i hver live pulje i tieren.
    const poolPlans = tierPools
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((pool) => {
        const raceRows = packed.placements.map((pl) => {
          const cat = catalogById.get(pl.id) || {};
          return {
            pool_race_id: pl.id,
            name: cat.name ?? null,
            race_class: cat.race_class ?? null,
            race_type: cat.race_type ?? (pl.type === "single" ? "single" : "stage_race"),
            stages: pl.stages,
            game_day_start: gameDayStartById.get(pl.id),
            scheduled_for: scheduledForById.get(pl.id) ?? null,
          };
        });
        const poolStageRows = stageRows.map((s) => ({
          pool_race_id: s.race_id, stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day,
        }));
        return { leagueDivisionId: pool.id, tier, raceRows, stageRows: poolStageRows };
      });

    tierPlans.push({
      tier,
      emptyDays: packed.emptyDays,
      truncatedStages: sel.truncatedStages,
      truncatedSingles: sel.truncatedSingles,
      pools: poolPlans,
    });
  }

  return { tierPlans };
}

/**
 * I/O-wrapper: byg planen mod live data og (apply) skriv den pr. pulje.
 * dryRun=true returnerer kun summary (ingen writes). tiers=[3] scoper til Division 3.
 * KRÆVER migration (game_day-kolonner) for apply — dryRun kører uden.
 *
 * @param {{ supabase, seasonId, seasonStartDate?, from?, baseSeed?, tiers?: number[]|null, dryRun?, log? }} args
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

  const { data: catalog, error: cErr } = await supabase.from("race_pool").select("id, name, race_class, race_type, stages");
  if (cErr) throw new Error(`race_pool: ${cErr.message}`);

  const { data: existing, error: exErr } = await supabase.from("races").select("league_division_id, pool_race_id").eq("season_id", seasonId);
  if (exErr) throw new Error(`races (existing): ${exErr.message}`);
  const existingKey = new Set((existing || []).map((r) => `${r.league_division_id}:${r.pool_race_id}`));

  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog || [], from, baseSeed });
  const summary = { dryRun, editionYear, racesInserted: 0, stageProfiles: 0, stageSchedules: 0, tiers: [] };

  for (const tierPlan of tierPlans) {
    if (tiers && !tiers.includes(tierPlan.tier)) continue;
    const tLine = { tier: tierPlan.tier, emptyDays: tierPlan.emptyDays, truncatedStages: tierPlan.truncatedStages, truncatedSingles: tierPlan.truncatedSingles, pools: [] };
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
        for (const p of generateRaceStageProfiles(race)) {
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
