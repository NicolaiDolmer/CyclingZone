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

// UTC-instant for `hour:00:00` dansk tid på en EKSPLICIT dansk kalenderdato
// ("YYYY-MM-DD"), i modsætning til copenhagenMidnightUTC/auctionEngine.js's
// gameHourToUTC der begge udleder dagen fra et Date-objekt ("i dag"). Bruges
// når kalenderdatoen selv er resultatet af en beregning (fx "sæsonstart minus
// én dag") og derfor ikke kan udtrykkes som "samme dag som et Date". Samme
// DST-robuste offset-trick som de to ovenfor (#4004).
export function copenhagenHourToUTC(dateStr, hour) {
  const h = String(hour).padStart(2, "0");
  const approx = new Date(`${dateStr}T${h}:00:00Z`); // klokkeslæt på datoen, tolket som UTC
  const wall = approx.toLocaleString("sv-SE", { timeZone: "Europe/Copenhagen" });
  const offsetMs = new Date(wall.replace(" ", "T") + "Z").getTime() - approx.getTime();
  return new Date(approx.getTime() - offsetMs);
}

// ISO-8601-uge ("YYYY-Www") for den danske kalenderdato afledt af `now` (#4650:
// dedupe-nøgle for tilbagekomst-digestet, "højst 1 pr. 7 dage" via en ISO-uge-
// noegle i stedet for en kalenderdato). Standard ISO-algoritme: ryk datoen til
// torsdag i samme uge (ISO-uger tilhoerer det aar deres torsdag falder i), find
// saa den uge-taeller relativt til aarets uge 1 (ugen med 4. januar). Kun
// kalenderdatoen fra copenhagenDateString bruges — selve klokkeslaettet er
// irrelevant for en uge-noegle.
export function copenhagenIsoWeekString(now = new Date()) {
  const d = new Date(`${copenhagenDateString(now)}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // mandag=0 .. soendag=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // torsdag i samme ISO-uge
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4)); // 4. januar ligger altid i uge 1
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86400000);
  const weekNum = 1 + Math.round((d.getTime() - week1Monday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}
