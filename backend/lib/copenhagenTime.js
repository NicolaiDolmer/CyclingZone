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
