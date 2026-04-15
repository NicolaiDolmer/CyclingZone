/**
 * Cycling Zone Manager — Auction Timing Engine
 * =============================================
 * Handles the complex auction window rules:
 *
 * Weekdays (Mon-Fri):
 *   - Auctions close between 17:00–21:00
 *   - Start before 17:00 → closes at 17:00 same day
 *   - Start after 17:00 → closes when 4h have elapsed (within window)
 *   - Start after 21:00 → closes at 17:00 next weekday
 *
 * Saturday:
 *   - Window: 09:00–22:00
 *   - Closes at 22:00 max
 *
 * Sunday:
 *   - Window: 09:00–21:00
 *   - Closes at 21:00 max
 *
 * Extension rule:
 *   - Bid in last 10 minutes → extend by 10 minutes from bid time
 *   - Extended end must still respect daily window ceiling
 */

const WINDOWS = {
  0: { open: 9, close: 21 },   // Sunday
  1: { open: 17, close: 21 },  // Monday
  2: { open: 17, close: 21 },  // Tuesday
  3: { open: 17, close: 21 },  // Wednesday
  4: { open: 17, close: 21 },  // Thursday
  5: { open: 17, close: 21 },  // Friday  (close 22 — see note)
  6: { open: 9, close: 22 },   // Saturday
};
// Friday override
WINDOWS[5] = { open: 17, close: 22 };

const AUCTION_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours
const EXTENSION_MS = 10 * 60 * 1000;             // 10 minutes

/**
 * Get the window close time for a given date (as Date object).
 * Returns a Date set to the window's closing time on that day.
 */
function getWindowClose(d) {
  const close = new Date(d);
  const dow = close.getDay();
  const w = WINDOWS[dow];
  close.setHours(w.close, 0, 0, 0);
  return close;
}

/**
 * Get the window open time for a given date.
 */
function getWindowOpen(d) {
  const open = new Date(d);
  const dow = open.getDay();
  const w = WINDOWS[dow];
  open.setHours(w.open, 0, 0, 0);
  return open;
}

/**
 * Advance to the next valid auction window opening.
 * Skips to next calendar day if today's window is past.
 */
function nextWindowOpen(from) {
  let candidate = new Date(from);
  // Try up to 7 days ahead
  for (let i = 0; i < 7; i++) {
    const open = getWindowOpen(candidate);
    const close = getWindowClose(candidate);
    if (candidate < close) {
      // Today's window is still open or upcoming
      return open > candidate ? open : candidate;
    }
    // Move to next day at midnight
    candidate = new Date(candidate);
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }
  throw new Error("Could not find next auction window within 7 days");
}

/**
 * Calculate the auction end time given a start time.
 *
 * @param {Date} startTime - When the auction was started
 * @returns {Date} - Calculated end time respecting window rules
 */
export function calculateAuctionEnd(startTime) {
  const start = new Date(startTime);
  const windowClose = getWindowClose(start);
  const windowOpen = getWindowOpen(start);

  // Case 1: Started before window opens today
  if (start < windowOpen) {
    // Ends at window open (which is 17:00 on weekdays)
    return windowOpen;
  }

  // Case 2: Started after window closes today
  if (start >= windowClose) {
    // Move to next valid window
    const nextOpen = nextWindowOpen(new Date(start.getTime() + 86400000));
    return nextOpen;
  }

  // Case 3: Started within window
  const naturalEnd = new Date(start.getTime() + AUCTION_DURATION_MS);

  if (naturalEnd <= windowClose) {
    return naturalEnd; // Fits within today's window
  } else {
    return windowClose; // Capped at window close
  }
}

/**
 * Determine if a new bid triggers an extension.
 *
 * @param {Date} bidTime - When the bid was placed
 * @param {Date} currentEnd - Current auction end time
 * @returns {{ shouldExtend: boolean, newEnd: Date | null }}
 */
export function checkBidExtension(bidTime, currentEnd) {
  const bid = new Date(bidTime);
  const end = new Date(currentEnd);
  const windowClose = getWindowClose(end);

  const timeLeft = end.getTime() - bid.getTime();

  if (timeLeft > EXTENSION_MS) {
    return { shouldExtend: false, newEnd: null };
  }

  // Extend by 10 minutes from bid time
  const extendedEnd = new Date(bid.getTime() + EXTENSION_MS);

  // Cannot exceed window close
  const newEnd = extendedEnd > windowClose ? windowClose : extendedEnd;

  // Only extend if we're actually pushing the end later
  if (newEnd <= end) {
    return { shouldExtend: false, newEnd: null };
  }

  return { shouldExtend: true, newEnd };
}

/**
 * Check if an auction should be finalized now.
 * Used by the cron job every minute.
 *
 * @param {Date} auctionEnd - The auction's current end time
 * @returns {boolean}
 */
export function isAuctionExpired(auctionEnd) {
  return new Date() >= new Date(auctionEnd);
}

/**
 * Format auction end for display.
 */
export function formatAuctionEnd(endTime) {
  const d = new Date(endTime);
  const now = new Date();
  const diffMs = d - now;

  if (diffMs <= 0) return "Afsluttet";

  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  if (hours > 0) return `${hours}t ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ── Tests ────────────────────────────────────────────────────────────────────
if (typeof process !== "undefined" && process.argv[1]?.includes("auction")) {
  const tests = [
    {
      label: "Monday 08:00 → should end at 17:00",
      input: new Date("2025-01-06T08:00:00"),
      expected: "17:00",
    },
    {
      label: "Monday 13:00 → should end at 17:00",
      input: new Date("2025-01-06T13:00:00"),
      expected: "17:00",
    },
    {
      label: "Monday 18:00 → should end 22:00 (4h later but cap 21:00)",
      input: new Date("2025-01-06T18:00:00"),
      expected: "21:00",
    },
    {
      label: "Monday 19:30 → should end 21:00 (cap)",
      input: new Date("2025-01-06T19:30:00"),
      expected: "21:00",
    },
    {
      label: "Saturday 10:00 → should end 14:00",
      input: new Date("2025-01-04T10:00:00"),
      expected: "14:00",
    },
    {
      label: "Sunday 20:00 → should end 21:00 (cap)",
      input: new Date("2025-01-05T20:00:00"),
      expected: "21:00",
    },
    {
      label: "Friday 19:00 → should end 22:00 (cap Friday)",
      input: new Date("2025-01-03T19:00:00"),
      expected: "22:00",
    },
  ];

  console.log("🧪 Auction Timing Tests\n");
  let passed = 0;
  for (const t of tests) {
    const result = calculateAuctionEnd(t.input);
    const hhmm = `${result.getHours().toString().padStart(2, "0")}:${result.getMinutes().toString().padStart(2, "0")}`;
    const ok = hhmm === t.expected;
    console.log(`${ok ? "✅" : "❌"} ${t.label}`);
    if (!ok) console.log(`   Got: ${hhmm}, Expected: ${t.expected}`);
    if (ok) passed++;
  }
  console.log(`\n${passed}/${tests.length} tests passed`);
}
