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
