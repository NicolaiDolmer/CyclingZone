/**
 * Cycling Zone Manager — Auction Timing Engine
 * =============================================
 * Active-time model: auction runs for `duration_hours` of active hours.
 * Dead hours (outside the active window) are skipped entirely.
 *
 * Defaults:
 *   Weekdays (Mon-Fri): active 16:00–22:00  (dead: 22:00→16:00 next day)
 *   Weekends (Sat-Sun): active 08:00–23:00  (dead: 23:00→08:00 next day)
 *   Duration: 6 active hours
 *
 * Examples with defaults:
 *   Tuesday 19:40  → Wednesday 19:40  (2h20m Tue + 3h40m Wed)
 *   Saturday 19:40 → Sunday 10:40     (3h20m Sat + 2h40m Sun)
 *
 * Extension rule:
 *   Bid within last `extension_minutes` → extend by that many minutes from bid time.
 *   Extended end capped at current day's window close.
 */

export const DEFAULT_AUCTION_CONFIG = {
  duration_hours: 6,
  weekday_open_hour: 16,
  weekday_close_hour: 22,
  weekend_open_hour: 8,
  weekend_close_hour: 23,
  extension_minutes: 10,
};

function isWeekend(dayOfWeek) {
  return dayOfWeek === 0 || dayOfWeek === 6; // Sun=0, Sat=6
}

function windowHours(d, cfg) {
  return isWeekend(d.getDay())
    ? { openHour: cfg.weekend_open_hour, closeHour: cfg.weekend_close_hour }
    : { openHour: cfg.weekday_open_hour, closeHour: cfg.weekday_close_hour };
}

function windowOpenTime(d, cfg) {
  const t = new Date(d);
  t.setHours(windowHours(d, cfg).openHour, 0, 0, 0);
  return t;
}

function windowCloseTime(d, cfg) {
  const t = new Date(d);
  t.setHours(windowHours(d, cfg).closeHour, 0, 0, 0);
  return t;
}

function nextWindowOpenTime(d, cfg) {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return windowOpenTime(next, cfg);
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
 * @param {Date} bidTime
 * @param {Date} currentEnd
 * @param {object} cfg
 * @returns {{ shouldExtend: boolean, newEnd: Date | null }}
 */
export function checkBidExtension(bidTime, currentEnd, cfg = DEFAULT_AUCTION_CONFIG) {
  const bid = new Date(bidTime);
  const end = new Date(currentEnd);
  const extensionMs = cfg.extension_minutes * 60 * 1000;
  const wClose = windowCloseTime(end, cfg);

  const timeLeft = end.getTime() - bid.getTime();
  if (timeLeft > extensionMs) return { shouldExtend: false, newEnd: null };

  const extendedEnd = new Date(bid.getTime() + extensionMs);
  const newEnd = extendedEnd > wClose ? wClose : extendedEnd;

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
