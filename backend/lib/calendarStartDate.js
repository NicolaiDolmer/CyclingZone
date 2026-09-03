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

// ── §2's sæsonvindue (#4270) ───────────────────────────────────────────────────
// docs/CALENDAR_RULES.md §2, ejer-låst 23/8 (#4131): "Sæsonen slutter altid en søndag",
// og "antal løbsdatoer = slutdato − startdato + 1". De 31 dage i S3 er IKKE en konstant —
// de er dét de to regler gav for en FREDAGS-start (28/8 → søn 27/9). Starter en sæson på
// en anden ugedag, giver samme regel andre længder, og længden skal derfor UDLEDES, ikke
// genbruges. Denne funktion er det ene sted udledningen bor, så hverken et script eller en
// agent skal regne den forfra (og gætte forkert).

/** S3's længde, 31 løbsdatoer (§2). Referencen længde-forslaget måles imod — ikke et krav. */
export const REFERENCE_SEASON_RACE_DAYS = 31;

/**
 * Alle §2-lovlige længder for en given første løbsdag: dem hvor sidste løbsdag er en
 * søndag. Sorteret stigende.
 * @returns {Array<{lastRaceDay:string, raceDays:number}>}
 */
export function sundayEndCandidates(firstRaceDay, { minRaceDays = 21, maxRaceDays = 42 } = {}) {
  const out = [];
  for (let n = minRaceDays; n <= maxRaceDays; n += 1) {
    const last = addDays(firstRaceDay, n - 1);
    if (weekday(last) === 0) out.push({ lastRaceDay: last, raceDays: n });
  }
  return out;
}

/**
 * Løs sæsonvinduet for en ny kalender.
 *
 * Præcedens: eksplicit `raceDays` > eksplicit `lastRaceDay` > udledt forslag.
 * Det UDLEDTE forslag er den §2-lovlige længde der ligger tættest på S3's 31 (ved
 * uafgjort: den korteste). Det er et FORSLAG scriptet printer og ejeren kan overstyre —
 * ikke en ny låst konstant. Kaster hvis den valgte slutdato ikke er en søndag, så §2's
 * ejer-låste regel ikke kan brydes ved et uheld.
 *
 * @returns {{firstRaceDay:string, lastRaceDay:string, raceDays:number, candidates:Array, derived:boolean}}
 */
export function resolveSeasonWindow({
  firstRaceDay, raceDays = null, lastRaceDay = null,
  referenceRaceDays = REFERENCE_SEASON_RACE_DAYS,
} = {}) {
  if (!firstRaceDay) throw new Error("resolveSeasonWindow: firstRaceDay is required");
  const candidates = sundayEndCandidates(firstRaceDay);

  let chosenDays = null;
  let derived = false;
  if (Number.isInteger(raceDays) && raceDays > 0) {
    chosenDays = raceDays;
  } else if (lastRaceDay) {
    const [y1, m1, d1] = firstRaceDay.split("-").map(Number);
    const [y2, m2, d2] = lastRaceDay.split("-").map(Number);
    const diff = Math.round((Date.UTC(y2, m2 - 1, d2, 12) - Date.UTC(y1, m1 - 1, d1, 12)) / 86_400_000);
    if (diff < 0) throw new Error(`last race day ${lastRaceDay} is BEFORE first race day ${firstRaceDay}`);
    chosenDays = diff + 1;
  } else {
    if (!candidates.length) throw new Error(`no Sunday-ending season length exists for first race day ${firstRaceDay}`);
    const best = candidates.slice().sort((a, b) => {
      const da = Math.abs(a.raceDays - referenceRaceDays), db = Math.abs(b.raceDays - referenceRaceDays);
      return da === db ? a.raceDays - b.raceDays : da - db;
    })[0];
    chosenDays = best.raceDays;
    derived = true;
  }

  const last = addDays(firstRaceDay, chosenDays - 1);
  if (weekday(last) !== 0) {
    throw new Error(
      `last race day ${last} is not a Sunday (weekday ${weekday(last)}) - CALENDAR_RULES.md section 2 requires a Sunday finish. ` +
      `Legal lengths for ${firstRaceDay}: ${candidates.map((c) => `${c.raceDays} (to ${c.lastRaceDay})`).join(" · ")}`,
    );
  }
  return { firstRaceDay, lastRaceDay: last, raceDays: chosenDays, candidates, derived };
}
