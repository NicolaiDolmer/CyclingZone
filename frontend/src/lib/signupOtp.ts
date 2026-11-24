const STAGING_AUTH_ORIGIN = "https://pywxpnynzmbukdvoiazp.supabase.co";

export function isStagingSignupOtp(mode: string, authUrl?: string): boolean {
  if (mode !== "staging" || !authUrl) return false;
  try {
    return new URL(authUrl).origin === STAGING_AUTH_ORIGIN;
  } catch {
    return false;
  }
}

export function normalizeSignupOtp(value: string): string | null {
  const code = value.replace(/\s/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}
