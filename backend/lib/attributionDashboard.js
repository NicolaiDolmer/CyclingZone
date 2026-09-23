// Signup-attribution dashboard aggregation (#679). Pure + DB-free so it can be
// unit-tested without Supabase. The GET /api/admin/attribution route fetches rows
// via service_role and calls aggregateAttribution() for the channel breakdown.
//
// The signup_attribution table is service_role-only (RLS, no policies) — the
// frontend can never read it directly, so this is the single source of the
// numbers the admin sees.

const DIRECT = "(direct)";
const NONE = "(none)";
// #5310: a signup whose first-touch referrer is our own site. Since the marketing
// front page took over "/" (14/9) the SPA captured first-touch only after the
// click, so the UTM and the external referrer were gone. Same label as
// scripts/monday-numbers.mjs.
export const LOST_IN_MARKETING = "ukendt (tabt i marketing)";
// Our own site: the app domain, the old domain (redirects) and the marketing
// origin behind the rewrites. A referrer from here is never a channel.
const OWN_SITE_HOSTS = ["cyclingzone.org", "cycling-zone.vercel.app", "cycling-zone-marketing.vercel.app"];

// Normalize a stored value: rows are pre-trimmed by buildAttributionRow, but stay
// defensive so the aggregator never crashes on a stray null/whitespace value.
function norm(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

// Domain-anchored: exact host or a dot-bounded subdomain, never a substring.
function isOwnSiteHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return OWN_SITE_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

// Collapse a referrer URL to its host so "https://google.com/search?q=x" and
// "https://google.com/" count as one channel. Falls back to the raw string when
// it isn't a parseable URL, and to "(direct)" when there's no referrer at all.
export function referrerHost(referrer) {
  const raw = norm(referrer, null);
  if (!raw) return DIRECT;
  const url = parseUrl(raw);
  return (url && url.hostname) || raw;
}

// The channel a row is counted under. Read-side fallback for #5310, no DB write:
// when utm_source is NULL and the referrer is our own site, the utm_* are
// recovered from that referrer's query (the tagged link landed on the marketing
// page); without UTM the source is LOST_IN_MARKETING. An own-site referrer is
// never shown as a referrer channel.
export function effectiveChannel(row) {
  const source = norm(row?.utm_source, null);
  const medium = norm(row?.utm_medium, null);
  const rawReferrer = norm(row?.referrer, null);
  const refUrl = rawReferrer ? parseUrl(rawReferrer) : null;
  if (!refUrl || !isOwnSiteHost(refUrl.hostname)) {
    return { source: source || DIRECT, medium: medium || NONE, referrer: referrerHost(rawReferrer) };
  }
  if (source) return { source, medium: medium || NONE, referrer: LOST_IN_MARKETING };
  const recoveredSource = norm(refUrl.searchParams.get("utm_source"), null);
  if (recoveredSource) {
    return {
      source: recoveredSource,
      medium: norm(refUrl.searchParams.get("utm_medium"), medium || NONE),
      referrer: LOST_IN_MARKETING,
    };
  }
  return { source: LOST_IN_MARKETING, medium: medium || NONE, referrer: LOST_IN_MARKETING };
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
  const channels = (Array.isArray(rows) ? rows : []).map(effectiveChannel);
  return {
    total: channels.length,
    by_source: tally(channels, c => c.source),
    by_medium: tally(channels, c => c.medium),
    by_referrer: tally(channels, c => c.referrer),
  };
}
