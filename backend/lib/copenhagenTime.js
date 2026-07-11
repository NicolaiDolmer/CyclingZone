// Dansk lokaltid (Europe/Copenhagen) — al spillogik om "dagen" bruger denne.
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
});
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Copenhagen", hour: "2-digit", hour12: false,
});

export function copenhagenDateString(now = new Date()) {
  return DATE_FMT.format(now); // en-CA giver YYYY-MM-DD
}

export function copenhagenHour(now = new Date()) {
  return Number(HOUR_FMT.format(now)) % 24;
}

// #1895: ugedags-nøgle ("mon".."sun") for en dansk kalenderdato-streng (YYYY-MM-DD,
// typisk tickDate fra copenhagenDateString). Tolker datoen som UTC-middag (samme
// DST-robuste trick som dailyTrainingEngine.addDaysToDate) — datoen ER allerede den
// danske kalenderdag, så ingen yderligere tidszone-konvertering skal ske her.
const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // Date#getUTCDay() index
export function copenhagenWeekdayKey(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return WEEKDAY_ORDER[d.getUTCDay()];
}

// UTC-instant for seneste midnat (00:00) i dansk tid på SAMME danske kalenderdato som `now`.
// Grænse for "i dag" i spillogik (fx daglige cap's/loop-guards). DST-robust via samme
// offset-korrektion som auctionEngine.gameHourToUTC: parse den danske dato som om den var
// UTC-midnat, mål Copenhagens faktiske offset på det tidspunkt, og træk offsetet fra.
// Korrekt hen over CET↔CEST og PRÆCIS på selve midnats-kanten (modsat en formatToParts-
// offset-udregning der kan ramme 24h forkert ved hour==="24"/døgnskift).
export function copenhagenMidnightUTC(now = new Date()) {
  const localDate = copenhagenDateString(now); // "YYYY-MM-DD" i dansk tid
  const approx = new Date(`${localDate}T00:00:00Z`); // dato-midnat tolket som UTC
  // Copenhagens vægur-tid for `approx`, igen tolket som UTC → differensen ER offsetet.
  const wall = approx.toLocaleString("sv-SE", { timeZone: "Europe/Copenhagen" });
  const offsetMs = new Date(wall.replace(" ", "T") + "Z").getTime() - approx.getTime();
  return new Date(approx.getTime() - offsetMs);
}
