/**
 * Cycling Zone Manager — Auction Timing Engine
 * =============================================
 * Active-time model: auction runs for `duration_hours` of active hours.
 * Dead hours (outside the active window) are skipped entirely.
 *
 * All window-hour calculations use Europe/Copenhagen (handles CEST/CET DST).
 * Config hours (e.g. weekday_close_hour: 22) are Copenhagen wall-clock hours.
 *
 * Defaults:
 *   Weekdays (Mon-Fri): active 16:00–22:00 Copenhagen
 *   Weekends (Sat-Sun): active 08:00–23:00 Copenhagen
 *   Duration: 6 active hours
 *
 * Examples with defaults:
 *   Tuesday 19:40  → Wednesday 19:40  (2h20m Tue + 3h40m Wed)
 *   Saturday 19:40 → Sunday 10:40     (3h20m Sat + 2h40m Sun)
 *
 * Extension rule:
 *   Bid within last `extension_minutes` → extend by that many minutes from bid time.
 *   Extended end may exceed the day's window close by up to `extension_grace_minutes`
 *   (hard cap = close + grace). If the extension would push past the hard cap, the
 *   auction rolls over to the next day's window open, carrying the overflow minutes.
 *
 * Examples (weekday close 22:00, grace 60 → hard cap 23:00):
 *   Bid 21:55 → ends 22:05      (extends past close, within grace)
 *   Bid 22:50 → ends 23:00      (lands at cap, no overflow)
 *   Bid 22:55 → ends next-open + 05  (e.g. Fri 22:55 → Sat 08:05)
 */

const GAME_TIMEZONE = "Europe/Copenhagen";

export const DEFAULT_AUCTION_CONFIG = {
  duration_hours: 6,
  weekday_open_hour: 16,
  weekday_close_hour: 22,
  weekend_open_hour: 8,
  weekend_close_hour: 23,
  extension_minutes: 10,
  extension_grace_minutes: 60,
};

// Returns 0=Sun, 1=Mon, ..., 6=Sat for a UTC Date in Copenhagen timezone.
function getGameDayOfWeek(date) {
  const wd = date.toLocaleDateString("en-US", { timeZone: GAME_TIMEZONE, weekday: "short" });
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(wd);
}

// Returns a UTC Date representing `hour:00:00` on the same Copenhagen calendar date as `date`.
// Correctly handles CEST (UTC+2) / CET (UTC+1) transitions.
function gameHourToUTC(date, hour) {
  const localDate = date.toLocaleDateString("sv-SE", { timeZone: GAME_TIMEZONE }); // "YYYY-MM-DD"
  const h = String(hour).padStart(2, "0");
  // Parse the target time as if it were UTC, then adjust for Copenhagen's actual offset
  const approx = new Date(`${localDate}T${h}:00:00Z`);
  const wallStr = approx.toLocaleString("sv-SE", { timeZone: GAME_TIMEZONE });
  const offsetMs = new Date(wallStr + "Z").getTime() - approx.getTime();
  return new Date(approx.getTime() - offsetMs);
}

function isWeekend(dayOfWeek) {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function windowHours(d, cfg) {
  return isWeekend(getGameDayOfWeek(d))
    ? { openHour: cfg.weekend_open_hour, closeHour: cfg.weekend_close_hour }
    : { openHour: cfg.weekday_open_hour, closeHour: cfg.weekday_close_hour };
}

function windowOpenTime(d, cfg) {
  return gameHourToUTC(d, windowHours(d, cfg).openHour);
}

function windowCloseTime(d, cfg) {
  return gameHourToUTC(d, windowHours(d, cfg).closeHour);
}

function nextWindowOpenTime(d, cfg) {
  // Advance to the next calendar day in Copenhagen timezone
  const localDate = d.toLocaleDateString("sv-SE", { timeZone: GAME_TIMEZONE }); // "YYYY-MM-DD"
  const [year, month, day] = localDate.split("-").map(Number);
  const nextDayUTC = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  return windowOpenTime(nextDayUTC, cfg);
}

/**
 * Calculate auction end time given a start time.
 * Counts only active-window hours toward the duration.
 *
 * @param {Date} startTime
 * @param {object} cfg - auction timing config (defaults to DEFAULT_AUCTION_CONFIG)
 * @returns {Date}
 */
export function calculateAuctionEnd(startTime, cfg = DEFAULT_AUCTION_CONFIG) {
  const durationMs = cfg.duration_hours * 60 * 60 * 1000;
  let current = new Date(startTime);
  let remaining = durationMs;

  for (let i = 0; i < 14; i++) {
    const wOpen = windowOpenTime(current, cfg);
    const wClose = windowCloseTime(current, cfg);

    // Before window opens today → snap to open
    if (current < wOpen) current = new Date(wOpen);

    // At or past window close → jump to next day
    if (current >= wClose) {
      current = nextWindowOpenTime(current, cfg);
      continue;
    }

    // Within active window
    const availableMs = wClose.getTime() - current.getTime();
    if (remaining <= availableMs) {
      return new Date(current.getTime() + remaining);
    }

    remaining -= availableMs;
    current = nextWindowOpenTime(wClose, cfg);
  }

  throw new Error("Cannot calculate auction end within 14 days");
}

/**
 * Check whether a new bid triggers an extension.
 *
 * Cap-with-rollover: extended end may pass the day's window close by up to
 * `extension_grace_minutes`. If the extension would land past that hard cap,
 * the overflow minutes carry over to the next day's window open.
 *
 * @param {Date} bidTime
 * @param {Date} currentEnd
 * @param {object} cfg
 * @returns {{ shouldExtend: boolean, newEnd: Date | null }}
 */
export function checkBidExtension(bidTime, currentEnd, cfg = DEFAULT_AUCTION_CONFIG) {
  const bid = new Date(bidTime);
  const end = new Date(currentEnd);
  const extensionMs = cfg.extension_minutes * 60 * 1000;
  const graceMs = (cfg.extension_grace_minutes ?? 0) * 60 * 1000;

  const timeLeft = end.getTime() - bid.getTime();
  if (timeLeft > extensionMs) return { shouldExtend: false, newEnd: null };

  const extendedEnd = new Date(bid.getTime() + extensionMs);
  const wClose = windowCloseTime(end, cfg);
  const hardCap = new Date(wClose.getTime() + graceMs);

  let newEnd;
  if (extendedEnd > hardCap) {
    const overflowMs = extendedEnd.getTime() - hardCap.getTime();
    const nextOpen = nextWindowOpenTime(end, cfg);
    newEnd = new Date(nextOpen.getTime() + overflowMs);
  } else {
    newEnd = extendedEnd;
  }

  if (newEnd <= end) return { shouldExtend: false, newEnd: null };

  return { shouldExtend: true, newEnd };
}

/**
 * Check if an auction should be finalized now.
 */
export function isAuctionExpired(auctionEnd) {
  return new Date() >= new Date(auctionEnd);
}

/**
 * Format remaining time for display.
 */
export function formatAuctionEnd(endTime) {
  const diffMs = new Date(endTime) - new Date();
  if (diffMs <= 0) return "Afsluttet";
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  if (hours > 0) return `${hours}t ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
