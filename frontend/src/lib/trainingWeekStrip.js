// Uge-strippen på trænings-overblikket (#4613, ejer-valgt retning B 3/9).
//
// Overbliks-rækken skal vise rytterens NÆSTE 7 DAGE som én lille strimmel, så
// man kan se rytmen (hårde dage, hviledage, en løbsdag) uden at åbne noget.
//
// Ren afledning af data siden ALLEREDE har:
//   - riderWeekPlans[riderId]  (rytterens egen ugeplan-override, useTraining)
//   - weekPlan                 (holdets ugerytme, useTraining)
//   - planFor(riderId)         (rytterens egen eksplicitte plan)
//   - racingToday[riderId]     (om han racer I DAG, useTraining)
// Ingen nye kald, ingen nye tabeller.
//
// #1162/TASTE P11 — vi opdigter INGENTING: `racingToday` kender kun DAGEN i dag
// (backend leverer ingen kalender fremad til denne flade), så kun dag 0 kan
// markeres som løbsdag. De øvrige 6 dage viser den intensitet lagdelingen
// giver dem, hvilket er præcis det motoren ville bruge hvis dagen kørte nu.

import { WEEKDAY_KEYS, weekdayKeyForDate, resolveDayIntensityDisplay } from "./training.js";

export const WEEK_STRIP_DAYS = 7;

// De næste `count` dage fra og med i dag, som ugedags-nøgler i rækkefølge.
export function weekStripWeekdays(fromDate = new Date(), count = WEEK_STRIP_DAYS) {
  const startIndex = WEEKDAY_KEYS.indexOf(weekdayKeyForDate(fromDate));
  if (startIndex < 0) return [];
  return Array.from({ length: Math.max(0, count) }, (_, offset) => ({
    weekday: WEEKDAY_KEYS[(startIndex + offset) % WEEKDAY_KEYS.length],
    offset,
    isToday: offset === 0,
  }));
}

// [{ weekday, offset, isToday, intensity, isRace }] for én rytter.
export function riderWeekStrip({
  fromDate = new Date(),
  riderOverrideDays = null,
  teamWeekDays = null,
  planIntensity = "normal",
  hasExplicitPlan = false,
  racingToday = false,
  count = WEEK_STRIP_DAYS,
} = {}) {
  return weekStripWeekdays(fromDate, count).map((day) => ({
    ...day,
    intensity: resolveDayIntensityDisplay({
      weekday: day.weekday,
      riderOverrideDays,
      teamWeekDays,
      planIntensity,
      hasExplicitPlan,
    }),
    isRace: day.isToday && Boolean(racingToday),
  }));
}
