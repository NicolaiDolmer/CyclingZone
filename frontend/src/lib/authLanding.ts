/** Supabase's default storage key. Public project host, never a credential. */
export function authStorageKey(url: string | undefined): string | null {
  try {
    return `sb-${new URL(url ?? "").hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

export function hasAuthCookie(cookie: string, key: string | null): boolean {
  if (!key) return false;
  return cookie.split(";").some((part) => {
    const [name, ...value] = part.trim().split("=");
    return (name === key || name === `${key}.0`) && value.join("=").length > 0;
  });
}

/** Runs in the HEAD before public markup can paint. Self-contained for inline use. */
export function redirectAuthenticatedLanding(key: string | null): void {
  if (!key || !["/", "/da", "/da/"].includes(location.pathname)) return;
  let candidate = false;
  try {
    candidate = document.cookie.split(";").some((part) => {
      const [name, ...value] = part.trim().split("=");
      return (name === key || name === `${key}.0`) && value.join("=").length > 0;
    });
  } catch { /* Cookie access may be blocked while localStorage still works. */ }
  try {
    if (!candidate && localStorage.getItem(`${key}:cookie-migrated`) !== "1") {
      const session = JSON.parse(localStorage.getItem(key) || "null");
      candidate = Boolean(session?.access_token && session?.refresh_token && session?.user);
    }
  } catch {
    /* Blocked storage or malformed legacy state is not authentication. */
  }
  const hash = new URLSearchParams(location.hash.slice(1));
  candidate ||=
    hash.has("access_token") ||
    hash.has("error") ||
    new URLSearchParams(location.search).has("code");
  if (candidate) {
    // Navigation starts synchronously before the parser reaches marketing content.
    document.documentElement.style.visibility = "hidden";
    location.replace("/dashboard" + location.search + location.hash);
  }
}

export function landingGuardScript(key: string | null): string {
  const argument = JSON.stringify(key).replace(/</g, "\\u003c");
  return `(${redirectAuthenticatedLanding.toString()})(${argument});`;
}
