// Pure month-grid helpers for the Race Calendar page (#in-game-race-calendar).
// No React, no I/O — so `node --test` can load this directly and calendarGrid.test.js
// can verify the Monday-first grid + date grouping without rendering.
//
// Dates are plain "YYYY-MM-DD" strings (from the API, already projected to
// Europe/Copenhagen). We never construct a Date from them with new Date("...") to
// avoid the UTC-midnight timezone skew — all math is on the {year, month, day} parts.

// Days in a given month (1-based month). Handles leap years.
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Weekday index Monday-first (0=Mon … 6=Sun) for a Y-M-D, via Zeller-free Date()
// in local time but only reading getDay() (no time component → no TZ skew on the
// weekday itself). new Date(y, m-1, d) is local-midnight; getDay() returns 0=Sun.
export function mondayFirstWeekday(year, month, day) {
  const js = new Date(year, month - 1, day).getDay(); // 0=Sun..6=Sat
  return (js + 6) % 7; // 0=Mon..6=Sun
}

// Builds the 7-column grid for a month: an array of weeks, each a 7-slot array of
// cells. Leading/trailing slots outside the month are null. Each in-month cell is
// { year, month, day, iso }.
export function buildMonthGrid(year, month) {
  const total = daysInMonth(year, month);
  const lead = mondayFirstWeekday(year, month, 1);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) {
    cells.push({ year, month, day: d, iso: isoOf(year, month, d) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function isoOf(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

// Groups calendar entries by their ISO date → Map<iso, entry[]>. Entries without a
// date (no schedule yet) are dropped from the grid (they have no calendar cell).
export function groupEntriesByDate(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!e.date) continue;
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

// The set of months (as {year, month}) that contain at least one entry, sorted.
// Lets the page default to the first month with races and bound month navigation.
export function monthsWithRaces(entries) {
  const seen = new Set();
  for (const e of entries || []) {
    if (!e.date) continue;
    seen.add(e.date.slice(0, 7)); // "YYYY-MM"
  }
  return [...seen]
    .sort()
    .map((ym) => ({ year: +ym.slice(0, 4), month: +ym.slice(5, 7) }));
}

// Steps a {year, month} by ±1 month, rolling the year. Pure.
export function stepMonth({ year, month }, delta) {
  let y = year;
  let m = month + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

// Filters entries to a single month (and optionally a division/tier and "mine only").
export function filterEntries(entries, { year, month, division = null, mineOnly = false } = {}) {
  const prefix = `${year}-${pad2(month)}`;
  return (entries || []).filter((e) => {
    if (!e.date || !e.date.startsWith(prefix)) return false;
    if (division != null && e.division !== division) return false;
    if (mineOnly && !e.isMine) return false;
    return true;
  });
}
