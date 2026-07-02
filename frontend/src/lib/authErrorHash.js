// Parse the URL hash fragment Supabase appends when an email link redirect fails.
// Refs #2078.
//
// signUp() sets no emailRedirectTo, so confirmation links land on the Supabase
// Site URL (our root "/"). When the token is expired or invalid, Supabase does
// NOT establish a session — instead it redirects with an error in the hash:
//
//   /#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
//
// Nothing in the app read error_code, so the user landed silently on the landing
// page with no explanation (Discord report 1/7). We parse the hash at mount and
// surface a clear message + a route to /login (where the resend flow lives).

/**
 * Parse a location hash into its auth-error parts, or null if it carries no
 * auth error. A successful email link uses `#access_token=...` (handled by
 * supabase-js' detectSessionInUrl), so we only react when `error`/`error_code`
 * is present — never on the success hash.
 *
 * @param {string} hash - e.g. window.location.hash ("#error=...&error_code=...")
 * @returns {{ error: string, errorCode: string, errorDescription: string } | null}
 */
export function parseAuthErrorHash(hash) {
  if (!hash || typeof hash !== "string") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;

  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }

  const error = params.get("error");
  const errorCode = params.get("error_code");
  if (!error && !errorCode) return null;

  return {
    error: error || "",
    errorCode: errorCode || "",
    errorDescription: params.get("error_description") || "",
  };
}

/**
 * True when the parsed hash represents an expired/invalid email link
 * (the reported case): otp_expired, or the broader access_denied it arrives
 * under. Used to decide whether to surface the expired-link message.
 *
 * @param {ReturnType<typeof parseAuthErrorHash>} parsed
 * @returns {boolean}
 */
export function isExpiredOrDeniedAuthError(parsed) {
  if (!parsed) return false;
  return parsed.errorCode === "otp_expired" || parsed.error === "access_denied";
}
