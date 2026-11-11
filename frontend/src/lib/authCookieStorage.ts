import { combineChunks, createChunks, stringFromBase64URL, stringToBase64URL } from "@supabase/ssr";

type CookiePort = { read(): string; write(value: string): void; secure: boolean };
type LegacyPort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const MAX_AGE = 400 * 24 * 60 * 60;

/** Cookie storage for new clients, with a compatibility bridge for pre-deploy tabs.
 * Encoding/chunking matches @supabase/ssr. No change to the existing implicit auth flow.
 * Session presence is only a routing hint, never authorization.
 */
export function createAuthCookieStorage(port: CookiePort, legacy: LegacyPort | null) {
  const entries = () =>
    port
      .read()
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index).trim(), part.slice(index + 1)] as const;
      });
  const matching = (key: string) =>
    entries().filter(
      ([name]) =>
        name === key || (name.startsWith(`${key}.`) && /^\d+$/.test(name.slice(key.length + 1)))
    );
  const write = (name: string, value: string, maxAge: number) =>
    port.write(
      `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${port.secure ? "; Secure" : ""}`
    );
  const readCookie = async (key: string): Promise<string | null> => {
    try {
      const all = new Map(entries());
      const value = await combineChunks(key, (name) => all.get(name) ?? null);
      if (!value) return null;
      return value.startsWith("base64-")
        ? stringFromBase64URL(value.slice(7))
        : decodeURIComponent(value);
    } catch {
      return null;
    }
  };
  const safeLegacyGet = (key: string) => {
    try {
      return legacy?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const clearCookies = (key: string) => {
    try {
      for (const [name] of matching(key)) write(name, "", 0);
    } catch {
      /* Blocked cookies. */
    }
  };
  const writeCookies = async (key: string, value: string) => {
    let stored = false;
    try {
      const chunks = createChunks(key, `base64-${stringToBase64URL(value)}`);
      const names = new Set(chunks.map((chunk) => chunk.name));
      for (const [name] of matching(key)) if (!names.has(name)) write(name, "", 0);
      for (const chunk of chunks) write(chunk.name, chunk.value, MAX_AGE);
      stored = (await readCookie(key)) === value;
    } catch {
      /* Keep a recoverable legacy copy if cookies are unavailable. */
    }
    return stored;
  };
  const storage = {
    async getItem(key: string): Promise<string | null> {
      const cookie = await readCookie(key);
      const stamp = safeLegacyGet(`${key}:cookie-migrated`);
      const old = safeLegacyGet(key);
      // During rollout, pre-deploy tabs still share this key. Read it each time;
      // retaining one shared source prevents account divergence between versions.
      if (stamp === "bridge") {
        if (old === null) clearCookies(key);
        else if (old !== cookie) await writeCookies(key, old);
        return old;
      }
      if (cookie !== null) return cookie;
      if (stamp) return null;
      if (old !== null) await storage.setItem(key, old);
      return old;
    },
    async setItem(key: string, value: string): Promise<void> {
      // Compatibility window: even an anonymous pre-deploy tab may later log in.
      // Keep one shared source for every storage-capable browser until old clients
      // can be retired in a separately verified rollout. Cookies serve edge routing.
      let shared = false;
      let previous: { value: string | null; stamp: string | null } | null = null;
      try {
        if (legacy)
          previous = {
            value: legacy.getItem(key),
            stamp: legacy.getItem(`${key}:cookie-migrated`),
          };
      } catch {
        /* Cookie-only mode when localStorage is inaccessible. */
      }
      if (legacy && previous) {
        try {
          legacy.setItem(key, value);
          legacy.setItem(`${key}:cookie-migrated`, "bridge");
          if (
            legacy.getItem(key) !== value ||
            legacy.getItem(`${key}:cookie-migrated`) !== "bridge"
          )
            throw new Error("Unpersisted session");
          shared = true;
        } catch {
          // Never report cookie login success while old tabs retain another user.
          try {
            if (previous.value === null) legacy.removeItem(key);
            else legacy.setItem(key, previous.value);
            if (previous.stamp === null) legacy.removeItem(`${key}:cookie-migrated`);
            else legacy.setItem(`${key}:cookie-migrated`, previous.stamp);
          } catch {
            /* Persistence failed; caller receives an explicit error below. */
          }
          throw new Error("Browser session storage unavailable");
        }
      }
      const stored = await writeCookies(key, value);
      if (!stored) {
        clearCookies(key);
        if (!shared) throw new Error("Browser session storage unavailable");
      }
    },
    async applyLegacyChange(key: string): Promise<void> {
      if (safeLegacyGet(`${key}:cookie-migrated`) === "bridge") await storage.getItem(key);
    },
    async removeItem(key: string): Promise<void> {
      clearCookies(key);
      try {
        legacy?.removeItem(key);
      } catch {
        if (safeLegacyGet(key) !== null) throw new Error("Browser session could not be cleared");
      }
      try {
        legacy?.setItem(`${key}:cookie-migrated`, "bridge");
      } catch {
        /* Metadata failure must never skip session deletion. */
      }
    },
  };
  return storage;
}

export function browserAuthStorage(key: string | null) {
  if (typeof document === "undefined") return undefined;
  let legacy: Storage | null = null;
  try {
    legacy = window.localStorage;
  } catch {
    /* Restricted browser. */
  }
  // Retire the former non-authoritative routing marker.
  try {
    document.cookie = "cz_session=; Path=/; Max-Age=0; SameSite=Lax";
  } catch {
    /* Cookie access can throw in restricted browsers. */
  }
  const storage = createAuthCookieStorage(
    {
      read: () => document.cookie,
      write: (value) => {
        document.cookie = value;
      },
      secure: location.protocol === "https:",
    },
    legacy
  );
  // Old pre-deploy tabs still use localStorage. Bridge storage-capable browsers;
  // the bridge survives logout to support fresh login in an already-open old tab.
  window.addEventListener("storage", (event) => {
    if (key && event.key === key) {
      void storage.applyLegacyChange(key).catch(() => {
        console.warn("[auth] Legacy session synchronization unavailable");
      });
    }
  });
  return storage;
}
