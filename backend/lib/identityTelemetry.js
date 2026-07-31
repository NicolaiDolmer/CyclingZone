/**
 * Identity telemetry (#3132, fair-play epic #3131 — lag 1: bevis).
 *
 * Persists one row per signup + one row per value-bearing action (transfer
 * accepted, auction bid, loan taken, swap accepted) into public.identity_events
 * so a future fair-play case (like #2776) has IP/UA history to investigate.
 * auth.audit_log_entries is empty (short Supabase retention), auth.sessions
 * only reflects live sessions, and signup_attribution.first_seen_at is a
 * localStorage stamp an incognito tab resets — none of the three survive.
 *
 * This module is PURE bevis-opsamling. It is not a detector (that's #3135) —
 * shared IP must never gate anything here, it's just recorded for later
 * correlation.
 *
 * Fail-open, always: telemetry must never block or slow down the action it's
 * attached to. Every public function swallows its own errors and logs them;
 * callers should fire-and-forget (`recordIdentityEvent(...).catch(() => {})`
 * is unnecessary since the promise itself never rejects, but callers must
 * still not `await` it inline before responding to the client).
 */

const VALID_EVENT_TYPES = new Set([
  "signup",
  "transfer_accepted",
  "auction_bid",
  "loan_taken",
  "swap_accepted",
]);

const FIELD_LIMITS = {
  user_agent: 500,
  accept_language: 200,
  first_seen_at: 40,
  entity_id: 200,
};

// Reads the real client IP off an Express request. `trust proxy = 1` is set
// in server.js (Railway terminates TLS upstream), so req.ip already resolves
// X-Forwarded-For correctly — this just centralizes the read + guards against
// an empty string (Express can return "" when nothing resolves).
export function getClientIp(req) {
  const ip = req?.ip;
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}

function clamp(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

// Pure builder — sanitizes inputs into an identity_events row, or returns
// null when the event is malformed (missing user/event type). No DB, no I/O,
// fully unit-testable.
export function buildIdentityEventRow({
  userId,
  teamId = null,
  eventType,
  entityId = null,
  req = null,
  firstSeenAt = null,
  timezoneOffsetMinutes = null,
  metadata = null,
} = {}) {
  if (!userId || !VALID_EVENT_TYPES.has(eventType)) return null;

  const userAgent = clamp(req?.headers?.["user-agent"], FIELD_LIMITS.user_agent);
  const acceptLanguage = clamp(req?.headers?.["accept-language"], FIELD_LIMITS.accept_language);
  const ip = req ? getClientIp(req) : null;

  const tzOffset = Number.isFinite(timezoneOffsetMinutes) ? Math.trunc(timezoneOffsetMinutes) : null;

  return {
    user_id: userId,
    team_id: teamId || null,
    event_type: eventType,
    entity_id: clamp(entityId != null ? String(entityId) : null, FIELD_LIMITS.entity_id),
    ip,
    user_agent: userAgent,
    accept_language: acceptLanguage,
    timezone_offset_minutes: tzOffset,
    first_seen_at: clamp(firstSeenAt, FIELD_LIMITS.first_seen_at),
    metadata: metadata && typeof metadata === "object" ? metadata : null,
  };
}

// Fire-and-forget insert. NEVER throws and NEVER returns a rejected promise —
// any DB/network error is caught, logged, and swallowed so a telemetry outage
// can never block signup or a value-bearing action. Callers should NOT
// `await` this before responding to the client.
export async function recordIdentityEvent(supabase, params) {
  try {
    const row = buildIdentityEventRow(params);
    if (!row) return { skipped: true };
    const { error } = await supabase.from("identity_events").insert(row);
    if (error) {
      console.error("[identity-telemetry] persist fejlede:", error.message);
      return { skipped: true, error: error.message };
    }
    return { skipped: false };
  } catch (err) {
    console.error("[identity-telemetry] uventet fejl:", err.message);
    return { skipped: true, error: err.message };
  }
}
