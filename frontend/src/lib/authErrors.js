// Map Supabase auth-error messages to i18n keys. Refs #411.
//
// Supabase returns error.message in English; we map known patterns to
// localised strings via the `errors` namespace. Unknown errors fall back
// to the raw message so we don't swallow debugging info.

const PATTERNS = [
  [/invalid login credentials/i, "errors:supabase.invalidCredentials"],
  [/email not confirmed/i, "errors:supabase.emailNotConfirmed"],
  [/user already registered/i, "errors:supabase.userAlreadyRegistered"],
  [/password should be at least/i, "errors:supabase.passwordTooShort"],
  [/email rate limit/i, "errors:supabase.rateLimited"],
  [/over email send rate limit/i, "errors:supabase.rateLimited"],
  [/for security purposes, you can only request this once/i, "errors:supabase.rateLimited"],
  [/unable to validate email address/i, "errors:supabase.invalidEmail"],
  [/auth session missing/i, "errors:supabase.sessionMissing"],
  [/token has expired/i, "errors:supabase.tokenExpired"],
  [/new password should be different/i, "errors:supabase.passwordSameAsOld"],
];

/**
 * Detect a network/connectivity failure (offline, DNS, dropped fetch).
 *
 * #1348 — et rejected Supabase-kald pga. manglende netværk surfacer som en
 * TypeError "Failed to fetch" (browser) eller supabase-js'
 * AuthRetryableFetchError. Vi genkender det på samme måde som det
 * eksisterende waitlist-flow (mapInsertError): "network" / "fetch" i beskeden.
 * Bruges til at vælge connection-error-copy frem for den rå (engelske) besked.
 */
export function isNetworkError(error) {
  if (!error) return false;
  const name = typeof error === "string" ? "" : (error?.name || "");
  if (/AuthRetryableFetchError/i.test(name)) return true;
  const msg = (typeof error === "string" ? error : error?.message || "").toLowerCase();
  return msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("fetch failed") ||
    msg.includes("load failed");
}

/**
 * Translate a Supabase auth error using the provided t-function.
 * Returns a localised string, falling back to the raw message.
 *
 * #1348 — netværksfejl (offline/dropped connection) mappes til den
 * eksisterende connection-error-copy (errors:generic.networkError) i stedet
 * for den rå engelske "Failed to fetch", så brugeren får en handlingsanvisende
 * besked uanset sprog.
 */
export function mapSupabaseAuthError(error, t) {
  if (isNetworkError(error)) return t("errors:generic.networkError");
  const msg = typeof error === "string" ? error : error?.message;
  if (!msg) return t("errors:supabase.unknown");
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(msg)) return t(key);
  }
  return msg;
}
