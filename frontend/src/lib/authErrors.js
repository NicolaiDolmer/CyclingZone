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
 * Translate a Supabase auth error using the provided t-function.
 * Returns a localised string, falling back to the raw message.
 */
export function mapSupabaseAuthError(error, t) {
  const msg = typeof error === "string" ? error : error?.message;
  if (!msg) return t("errors:supabase.unknown");
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(msg)) return t(key);
  }
  return msg;
}
