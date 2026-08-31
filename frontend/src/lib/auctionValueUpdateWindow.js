// #4004 (ejer-beslutning 21/8, revision 2) — pre-bid-varsel: auktioner der
// afsluttes EFTER søndagens værdi-genberegning (backend/lib/sundayValueSweep.js
// → refreshChangedRiderValues, kun søndag >= kl. 06 dansk tid, kørt via
// cron.js's timelige tick — se copenhagenHour/copenhagenWeekdayKey i backend/lib/
// copenhagenTime.js for den autoritative server-side gate) kan have ryttere
// hvis evner/værdi flytter sig FØR auktionen lukker. Dette er bevidst KUN en
// note i bud-flowet, ikke en blokering — buddet er stadig bindende (§3 i
// issue #4004). Genbruger gameWallClockToUTC/utcToGameWallClock
// (auctionEndTime.js) for samme DST-robuste Copenhagen-tidsregning som resten
// af auktions-fladen, i stedet for at duplikere tidszone-logikken.
import { GAME_TIMEZONE, utcToGameWallClock, gameWallClockToUTC } from "./auctionEndTime.js";

// Kun til dokumentation/tests — selve regningen sker via gameWallClockToUTC.
// TIMETALLET ER CO-SSOT med backend/lib/sundayValueSweep.js's
// SUNDAY_VALUE_FROM_HOUR. Frontenden kan ikke importere backend-kode ind i
// bundlet, så værdien står to steder — auctionValueUpdateWindow.parity.test.js
// låser dem sammen, så en kadence-ændring ikke igen kan flytte serveren uden at
// flytte varslet (#4419: timen gik fra 22 til 06, og denne fil blev ikke rettet).
export const VALUE_UPDATE_WEEKDAY = 0; // søndag (Date#getUTCDay()-konvention)
export const VALUE_UPDATE_HOUR = 6;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Det UTC-tidspunkt hvor den NÆSTE søndags-værdi-refresh tidligst kan køre
 * (server-cronen tikker hver time, så reel kørsel kan ligge op til ~1 time
 * senere — irrelevant for et bud-flow-varsel, som kun behøver "før eller
 * efter", ikke sekund-præcision).
 *
 * @param {Date} now
 * @returns {Date}
 */
export function nextSundayValueUpdateUTC(now = new Date()) {
  const wall = utcToGameWallClock(now); // "YYYY-MM-DDTHH:mm" i dansk tid
  const [y, m, d] = wall.slice(0, 10).split("-").map(Number);
  // Søndag = getUTCDay() 0 for datoen tolket ved UTC-middag — samme DST-robuste
  // mønster som backend/lib/copenhagenTime.js's copenhagenWeekdayKey.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = anchor.getUTCDay(); // 0=søn..6=lør
  const daysUntilSunday = (7 - dow) % 7;
  anchor.setUTCDate(anchor.getUTCDate() + daysUntilSunday);

  const candidateWall = `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}T${VALUE_UPDATE_HOUR}:00`;
  let refreshUTC = gameWallClockToUTC(candidateWall);

  // I dag ER søndag OG klokken er allerede forbi kl. 06 dansk tid — den næste
  // reelle refresh er om en uge, ikke den der allerede er passeret.
  if (refreshUTC.getTime() <= now.getTime()) {
    anchor.setUTCDate(anchor.getUTCDate() + 7);
    const nextWall = `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}T${VALUE_UPDATE_HOUR}:00`;
    refreshUTC = gameWallClockToUTC(nextWall);
  }
  return refreshUTC;
}

/**
 * @param {Date|string} calculatedEnd - auktionens sluttidspunkt
 * @param {Date} now
 * @returns {boolean} true hvis auktionen slutter på eller efter næste søndags værdi-refresh
 */
export function auctionSettlesAfterValueUpdate(calculatedEnd, now = new Date()) {
  if (!calculatedEnd) return false;
  const end = calculatedEnd instanceof Date ? calculatedEnd : new Date(calculatedEnd);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() >= nextSundayValueUpdateUTC(now).getTime();
}

// Re-eksporteret for evt. debug/UI-brug (fx en tooltip der viser klokkeslættet).
export { GAME_TIMEZONE };
