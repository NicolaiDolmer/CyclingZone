import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { authStorageKey, landingGuardScript } from "./authLanding.ts";
const key = "sb-fixture-auth-token";
function run({
  cookie = "",
  legacy = null,
  stamp = false,
  hash = "",
  search = "",
  pathname = "/",
  blocked = false,
}: {
  cookie?: string;
  legacy?: string | null;
  stamp?: boolean;
  hash?: string;
  search?: string;
  pathname?: string;
  blocked?: boolean;
} = {}) {
  const destinations: string[] = [];
  const style: { visibility?: string } = {};
  runInNewContext(landingGuardScript(key), {
    document: { cookie, documentElement: { style } },
    localStorage: {
      getItem: (k: string) => {
        if (blocked) throw Error("blocked");
        return k.endsWith(":cookie-migrated") ? (stamp ? "1" : null) : legacy;
      },
    },
    location: { pathname, hash, search, replace: (url: string) => destinations.push(url) },
    URLSearchParams,
  });
  return { destinations, style };
}
test("localStorage-only session is hidden synchronously; attribution and fragments preserved", () => {
  const r = run({
    legacy: JSON.stringify({
      access_token: "fixture",
      refresh_token: "fixture",
      user: { id: "fixture" },
    }),
    search: "?utm_source=club",
    hash: "#state",
  });
  assert.deepEqual(r.destinations, ["/dashboard?utm_source=club#state"]);
  assert.equal(r.style.visibility, "hidden");
});
test("anonymous, corrupt and stale marker sessions never hide public marketing", () => {
  for (const options of [
    {},
    { legacy: "{" },
    { cookie: "cz_session=1" },
    { blocked: true },
    { legacy: "{}", stamp: true },
  ]) {
    assert.deepEqual(run(options).destinations, []);
    assert.equal(run(options).style.visibility, undefined);
  }
});
test("real cookie/callback handles Danish root, but never loops on app paths", () => {
  assert.deepEqual(run({ cookie: `${key}.0=fixture`, pathname: "/da" }).destinations, [
    "/dashboard",
  ]);
  assert.deepEqual(run({ hash: "#error=access_denied" }).destinations, [
    "/dashboard#error=access_denied",
  ]);
  assert.deepEqual(run({ hash: "#access_token=fixture" }).destinations, [
    "/dashboard#access_token=fixture",
  ]);
  assert.deepEqual(run({ search: "?code=fixture" }).destinations, ["/dashboard?code=fixture"]);
  assert.deepEqual(run({ cookie: `${key}=fixture`, pathname: "/dashboard" }).destinations, []);
  assert.equal(authStorageKey("https://fixture.supabase.co"), key);
  assert.equal(authStorageKey("invalid"), null);
});

test('a throwing cookie getter does not hide a usable legacy session from the guard', () => {
  const destinations: string[] = [];
  const document = { documentElement: { style: {} } };
  Object.defineProperty(document, 'cookie', { get: () => { throw new Error('SecurityError'); } });
  runInNewContext(landingGuardScript(key), {
    document,
    localStorage: { getItem: (k: string) => k === key ? JSON.stringify({ access_token: 'fixture', refresh_token: 'fixture', user: {} }) : null },
    location: { pathname: '/', search: '', hash: '', replace: (url: string) => destinations.push(url) },
    URLSearchParams,
  });
  assert.deepEqual(destinations, ['/dashboard']);
});
