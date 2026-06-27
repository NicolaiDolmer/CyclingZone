// Sikkert `from`-anker til kalender-materializeren. buildScheduleRows mapper real_day d
// → from + (d+1) danske kalenderdage, så `from` skal være den danske dag FØR den ønskede
// første løbsdag. Default = næste mandag.
//
// Rod-årsag for 27/6-blitzen: `from = season.start_date` på en IGANGVÆRENDE sæson gav
// dag-0 i FORTIDEN → forfaldne etaper → race-scheduleren blitzede løb. Guarden her gør
// den fejlklasse umulig: en første løbsdag i fortiden/i dag afvises (materialisér ALDRIG
// en kalender med scheduled_at <= now på et live spil). Se .claude/learnings/2026-06-27-d3-reset-blitz.md.

import { copenhagenDateString } from "./copenhagenTime.js";

// "YYYY-MM-DD" → ugedag (0=søn..6=lør). Tz-uafhængigt: en kalenderdatos ugedag er entydig,
// ankret kl. 12 UTC (midt på dagen, ingen DST-kant).
function weekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

// "YYYY-MM-DD" + n dage → "YYYY-MM-DD". Kl. 12 UTC → entydig dansk kalenderdag (Date.UTC
// håndterer måneds-/års-overløb).
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return copenhagenDateString(new Date(Date.UTC(y, m - 1, d + n, 12)));
}

// Den tidligste mandag >= `now`s danske dato (i dag, hvis i dag er mandag).
export function nextMonday(now = new Date()) {
  const today = copenhagenDateString(now);
  const delta = (1 - weekday(today) + 7) % 7; // 1 = mandag
  return addDays(today, delta);
}

// `from`-ankeret der får dag-0 (real_day 0) til at lande på `firstRaceDate` (dansk
// "YYYY-MM-DD"; default = næste mandag). Kaster hvis datoen ikke er strengt i fremtiden.
export function resolveCalendarFrom({ firstRaceDate, now = new Date() } = {}) {
  const today = copenhagenDateString(now);
  // Default = næste mandag. På en MANDAG returnerer nextMonday i dag → ryk en uge frem,
  // så no-arg-stien (rebuild-scripts uden --first-day) altid får en fremtidig dag (ikke kaster).
  let first = firstRaceDate || nextMonday(now);
  if (!firstRaceDate && first <= today) first = addDays(first, 7);
  if (first <= today) {
    throw new Error(
      `første løbsdag ${first} er i fortiden/i dag (i dag ${today}) — materialisér aldrig kalenderen i fortiden (jf. 27/6-blitzen)`,
    );
  }
  // from = den danske dag FØR first, kl. 12 UTC (Date.UTC håndterer dag 0 = forrige måned).
  const [y, m, d] = first.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1, 12));
}
