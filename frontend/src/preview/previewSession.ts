// #3430: seed en mock-Supabase-session i localStorage på preview-deploys, så
// route-guarden ser en logget ind bruger i stedet for at redirecte til signup.
// Rene funktioner (testbare i node). Selve kaldet sker i previewSessionBoot.ts.
import { TEST_USER } from "./seedData.js";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** supabase-js' default storage key: sb-<første host-label>-auth-token. */
export function previewSessionStorageKey(supabaseUrl: string): string | null {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

export function buildPreviewSession(nowMs: number = Date.now()) {
  const expiresIn = 60 * 60 * 24 * 365;
  return {
    access_token: "preview-token",
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(nowMs / 1000) + expiresIn,
    refresh_token: "preview-refresh",
    user: TEST_USER,
  };
}

/** Skriver mock-sessionen hvis der ikke allerede ligger en. Returnerer true ved skrivning. */
export function seedPreviewSession(
  storage: StorageLike | undefined,
  supabaseUrl: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!storage || !supabaseUrl) return false;
  const key = previewSessionStorageKey(supabaseUrl);
  if (!key) return false;
  try {
    if (storage.getItem(key) || storage.getItem(`${key}:cookie-migrated`)) return false;
    storage.setItem(key, JSON.stringify(buildPreviewSession(nowMs)));
    return true;
  } catch {
    return false;
  }
}
