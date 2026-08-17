// Spiller-valgt auktions-sluttidspunkt (#2884).
//
// Markedets åbningsvindue er Copenhagen-vægurstimer (backend/lib/auctionEngine.js).
// Vælgeren viser derfor SPILLETS tid, ikke browserens — ellers ville en spiller i
// en anden tidszone vælge et klokkeslæt der bliver afvist af serveren uden at han
// kan se hvorfor. Alt der sendes til API'et er UTC.
//
// Serveren er autoritativ; funktionerne her spejler dens regler så fejlen kan vises
// før POST'en i stedet for bagefter.

export const GAME_TIMEZONE = "Europe/Copenhagen";
export const DEFAULT_MIN_HOURS = 1;
export const DEFAULT_MAX_HOURS = 48;

// #2884: vindues-timerne står som tal i configen (8, 24). Vist rå bliver det
// "8:00-24:00" ved siden af tabular tal — nul-udfyldt matcher resten af fladen.
// #3786: flyttet hertil fra TeamPage.jsx så rytterprofilens vælger (samme
// useAuctionEndTimeSelector-forbruger) kan bruge den uden en anden kopi.
export const formatHour = (h) => `${String(h).padStart(2, "0")}:00`;

// "2026-08-15T20:44" læst som Copenhagen-vægur → Date i UTC.
// Samme offset-trick som backendens gameHourToUTC: fortolk strengen som UTC, mål
// hvor langt Copenhagen ligger fra den, og træk forskellen fra. Håndterer CEST/CET.
export function gameWallClockToUTC(wall) {
  if (typeof wall !== "string" || wall.length < 16) return new Date(NaN);
  const approx = new Date(`${wall.slice(0, 16)}:00Z`);
  if (Number.isNaN(approx.getTime())) return new Date(NaN);
  const asGame = new Date(`${approx.toLocaleString("sv-SE", { timeZone: GAME_TIMEZONE })}Z`);
  return new Date(approx.getTime() - (asGame.getTime() - approx.getTime()));
}

// Date → "YYYY-MM-DDTHH:mm" i spillets tid, klar til <input type="datetime-local">.
export function utcToGameWallClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("sv-SE", { timeZone: GAME_TIMEZONE }).slice(0, 16).replace(" ", "T");
}

// Vindues-timerne for den dag et vægur-klokkeslæt ligger på. Dagen aflæses direkte
// af datostrengen — den ER allerede spillets lokale dato, så ingen tidszone-math.
export function windowHoursForWallClock(wall, cfg = {}) {
  const [y, m, d] = String(wall).slice(0, 10).split("-").map(Number);
  const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  return weekend
    ? { openHour: cfg.weekend_open_hour ?? 8, closeHour: cfg.weekend_close_hour ?? 24 }
    : { openHour: cfg.weekday_open_hour ?? 8, closeHour: cfg.weekday_close_hour ?? 24 };
}

/**
 * Validér et valgt sluttidspunkt. Returnerer null når det er gyldigt.
 * Spejler backendens getCustomAuctionEndIssue.
 */
export function getEndTimeIssue(wall, now = new Date(), cfg = {}) {
  if (!wall) return { code: "invalid_end_time" };
  const end = gameWallClockToUTC(wall);
  if (Number.isNaN(end.getTime())) return { code: "invalid_end_time" };

  const minHours = cfg.min_hours ?? DEFAULT_MIN_HOURS;
  const maxHours = cfg.max_hours ?? DEFAULT_MAX_HOURS;
  const aheadMs = end.getTime() - new Date(now).getTime();
  if (aheadMs < minHours * 3600000) return { code: "end_too_soon", minHours };
  if (aheadMs > maxHours * 3600000) return { code: "end_too_late", maxHours };

  const { openHour, closeHour } = windowHoursForWallClock(wall, cfg);
  const [hh, mm] = wall.slice(11, 16).split(":").map(Number);
  const minutes = hh * 60 + mm;
  if (minutes < openHour * 60 || minutes > closeHour * 60) {
    return { code: "end_outside_window", openHour, closeHour };
  }
  return null;
}

// Standard-forslaget i vælgeren: 12 timer frem, trukket ind i vinduet hvis det
// lander om natten. 12 er valgt så auktionen spænder over to forskellige
// tidspunkter af døgnet — det er dét der giver en budgiver nummer to en chance.
export function defaultEndWallClock(now = new Date(), cfg = {}) {
  const candidate = new Date(new Date(now).getTime() + 12 * 3600000);
  let wall = utcToGameWallClock(candidate);
  const { openHour, closeHour } = windowHoursForWallClock(wall, cfg);
  const [hh, mm] = wall.slice(11, 16).split(":").map(Number);
  const minutes = hh * 60 + mm;
  if (minutes < openHour * 60) {
    wall = `${wall.slice(0, 11)}${String(openHour).padStart(2, "0")}:00`;
  } else if (minutes > closeHour * 60) {
    // closeHour 24 kan ikke skrives som vægur — sidste gyldige minut er 23:59.
    const lastHour = Math.min(closeHour, 23);
    const lastMinute = closeHour >= 24 ? 59 : 0;
    wall = `${wall.slice(0, 11)}${String(lastHour).padStart(2, "0")}:${String(lastMinute).padStart(2, "0")}`;
  }
  return wall;
}
