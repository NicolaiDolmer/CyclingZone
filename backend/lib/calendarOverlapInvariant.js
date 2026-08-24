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

import { TIER_OVERLAP_CAP, minGameDaysPerRealDay } from "./calendarTierCaps.js";

/**
 * @param {{ scheduleRows: Array<{race_id, stage_number?, game_day, scheduled_at?}>,
 *           tier?: number, overlapCap?: number, maxViolations?: number,
 *           monumentRaceIds?: Set<string>|string[] }} args
 *   `scheduleRows` skal være ÉN pulje (league_division_id), ikke en hel tier — alle puljer i
 *   en tier deler kalender-FORM, men er selvstændige binding-rum (#2276).
 *   `monumentRaceIds` aktiverer #4075-kontrollen: et monument skal have sin in-game-dag for
 *   sig selv. Udelades den, tælles nul brud (bagudkompatibelt).
 * @returns {{ overlapViolations, stageRepeatViolations, monumentSharedDayViolations,
 *             maxOverlap, overlapCap, gameDayCount, realDayCount,
 *             minGameDaysPerCalendarDay, axisLooksCollapsed }}
 */
export function checkCalendarOverlapInvariants({
  scheduleRows = [], tier = null, overlapCap = null, maxViolations = 50, monumentRaceIds = null,
} = {}) {
  const monuments = monumentRaceIds instanceof Set ? monumentRaceIds : new Set(monumentRaceIds ?? []);
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

  // #4075 (ejer-låst 21/8): et monument har sin EGEN in-game-dag — ingen modløb, så alle
  // ryttere kan stille op. Kalender-DATOEN må det gerne dele. Pakkeren bygger reglen ind,
  // men #4161-reparationen udledte aksen af datoerne alene og klappede monumenterne sammen
  // med naboløbene. Uden denne tælling er reglen kun en hensigt i generatoren (#4176).
  const monumentSharedDayViolations = [];
  if (monuments.size) {
    for (const [game_day, races] of [...racesByGameDay.entries()].sort((a, b) => a[0] - b[0])) {
      const mons = [...races].filter((id) => monuments.has(id));
      if (!mons.length) continue;
      const others = [...races].filter((id) => !monuments.has(id));
      if (others.length === 0 && mons.length === 1) continue;
      monumentSharedDayViolations.push({
        game_day, monument_race_ids: mons, other_race_ids: others,
        races_on_day: races.size,
      });
    }
  }

  // Diagnostik: er aksen fladet ud? For Div 1-3 skal der ligge FLERE in-game-dage inden i
  // hver kalenderdag (mindst ceil(density/cap), i Div 1 typisk 3-5). Falder antallet af
  // distinkte game_days sammen med antallet af kalenderdage, er game_day skrevet som en ren
  // dato-offset. For Div 4 er ét til én derimod korrekt. Se #4161.
  const minGameDaysPerCalendarDay = tier == null ? null : minGameDaysPerRealDay(tier);
  const gameDayCount = racesByGameDay.size;
  const realDayCount = realDays.size;
  const axisLooksCollapsed = Boolean(
    minGameDaysPerCalendarDay && minGameDaysPerCalendarDay > 1 &&
    realDayCount > 0 && gameDayCount <= realDayCount
  );

  return {
    overlapViolations: overlapViolations.slice(0, maxViolations),
    overlapViolationCount: overlapViolations.length,
    stageRepeatViolations: stageRepeatViolations.slice(0, maxViolations),
    stageRepeatViolationCount: stageRepeatViolations.length,
    monumentSharedDayViolations: monumentSharedDayViolations.slice(0, maxViolations),
    monumentSharedDayViolationCount: monumentSharedDayViolations.length,
    maxOverlap, overlapCap: cap,
    gameDayCount, realDayCount, minGameDaysPerCalendarDay, axisLooksCollapsed,
  };
}
