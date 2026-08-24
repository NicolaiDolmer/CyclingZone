// backend/lib/calendarOverlapInvariant.js
// #4161: kalender-loft som VERIFICERBAR invariant, ikke kun som en konstant pakkeren
// forsøger at ramme.
//
// Baggrund: `TIER_OVERLAP_CAP` (ejer-låst 2026-06-28) siger hvor mange FORSKELLIGE løb der
// må dele én in-game-dag. raceCalendarLanePacker.js overholder den, og dens egne tests
// hævder det — men intet har hidtil verificeret at DE RÆKKER DER FAKTISK LIGGER I
// DATABASEN stadig overholder den. Reparations-scripts, ad-hoc-SQL og backfills skriver
// også `race_stage_schedule`, og en af dem (#4155-reparationen) fladede game_day-aksen ud
// til én game_day pr. kalenderdag. Det brød cap'en i ALLE fire divisioner uden at nogen
// gate opdagede det.
//
// REN + deterministisk (ingen DB, ingen Date, ingen random) — kaldes både fra
// verify-invariants (prod) og fra unit-tests.

import { TIER_OVERLAP_CAP, gameDaysPerRealDay } from "./calendarTierCaps.js";

/**
 * @param {{ scheduleRows: Array<{race_id, stage_number?, game_day, scheduled_at?}>,
 *           tier?: number, overlapCap?: number, maxViolations?: number }} args
 *   `scheduleRows` skal være ÉN pulje (league_division_id), ikke en hel tier — alle puljer i
 *   en tier deler kalender-FORM, men er selvstændige binding-rum (#2276).
 * @returns {{ overlapViolations, stageRepeatViolations, maxOverlap, overlapCap,
 *             gameDayCount, realDayCount, expectedGameDaysPerRealDay, axisLooksCollapsed }}
 */
export function checkCalendarOverlapInvariants({
  scheduleRows = [], tier = null, overlapCap = null, maxViolations = 50,
} = {}) {
  const cap = overlapCap ?? (tier == null ? null : TIER_OVERLAP_CAP[tier]) ?? null;

  const racesByGameDay = new Map();      // game_day -> Set(race_id)
  const stagesByRaceGameDay = new Map(); // `${race_id}|${game_day}` -> stage_number[]
  const realDays = new Set();

  for (const row of scheduleRows) {
    const gd = row?.game_day;
    if (!Number.isFinite(gd)) continue; // rækker uden game_day hører til det gamle nøglerum (raceBinding.js)
    if (!racesByGameDay.has(gd)) racesByGameDay.set(gd, new Set());
    racesByGameDay.get(gd).add(row.race_id);

    const key = `${row.race_id}|${gd}`;
    if (!stagesByRaceGameDay.has(key)) stagesByRaceGameDay.set(key, []);
    stagesByRaceGameDay.get(key).push(row.stage_number ?? null);

    if (row.scheduled_at) realDays.add(String(row.scheduled_at).slice(0, 10));
  }

  const overlapViolations = [];
  let maxOverlap = 0;
  for (const [game_day, races] of [...racesByGameDay.entries()].sort((a, b) => a[0] - b[0])) {
    if (races.size > maxOverlap) maxOverlap = races.size;
    if (cap != null && races.size > cap) {
      overlapViolations.push({ game_day, races: races.size, cap, race_ids: [...races] });
    }
  }

  // Pakker-kontrakten: HVER etape får sin EGEN game-dag. To etaper af SAMME løb på samme
  // in-game-dag betyder at aksen er skrevet forkert — og at rytterne i praksis kører to
  // etaper på én dag uden at binding-laget kan se det.
  const stageRepeatViolations = [];
  for (const [key, stages] of stagesByRaceGameDay.entries()) {
    if (stages.length <= 1) continue;
    const [race_id, gd] = key.split("|");
    stageRepeatViolations.push({
      race_id, game_day: Number(gd), stages: stages.length,
      stage_numbers: stages.filter((s) => s != null).sort((a, b) => a - b),
    });
  }
  stageRepeatViolations.sort((a, b) => b.stages - a.stages || a.game_day - b.game_day);

  // Diagnostik: er aksen fladet ud? For Div 1-3 er K = 2, så antallet af distinkte
  // game_days SKAL være markant større end antallet af kalenderdage. Er de ens, er
  // game_day blevet skrevet som en ren dato-offset (se #4161-postmortem).
  const expectedGameDaysPerRealDay = tier == null ? null : gameDaysPerRealDay(tier);
  const gameDayCount = racesByGameDay.size;
  const realDayCount = realDays.size;
  const axisLooksCollapsed = Boolean(
    expectedGameDaysPerRealDay && expectedGameDaysPerRealDay > 1 &&
    realDayCount > 0 && gameDayCount <= realDayCount
  );

  return {
    overlapViolations: overlapViolations.slice(0, maxViolations),
    overlapViolationCount: overlapViolations.length,
    stageRepeatViolations: stageRepeatViolations.slice(0, maxViolations),
    stageRepeatViolationCount: stageRepeatViolations.length,
    maxOverlap, overlapCap: cap,
    gameDayCount, realDayCount, expectedGameDaysPerRealDay, axisLooksCollapsed,
  };
}
