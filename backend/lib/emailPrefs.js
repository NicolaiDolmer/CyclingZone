// Per-type email preferences (#2725). Pure logic, no @supabase/supabase-js
// import, so unit-tests run without env/websocket coupling (same separation
// as discordDmPrefs.js, which this file mirrors 1:1).
//
// Semantics: prefs store only opt-OUTS. An absent key means the email type is
// enabled (default-on). The master key "all" is the one-click unsubscribe
// switch — {"all": false} mutes every loop email type regardless of the
// per-type keys.

// The three loop email types (#2725 scope). Matches emailTemplates.js's
// exported TEMPLATE_TYPES.
export const EMAIL_PREF_TYPES = Object.freeze(["welcome", "day1", "race_digest"]);

const EMAIL_PREF_TYPE_SET = new Set(EMAIL_PREF_TYPES);

/**
 * True unless the player has explicitly muted this email type (or all email).
 * Fails open: absent prefs object, absent key, or an unknown type all return
 * true — a send is only suppressed when "all" or the matching type key is
 * exactly `false`.
 */
export function isEmailTypeEnabled(prefs, type) {
  if (prefs?.all === false) return false;
  if (!EMAIL_PREF_TYPE_SET.has(type)) return true;
  return prefs?.[type] !== false;
}

/**
 * Sanitize an incoming prefs patch (API boundary, if one is ever added).
 * Keeps only known keys ("all" + the three type keys) with strict boolean
 * values; reports unknown keys so the caller can reject the request. No
 * string/number coercion.
 */
export function sanitizeEmailPrefs(input) {
  if (!input || typeof input !== "object") return { prefs: {}, unknownKeys: [] };
  const prefs = {};
  const unknownKeys = [];
  for (const [key, value] of Object.entries(input)) {
    if (key !== "all" && !EMAIL_PREF_TYPE_SET.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    if (typeof value === "boolean") prefs[key] = value;
  }
  return { prefs, unknownKeys };
}
