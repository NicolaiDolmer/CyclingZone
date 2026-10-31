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
// docs/CALENDAR_RULES.md §2: sæsonens sidste løbsdag ligger på en FAST UGEDAG, og
// "antal løbsdatoer = slutdato − startdato + 1". Ugedagen afhænger af sæsonen:
//   · S1-S4: søndag (ejer-låst 23/8, #4131). S4 slutter søndag 25/10 som planlagt.
//   · Fra S5: LØRDAG (ejer-beslutning 14/10 efter forum-afstemningen, #5833). S5 kører
//     onsdag 28/10 → lørdag 28/11.
// De 31 dage i S3 er IKKE en konstant — de er dét reglerne gav for en FREDAGS-start (28/8 →
// søn 27/9). Starter en sæson på en anden ugedag, giver samme regel andre længder, og
// længden skal derfor UDLEDES, ikke genbruges. Denne fil er det ene sted udledningen bor,
// så hverken et script eller en agent skal regne den forfra (og gætte forkert).

/** Første sæson hvor sidste løbsdag er en LØRDAG (#5833, ejer 14/10). Før: søndag (#4131). */
export const SATURDAY_FINISH_FROM_SEASON = 5;

const WEEKDAY_NAME = Object.freeze({ 0: "Sunday", 6: "Saturday" });

/**
 * Ugedagen sæsonens sidste løbsdag SKAL ligge på (0 = søndag, 6 = lørdag), §2.
 * Uden sæsonnummer gælder den gamle søndagsregel: kald-steder fra før #5833 (S4-værktøjer
 * og tests) kender ikke sæsonen. En ny sæsons kalender bygges af buildSeasonCalendar.js,
 * som ALTID sender `seasonNumber`.
 */
export function seasonFinishWeekday(seasonNumber = null) {
  if (seasonNumber == null) return 0;
  const n = typeof seasonNumber === "string" && seasonNumber.trim() === "" ? NaN : Number(seasonNumber);
  // En ugyldig sæson må ikke tavst falde tilbage til søndag: det er netop den fejl der ville
  // bygge S5 efter den gamle regel.
  if (!Number.isInteger(n) || n < 1) throw new Error(`seasonFinishWeekday: invalid season number ${seasonNumber}`);
  return n >= SATURDAY_FINISH_FROM_SEASON ? 6 : 0;
}

/** S3's længde, 31 løbsdatoer (§2). Referencen længde-forslaget måles imod — ikke et krav. */
export const REFERENCE_SEASON_RACE_DAYS = 31;

// EJER-VALGTE saesonvinduer (§2). En saeson der staar her har faaet sin laengde BESLUTTET,
// ikke udledt, og buildSeasonCalendar.js bruger tallet som default i stedet for at kraeve
// --race-days. Alle andre saesoner faar fortsat et UDLEDT forslag som ejeren skal bekraefte.
//
// S4 = 28 loebsdatoer (man 28/9 -> soen 25/10), ejer-beslutning 3/9 (#4270). 31 findes ikke
// som mulighed for en mandags-start (mandag + 30 dage = onsdag), og 35 blev maalt umulig:
// D3 fik 18 kalenderdage uden loeb, altsaa §2's ejer-regel broedt i en hel division.
export const SEASON_RACE_DAYS_DEFAULT = Object.freeze({ 4: 28 });

// BYGGEDE saesoners loebsdatoer (#7412). Ikke et build-default: tabellen ovenfor styrer
// kun hvad buildSeasonCalendar.js foreslaar, og S5 blev bygget med --last-day. Denne tabel
// er det vindue saesonen faktisk KOERER paa, og den er skadernes akse:
// SEASON_RACE_DAY_TARGET[n] / SEASON_RACE_DATES[n] = loebsdage pr. kalenderdato
// (injuryRaceDays.js). Foer #7412 laeste skaderne SEASON_RACE_DAYS_DEFAULT, som ikke har S5,
// og alle S5-skader faldt tavst tilbage til kalenderdage.
//   S4 = 28 (man 28/9 -> soen 25/10, ejer 3/9, #4270).
//   S5 = 32 (ons 28/10 -> loer 28/11, ejer 14/10, #5833).
// VAGT: en saeson med et loebsdagsmaal (SEASON_RACE_DAY_TARGET) SKAL staa her, ellers
// fejler injuryRaceDays.test.js. Tilfoej S6 samtidig med S6's maal.
export const SEASON_RACE_DATES = Object.freeze({ 4: SEASON_RACE_DAYS_DEFAULT[4], 5: 32 });

