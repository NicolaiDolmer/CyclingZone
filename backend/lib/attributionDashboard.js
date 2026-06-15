// Signup-attribution dashboard aggregation (#679). Pure + DB-free so it can be
// unit-tested without Supabase. The GET /api/admin/attribution route fetches rows
// via service_role and calls aggregateAttribution() for the channel breakdown.
//
// The signup_attribution table is service_role-only (RLS, no policies) — the
// frontend can never read it directly, so this is the single source of the
// numbers the admin sees.

const DIRECT = "(direct)";
const NONE = "(none)";

// Normalize a stored value: rows are pre-trimmed by buildAttributionRow, but stay
// defensive so the aggregator never crashes on a stray null/whitespace value.
function norm(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// Collapse a referrer URL to its host so "https://google.com/search?q=x" and
// "https://google.com/" count as one channel. Falls back to the raw string when
// it isn't a parseable URL, and to "(direct)" when there's no referrer at all.
export function referrerHost(referrer) {
  const raw = norm(referrer, null);
  if (!raw) return DIRECT;
  try {
    return new URL(raw).hostname || raw;
  } catch {
    return raw;
  }
}

function tally(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Most signups first; tie-break alphabetically so the order is deterministic.
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// Returns { total, by_source, by_medium, by_referrer } where each by_* is a
// descending [{ key, count }] list covering every supplied row.
export function aggregateAttribution(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    by_source: tally(list, r => norm(r?.utm_source, DIRECT)),
    by_medium: tally(list, r => norm(r?.utm_medium, NONE)),
    by_referrer: tally(list, r => referrerHost(r?.referrer)),
  };
}
