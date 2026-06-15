// First-touch signup attribution (#679). Sanitizes the client-supplied
// attribution payload into a row for public.signup_attribution. Pure builder so
// it can be unit-tested without a DB. Basis: legitimate interest (privacy policy).
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

// Returns a sanitized row, or null when there's nothing worth storing (no
// userId, no payload, or no source/referrer/landing signal at all).
export function buildAttributionRow(userId, attribution) {
  if (!userId || !attribution || typeof attribution !== "object") return null;
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