/**
 * Alle §2-lovlige længder for en given første løbsdag: dem hvor sidste løbsdag ligger på
 * `finishWeekday` (0 = søndag, 6 = lørdag). Sorteret stigende.
 * @returns {Array<{lastRaceDay:string, raceDays:number}>}
 */
export function seasonEndCandidates(firstRaceDay, { finishWeekday = 0, minRaceDays = 21, maxRaceDays = 42 } = {}) {
  const out = [];
  for (let n = minRaceDays; n <= maxRaceDays; n += 1) {
    const last = addDays(firstRaceDay, n - 1);
    if (weekday(last) === finishWeekday) out.push({ lastRaceDay: last, raceDays: n });
  }
  return out;
}

/** Søndags-udgaven (S1-S4, #4131). Bevaret som navngivet indgang for eksisterende kald. */
export function sundayEndCandidates(firstRaceDay, { minRaceDays = 21, maxRaceDays = 42 } = {}) {
  return seasonEndCandidates(firstRaceDay, { finishWeekday: 0, minRaceDays, maxRaceDays });
}

/**
 * Løs sæsonvinduet for en ny kalender.
 *
 * Præcedens: eksplicit `raceDays` > eksplicit `lastRaceDay` > udledt forslag.
 * Det UDLEDTE forslag er den §2-lovlige længde der ligger tættest på S3's 31 (ved
 * uafgjort: den korteste). Det er et FORSLAG scriptet printer og ejeren kan overstyre —
 * ikke en ny låst konstant. Kaster hvis den valgte slutdato ikke ligger på sæsonens
 * slut-ugedag (seasonFinishWeekday: søndag til og med S4, lørdag fra S5), så §2's
 * ejer-regel ikke kan brydes ved et uheld.
 *
 * @param {{firstRaceDay:string, raceDays?:number|null, lastRaceDay?:string|null,
 *          seasonNumber?:number|null, referenceRaceDays?:number}} args
 *   seasonNumber: afgør slut-ugedagen. Uden den gælder søndag (reglen fra før #5833).
 * @returns {{firstRaceDay:string, lastRaceDay:string, raceDays:number, candidates:Array,
 *            derived:boolean, finishWeekday:number, finishWeekdayName:string}}
 */
export function resolveSeasonWindow({
  firstRaceDay, raceDays = null, lastRaceDay = null, seasonNumber = null,
  referenceRaceDays = REFERENCE_SEASON_RACE_DAYS,
} = {}) {
  if (!firstRaceDay) throw new Error("resolveSeasonWindow: firstRaceDay is required");
  const finishWeekday = seasonFinishWeekday(seasonNumber);
  const finishWeekdayName = WEEKDAY_NAME[finishWeekday];
  const candidates = seasonEndCandidates(firstRaceDay, { finishWeekday });

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
    if (!candidates.length) throw new Error(`no ${finishWeekdayName}-ending season length exists for first race day ${firstRaceDay}`);
    const best = candidates.slice().sort((a, b) => {
      const da = Math.abs(a.raceDays - referenceRaceDays), db = Math.abs(b.raceDays - referenceRaceDays);
      return da === db ? a.raceDays - b.raceDays : da - db;
    })[0];
    chosenDays = best.raceDays;
    derived = true;
  }

  const last = addDays(firstRaceDay, chosenDays - 1);
  if (weekday(last) !== finishWeekday) {
    const seasonLabel = seasonNumber == null ? "" : ` for season ${seasonNumber}`;
    throw new Error(
      `last race day ${last} is not a ${finishWeekdayName} (weekday ${weekday(last)}) - CALENDAR_RULES.md section 2 requires a ${finishWeekdayName} finish${seasonLabel}. ` +
      `Legal lengths for ${firstRaceDay}: ${candidates.map((c) => `${c.raceDays} (to ${c.lastRaceDay})`).join(" · ")}`,
    );
  }
  return { firstRaceDay, lastRaceDay: last, raceDays: chosenDays, candidates, derived, finishWeekday, finishWeekdayName };
}
