// Per-type Discord DM preferences. Pure logic, no @supabase/supabase-js import,
// so unit-tests run on Node without the realtime websocket-factory init (same
// separation as discordDmTarget.js). Consumed by the single DM choke-point in
// discordNotifier.js and by the profile-prefs API validation in routes/api.js.
//
// Semantics: prefs store only opt-OUTS. An absent key means the DM type is
// enabled (default-on). The master switch (users.discord_dm_enabled) is enforced
// separately, upstream of this gate.

// The six player-configurable pref keys, in the group order the settings UI
// renders them (Auctions · Transfers · Club).
export const DM_PREF_KEYS = Object.freeze([
  "auction_outbid",
  "auction_won",
  "watchlist_rider_auction",
  "transfer_offer",
  "transfer_response",
  "board_update",
]);

// Low-level DM type -> pref key. Types that share a toggle (transfer replies,
// board updates) collapse onto one key. Types absent here have no toggle.
const DM_TYPE_TO_PREF_KEY = Object.freeze({
  auction_outbid: "auction_outbid",
  auction_won: "auction_won",
  watchlist_rider_auction: "watchlist_rider_auction",
  transfer_offer: "transfer_offer",
  transfer_accepted: "transfer_response",
  transfer_rejected: "transfer_response",
  board_update: "board_update",
  board_critical: "board_update",
});

const DM_PREF_KEY_SET = new Set(DM_PREF_KEYS);

/** Map a DM `type` to its pref key, or null if the type has no toggle. */
export function prefKeyFor(type) {
  return DM_TYPE_TO_PREF_KEY[type] ?? null;
}

/**
 * True unless the player has explicitly muted this DM type. Fails open: absent
 * pref, missing prefs object, or an unknown/un-keyed type all return true, so a
 * DM is only suppressed when a mapped pref is exactly `false`.
 */
export function isDmTypeEnabled(prefs, type) {
  const key = prefKeyFor(type);
  if (!key) return true;
  return prefs?.[key] !== false;
}

/**
 * Sanitize an incoming prefs patch (API boundary). Keeps only known pref keys
 * with strict boolean values; reports any unknown keys so the caller can reject
 * the request. No string/number coercion — the client sends real booleans.
 */
export function sanitizeDmPrefs(input) {
  if (!input || typeof input !== "object") return { prefs: {}, unknownKeys: [] };
  const prefs = {};
  const unknownKeys = [];
  for (const [key, value] of Object.entries(input)) {
    if (!DM_PREF_KEY_SET.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    if (typeof value === "boolean") prefs[key] = value;
  }
  return { prefs, unknownKeys };
}
