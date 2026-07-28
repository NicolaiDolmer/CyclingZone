// backend/lib/seasonDay.js
// #3107 — ÉN kilde til sandhed for "løbsdag" i Race Hub'en.
//
// RODÅRSAG: dags-modellen var en RULLENDE 24-TIMERS BØTTE forankret i sæsonens
// allerførste etape-starttid:
//
//   const day = Math.floor((t - firstMs) / 86_400_000) + 1;
//
// Ankeret for S2 er 27/7 16:00 UTC, men den daglige løbsblok kører ca. 09:00-20:20 UTC.
// Alt før 16:00 UTC på en kalenderdato faldt derfor i GÅRSDAGENS bøtte, og en "dag" i
// Race Hub blandede aftenen på kalenderdag N med formiddagen på dag N+1. Målt mod prod
// 28/7: **702 af 1.148 S2-etape-slots (61 %) lå i forkert bøtte.** Kalenderen i databasen
// var korrekt hele tiden — fejlen var udelukkende i præsentations-/opslags-laget.
// Samme formel var duplikeret tre steder (resolveSeasonDay, poolRaceDays, buildTimeline).
//
// MODEL NU: løbsdag = DANSK KALENDERDAG. Dag 1 = den danske kalenderdato for sæsonens
// tidligste etape. Dagsvinduet er det faktiske danske døgn (midnat→midnat), så "I dag"
// skifter ved midnat dansk tid og ikke kl. 18:00.
//
// INDEKSERING: 1-baseret i HELE præsentationslaget — `?day=N`, tidslinje-labels og
// currentDay. Det er en bevidst grænse mod `races.game_day_start`/`race_stage_schedule.
// game_day`, som er 0-baserede IN-GAME-dage i et andet nøgle-rum (flere in-game-dage kan
// ligge på samme kalenderdag). Bland dem ALDRIG: game_day er binding/simulering
// (raceBinding.js), denne fil er visning.

import { copenhagenDateString, copenhagenMidnightUTC } from "./copenhagenTime.js";

const DAY_MS = 86_400_000;

// Midt på dagen UTC for en dansk kalenderdato-streng. Copenhagen er UTC+1/+2, så 12:00
// UTC ligger altid trygt inde i SAMME danske kalenderdøgn — uanset CET/CEST. Bruges som
// "en instant der repræsenterer denne danske dato" ind i copenhagen*-helperne.
function noonUtcForDate(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}

/**
 * Absolut dag-ordinal (heltal) for et tidspunkt, målt i DANSKE kalenderdage.
 * DST-robust: vi udleder den danske DATO og mapper den til et dagnummer — UTC-midnat for
 * en dato er altid et multiplum af DAY_MS, så divisionen giver et eksakt heltal.
 * Ugyldig/manglende input → null.
 */
export function copenhagenDayOrdinal(scheduledAt) {
  const ms = typeof scheduledAt === "number" ? scheduledAt : Date.parse(scheduledAt);
  if (!Number.isFinite(ms)) return null;
  return Date.parse(`${copenhagenDateString(new Date(ms))}T00:00:00Z`) / DAY_MS;
}

/** Dato-streng (YYYY-MM-DD) for en absolut dag-ordinal. */
export function dateStringForOrdinal(ordinal) {
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Sæsonens dags-akse udledt af dens etape-tidspunkter.
 * @param {Array<{scheduled_at:string}>} schedRows
 * @param {string} [fallbackDate] season.start_date — bruges hvis der ingen etaper er.
 * @returns {{firstOrdinal:number, lastOrdinal:number, totalDays:number}|null}
 */
export function seasonDayAxis(schedRows, fallbackDate) {
  const ordinals = (schedRows || [])
    .map((s) => copenhagenDayOrdinal(s?.scheduled_at))
    .filter((o) => Number.isFinite(o));
  if (!ordinals.length) {
    const fb = copenhagenDayOrdinal(fallbackDate ? `${String(fallbackDate).slice(0, 10)}T12:00:00Z` : null);
    if (!Number.isFinite(fb)) return null;
    return { firstOrdinal: fb, lastOrdinal: fb, totalDays: 1 };
  }
  const firstOrdinal = Math.min(...ordinals);
  const lastOrdinal = Math.max(...ordinals);
  return { firstOrdinal, lastOrdinal, totalDays: lastOrdinal - firstOrdinal + 1 };
}

/**
 * 1-baseret løbsdag for et etape-tidspunkt. `firstOrdinal` fra seasonDayAxis.
 * Returnerer null for ugyldigt input (kalderen filtrerer).
 */
export function seasonDayForTime(scheduledAt, firstOrdinal) {
  const o = copenhagenDayOrdinal(scheduledAt);
  if (!Number.isFinite(o) || !Number.isFinite(firstOrdinal)) return null;
  return o - firstOrdinal + 1;
}

/**
 * Det faktiske danske døgn for løbsdag N som epoch-ms-vindue [start, end].
 * DST-korrekt: vinduet er 23t eller 25t på skifte-døgnene, fordi begge ender udledes af
 * dansk midnat og ikke af en fast 24t-addition.
 */
export function seasonDayWindow({ firstOrdinal, day }) {
  const dayStr = dateStringForOrdinal(firstOrdinal + day - 1);
  const nextStr = dateStringForOrdinal(firstOrdinal + day);
  const start = copenhagenMidnightUTC(noonUtcForDate(dayStr)).getTime();
  const end = copenhagenMidnightUTC(noonUtcForDate(nextStr)).getTime() - 1;
  return { start, end };
}

/**
 * Løbsdag → dagsvindue + hvilken dag board'et skal vise.
 *
 * `currentDay` = dags-ordinalen for NU i dansk tid, klampet til sæsonen — skifter ved
 * midnat dansk tid (før #3107 skiftede den kl. 16:00 UTC / 18:00 dansk).
 * `focusDay` = eksplicit ?day=N, ellers holdets nærmeste kommende løbsdag (myRaceDays),
 * ellers i dag. Så board'et aldrig åbner tomt når holdet har løb.
 *
 * @param {{season:{start_date?:string}, schedRows:Array, dayParam?:number,
 *          myRaceDays?:number[], now?:Date}} args
 * @returns {{dayWindow:{start:number,end:number}, currentDay:number, focusDay:number,
 *           totalDays:number, firstOrdinal:number}}
 */
export function resolveSeasonDay({ season, schedRows, dayParam, myRaceDays = [], now = new Date() }) {
  const axis = seasonDayAxis(schedRows, season?.start_date) ?? {
    firstOrdinal: copenhagenDayOrdinal(now.getTime()), lastOrdinal: copenhagenDayOrdinal(now.getTime()), totalDays: 1,
  };
  const { firstOrdinal, totalDays } = axis;

  const todayDay = copenhagenDayOrdinal(now.getTime()) - firstOrdinal + 1;
  const currentDay = Math.min(Math.max(todayDay, 1), totalDays);

  let focusDay;
  if (Number.isFinite(dayParam)) {
    focusDay = Math.min(Math.max(dayParam, 1), totalDays);
  } else if (myRaceDays.length) {
    focusDay = myRaceDays.find((d) => d >= currentDay) ?? myRaceDays[myRaceDays.length - 1];
  } else {
    focusDay = currentDay;
  }

  return { dayWindow: seasonDayWindow({ firstOrdinal, day: focusDay }), currentDay, focusDay, totalDays, firstOrdinal };
}
