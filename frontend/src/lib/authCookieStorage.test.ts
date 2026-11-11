import { test } from "node:test";
import assert from "node:assert/strict";
import { combineChunks, createChunks, stringToBase64URL, stringFromBase64URL } from "@supabase/ssr";
import { createAuthCookieStorage } from "./authCookieStorage.ts";
const key = "sb-fixture-auth-token";
const value = JSON.stringify({
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  user: { id: "fixture-user" },
});
function fixture(blocked = false) {
  const jar = new Map<string, string>();
  const old = new Map<string, string>();
  const writes: string[] = [];
  const storage = createAuthCookieStorage(
    {
      secure: true,
      read: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      write: (line) => {
        writes.push(line);
        if (blocked) return;
        const [pair] = line.split(";");
        const i = pair.indexOf("=");
        if (line.includes("Max-Age=0")) jar.delete(pair.slice(0, i));
        else jar.set(pair.slice(0, i), pair.slice(i + 1));
      },
    },
    {
      getItem: (k) => old.get(k) ?? null,
      setItem: (k, v) => {
        old.set(k, v);
      },
      removeItem: (k) => {
        old.delete(k);
      },
    }
  );
  return { storage, jar, old, writes };
}
test("migration bridges old tabs while keeping the real cookie synchronized", async () => {
  const f = fixture();
  f.old.set(key, value);
  assert.equal(await f.storage.getItem(key), value);
  assert.equal(f.old.get(key), value);
  assert.equal(f.old.get(`${key}:cookie-migrated`), "bridge");
  f.old.set(key, "old-tab-new-session");
  assert.equal(await f.storage.getItem(key), "old-tab-new-session");
  await f.storage.removeItem(key);
  assert.equal(await f.storage.getItem(key), null);
  assert.equal(f.jar.size, 0);
  assert.ok(
    f.writes.every(
      (line) => line.includes("Secure") && line.includes("SameSite=Lax") && line.includes("Path=/")
    )
  );
});
test("unicode and large sessions roundtrip; refresh removes obsolete chunks", async () => {
  const f = fixture();
  const large = JSON.stringify({ metadata: "æ🚴".repeat(2500) });
  await f.storage.setItem(key, large);
  assert.ok(f.jar.size > 1);
  assert.equal(await f.storage.getItem(key), large);
  await f.storage.setItem(key, value);
  assert.equal(await f.storage.getItem(key), value);
  assert.deepEqual([...f.jar.keys()], [key]);
});
test("blocked cookies retain legacy without false migration; logout clears fallback", async () => {
  const f = fixture(true);
  f.old.set(key, value);
  assert.equal(await f.storage.getItem(key), value);
  assert.equal(f.old.get(key), value);
  assert.equal(f.old.get(`${key}:cookie-migrated`), "bridge");
  await f.storage.removeItem(key);
  assert.equal(await f.storage.getItem(key), null);
});
test("malformed cookie fails closed and unrelated cookies survive logout", async () => {
  const f = fixture();
  f.jar.set(key, "base64-%bad");
  f.jar.set("other", "preserved");
  await f.storage.removeItem(key);
  assert.equal(await f.storage.getItem(key), null);
  assert.equal(f.jar.get("other"), "preserved");
});

test("two tabs with blocked cookies observe logout and replacement login immediately", async () => {
  const values = new Map<string, string>();
  const legacy = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const port = { read: () => "", write: () => {}, secure: true };
  const a = createAuthCookieStorage(port, legacy),
    b = createAuthCookieStorage(port, legacy);
  await a.setItem(key, value);
  assert.equal(await b.getItem(key), value);
  await b.removeItem(key);
  assert.equal(await a.getItem(key), null);
  await b.setItem(key, "replacement-user");
  assert.equal(await a.getItem(key), "replacement-user");
});
test("fully blocked storage reports failed persistence instead of a stale per-tab identity", async () => {
  const storage = createAuthCookieStorage({ read: () => "", write: () => {}, secure: true }, null);
  await assert.rejects(storage.setItem(key, value), /storage unavailable/);
  assert.equal(await storage.getItem(key), null);
});

test("pre-deploy tab can refresh, log out, and sign in again across rollout", async () => {
  const f = fixture();
  f.old.set(key, value);
  await f.storage.getItem(key);
  f.old.set(key, "old-tab-refreshed");
  await f.storage.applyLegacyChange(key);
  assert.equal(await f.storage.getItem(key), "old-tab-refreshed");
  await f.storage.setItem(key, "new-tab-refreshed");
  assert.equal(f.old.get(key), "new-tab-refreshed");
  f.old.delete(key);
  await f.storage.applyLegacyChange(key);
  assert.equal(await f.storage.getItem(key), null);
  f.old.set(key, "old-tab-new-login");
  await f.storage.applyLegacyChange(key);
  assert.equal(await f.storage.getItem(key), "old-tab-new-login");
});
test("fresh sign-in supports an already-open anonymous pre-deploy tab", async () => {
  const f = fixture();
  await f.storage.setItem(key, value);
  assert.equal(f.old.get(key), value);
  assert.equal(f.old.get(`${key}:cookie-migrated`), "bridge");
});

test("quota failure cannot report a new cookie login while retaining a previous account", async () => {
  const values = new Map([[key, "previous-user"]]);
  const jar = new Map<string, string>();
  const storage = createAuthCookieStorage(
    {
      secure: true,
      read: () => [...jar].map(([k, v]) => `${k}=${v}`).join(";"),
      write: (line) => {
        const pair = line.split(";")[0];
        jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      },
    },
    {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        if (k === key && v !== "previous-user") throw new Error("QuotaExceededError");
        values.set(k, v);
      },
      removeItem: (k) => {
        values.delete(k);
      },
    }
  );
  await assert.rejects(storage.setItem(key, "new-user"), /storage unavailable/);
  assert.equal(values.get(key), "previous-user");
  assert.equal(jar.size, 0);
});
test("logout removes session even if bridge metadata cannot be written", async () => {
  const values = new Map([[key, value]]);
  const storage = createAuthCookieStorage(
    { secure: true, read: () => "", write: () => {} },
    {
      getItem: (k) => values.get(k) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (k) => {
        values.delete(k);
      },
    }
  );
  await storage.removeItem(key);
  assert.equal(values.has(key), false);
  assert.equal(await storage.getItem(key), null);
});

test("cookie codec interoperates with SSR cookies in both directions, without legacy storage", async () => {
  const values = [value, "", "a", "ab", "abc", "æøå🚴漢字\u0000".repeat(2500)];
  for (const text of values) {
    const f = fixture();
    await f.storage.setItem(key, text);
    const encoded = await combineChunks(key, (name) => f.jar.get(name) ?? null);
    assert.equal(encoded, `base64-${stringToBase64URL(text)}`);
    assert.equal(stringFromBase64URL(encoded!.slice(7)), text);
    f.old.clear();
    f.jar.clear();
    for (const chunk of createChunks(key, `base64-${stringToBase64URL(text)}`))
      f.jar.set(chunk.name, chunk.value);
    assert.equal(await f.storage.getItem(key), text);
  }
  const malformed = fixture();
  malformed.jar.set(key, "base64-_w"); // Invalid UTF-8 must fail closed.
  assert.equal(await malformed.storage.getItem(key), null);
});
