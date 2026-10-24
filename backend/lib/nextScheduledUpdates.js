// #6962 — tidspunkt for næste ugentlige opdateringer, til Dashboard "Næste træk".
// Ren funktion: ingen DB, ingen konstanter ændres. Tiderne følger de samme gates
// som cron-modulerne:
//   - værdiopdatering: søndag fra SUNDAY_VALUE_FROM_HOUR dansk tid (sundayValueSweep.js)
//   - akademi-intake: søndag 00:00 dansk tid (sundayIntakeTick.js, claim pr. søndag)
import { SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";
import {
  copenhagenDateString,
  copenhagenHour,
  copenhagenWeekdayKey,
  copenhagenWallTimeToUTC,
} from "./copenhagenTime.js";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Dansk kalenderdato (YYYY-MM-DD) for den kommende søndag; "i dag" tæller kun med
// hvis includeToday. Datoregning ved UTC-middag (DST-robust).
function sundayDate(now, includeToday) {
  const today = copenhagenDateString(now);
  const dow = WEEKDAYS.indexOf(copenhagenWeekdayKey(today));
  let ahead = (7 - dow) % 7;
  if (ahead === 0 && !includeToday) ahead = 7;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ahead);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {Date} now
 * @returns {Date} UTC-instant for næste søndags værdiopdatering
 */
export function nextValueUpdateAt(now = new Date()) {
  const todayIsSunday = copenhagenWeekdayKey(copenhagenDateString(now)) === "sun";
  const stillToday = todayIsSunday && copenhagenHour(now) < SUNDAY_VALUE_FROM_HOUR;
  return copenhagenWallTimeToUTC(sundayDate(now, stillToday), SUNDAY_VALUE_FROM_HOUR);
}

/**
 * Akademi-drippet kører søndag 00:00 og er claim-idempotent: er det søndag, er
 * dagens kuld allerede trukket, og det næste er næste søndag.
 * @param {Date} now
 * @returns {Date} UTC-instant for næste søndags akademi-intake
 */
export function nextAcademyIntakeAt(now = new Date()) {
  return copenhagenWallTimeToUTC(sundayDate(now, false), 0);
}

/**
 * @param {{ now?: Date, academyIntakeScheduled?: boolean }} opts
 *   academyIntakeScheduled=false (akademi slukket, eller pull-flaget overtager
 *   intaget) udelader intake-tiden, så dashboardet ikke lover et automatisk kuld.
 */
export function buildNextScheduledUpdates({ now = new Date(), academyIntakeScheduled = false } = {}) {
  return {
    value_update_at: nextValueUpdateAt(now).toISOString(),
    academy_intake_at: academyIntakeScheduled ? nextAcademyIntakeAt(now).toISOString() : null,
  };
}
