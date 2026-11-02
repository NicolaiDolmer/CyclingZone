import test from "node:test";
import assert from "node:assert/strict";
import { previewSessionStorageKey, buildPreviewSession, seedPreviewSession } from "./previewSession.ts";
import { TEST_USER } from "./seedData.js";

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

test("storage key følger supabase-js sb-<host-label>-auth-token", () => {
  assert.equal(previewSessionStorageKey("https://abc123.supabase.co"), "sb-abc123-auth-token");
  assert.equal(previewSessionStorageKey("not a url"), null);
});

test("mock-sessionen har en bruger og udløber i fremtiden", () => {
  const now = Date.UTC(2026, 10, 2);
  const s = buildPreviewSession(now);
  assert.equal(s.user.id, TEST_USER.id);
  assert.ok(s.expires_at > now / 1000);
  assert.equal(s.token_type, "bearer");
});

test("seed skriver sessionen under den rigtige nøgle", () => {
  const st = memStorage();
  assert.equal(seedPreviewSession(st, "https://abc123.supabase.co"), true);
  const stored = JSON.parse(st.getItem("sb-abc123-auth-token")!);
  assert.equal(stored.user.id, TEST_USER.id);
});

test("seed overskriver ikke en eksisterende session", () => {
  const st = memStorage({ "sb-abc123-auth-token": "{\"existing\":true}" });
  assert.equal(seedPreviewSession(st, "https://abc123.supabase.co"), false);
  assert.equal(st.getItem("sb-abc123-auth-token"), "{\"existing\":true}");
});

test("seed er no-op uden storage eller url, og kaster aldrig", () => {
  assert.equal(seedPreviewSession(undefined, "https://abc123.supabase.co"), false);
  assert.equal(seedPreviewSession(memStorage(), undefined), false);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
  assert.equal(seedPreviewSession(throwing, "https://abc123.supabase.co"), false);
});

test("sessionen seedes kun bag VITE_PREVIEW_MOCK-guarden i boot-modulet", async () => {
  const { readFileSync } = await import("node:fs");
  const boot = readFileSync(new URL("./previewSessionBoot.ts", import.meta.url), "utf8");
  assert.match(boot, /if \(import\.meta\.env\.VITE_PREVIEW_MOCK\) \{\s*seedPreviewSession\(/);
  const main = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
  assert.ok(main.indexOf("previewSessionBoot") < main.indexOf("./App.jsx"), "boot skal importeres før App/supabase");
});
