// First-touch signup attribution (#679). Sanitizes the client-supplied
// attribution payload into a row for public.signup_attribution. Pure builder so
// it can be unit-tested without a DB. Basis: legitimate interest (privacy policy).
import { isOwnSiteHost } from "./attributionDashboard.js";

const FIELD_LIMITS = {
  utm_source: 200,
  utm_medium: 200,
  utm_campaign: 200,
  utm_term: 200,
  utm_content: 200,
  referrer: 500,
  landing_path: 200,
  first_seen_at: 40,
};

// #6292: server-side guard. A referrer on our own site is never a channel (the
// client fix in #5550 should stop sending it, this keeps stale clients out too).
// Recover utm_* from the referrer's query when the payload has none, then drop
// the referrer. Returns a shallow copy; the input is never mutated.
function stripOwnSiteReferrer(attribution) {
  const raw = typeof attribution.referrer === "string" ? attribution.referrer.trim() : "";
  if (!raw) return attribution;
  let url;
  try {
    url = new URL(raw);
  } catch {
    // best-effort: en referrer der ikke kan parses er ikke vores egen side, behold den uaendret
    return attribution;
  }
  if (!isOwnSiteHost(url.hostname)) return attribution;
  const out = { ...attribution, referrer: null };
  const hasSource = typeof out.utm_source === "string" && out.utm_source.trim();
  if (!hasSource && url.searchParams.get("utm_source")?.trim()) {
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const value = url.searchParams.get(key);
      if (value) out[key] = value;
    }
  }
  return out;
}

// Returns a sanitized row, or null when there's nothing worth storing (no
// userId, no payload, or no source/referrer/landing signal at all).
export function buildAttributionRow(userId, rawAttribution) {
  if (!userId || !rawAttribution || typeof rawAttribution !== "object") return null;
  const attribution = stripOwnSiteReferrer(rawAttribution);
  const row = { user_id: userId };
  let hasSignal = false;
  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    const raw = attribution[key];
    const clean = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, max) : null;
    row[key] = clean;
    if (clean && key !== "first_seen_at") hasSignal = true;
  }
  if (!hasSignal) return null;
  return row;
}
