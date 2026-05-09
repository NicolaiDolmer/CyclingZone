// Market pause kill switch — pure helpers used by api.js + cron.js.
// Three levels: 'none' | 'auctions' | 'all'. Resume shifts auction calculated_end
// forward by the elapsed pause duration so bidders keep their remaining time.

export const PAUSE_LEVELS = Object.freeze(["none", "auctions", "all"]);

export function isAuctionsBlocked(level) {
  return level === "auctions" || level === "all";
}

export function isMarketBlocked(level) {
  return level === "all";
}

// Returns the action set that should still be allowed during a market freeze.
// These are non-progressive cleanup actions: withdraw/reject/cancel/archive.
// Everything else (accept, counter, confirm, new_offer, accept_counter) is blocked.
export const MARKET_PAUSE_ALLOWED_ACTIONS = Object.freeze([
  "archive",
  "withdraw",
  "reject",
  "cancel",
]);

export function isActionBlockedDuringMarketPause(action) {
  return !MARKET_PAUSE_ALLOWED_ACTIONS.includes(action);
}

// Shift an auction's calculated_end forward by the elapsed pause duration.
// Returns ISO string. If pausedAt is null/undefined, returns originalEnd unchanged.
export function shiftCalculatedEnd(originalEnd, pausedAt, resumedAt) {
  if (!pausedAt) return originalEnd;
  const elapsedMs = new Date(resumedAt).getTime() - new Date(pausedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return originalEnd;
  return new Date(new Date(originalEnd).getTime() + elapsedMs).toISOString();
}

// Read pause state from auction_timing_config. Returns { level, pausedAt, reason }.
export async function getMarketPauseState(supabase) {
  const { data } = await supabase
    .from("auction_timing_config")
    .select("market_pause_level, market_paused_at, market_paused_reason")
    .eq("id", 1)
    .maybeSingle();
  return {
    level: data?.market_pause_level || "none",
    pausedAt: data?.market_paused_at || null,
    reason: data?.market_paused_reason || null,
  };
}

// Build a 503 response payload for blocked routes. Returns the body object.
export function buildPauseErrorBody({ scope, reason }) {
  const base = scope === "market"
    ? "Markedet er midlertidigt pauset af admin"
    : "Auktioner er midlertidigt pauset af admin";
  return {
    error: reason ? `${base}: ${reason}` : `${base}.`,
    code: "market_paused",
    scope,
  };
}
