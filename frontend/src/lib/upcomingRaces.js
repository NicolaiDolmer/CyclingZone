// #2328 — "Kommende løb"-kortet på Dashboard viste forkerte løb: top-3 blev
// valgt ved at sortere på pool_race.date_text (en statisk PCM-kalenderdato,
// ikke relateret til det ægte real-time-forløb) FØR den ægte etape-tid
// (race_stage_schedule.scheduled_at) overhovedet var hentet. Resultatet var
// et vilkårligt udsnit af puljens løb — ikke nødvendigvis de faktisk
// kommende (fx dagens etaper).
//
// pickUpcomingRaces sorterer i stedet på den ÆGTE næste-etape-tid
// (nextStageMsById, hentet fra race_stage_schedule) — så etaper der køres
// I DAG kommer først; er alle dagens etaper kørt, kommer næste dags etaper
// naturligt næst efter (højere scheduled_at-værdi). Løb hvor den ægte tid
// endnu ikke er hentet/kendt (mangler i nextStageMsById) placeres sidst,
// med den gamle PCM-dato som stabilt (men sekundært) sorteringskriterie.
//
// Pure → node --test-dækket, ingen React/I/O.

import { dateTextToDayOfYear } from "./raceCalendar.js";

/**
 * @param {Array<{id:string, pool_race?:{date_text?:string|null}|null}>} races
 * @param {Record<string, number>} nextStageMsById - race id -> ms (Date.parse af
 *   race_stage_schedule.scheduled_at for den næste uafviklede etape)
 * @param {number} limit
 * @returns {Array} ny array, muterer ikke input
 */
export function pickUpcomingRaces(races, nextStageMsById = {}, limit = 3) {
  if (!Array.isArray(races)) return [];
  return races
    .map((race, index) => ({ race, index }))
    .sort((a, b) => {
      const aMs = nextStageMsById?.[a.race?.id];
      const bMs = nextStageMsById?.[b.race?.id];
      const aKnown = Number.isFinite(aMs);
      const bKnown = Number.isFinite(bMs);
      if (aKnown && bKnown && aMs !== bMs) return aMs - bMs;
      if (aKnown && !bKnown) return -1;
      if (!aKnown && bKnown) return 1;
      const aDate = dateTextToDayOfYear(a.race?.pool_race?.date_text);
      const bDate = dateTextToDayOfYear(b.race?.pool_race?.date_text);
      if (aDate !== bDate) return aDate - bDate;
      return a.index - b.index; // stabil
    })
    .slice(0, limit)
    .map((entry) => entry.race);
}
