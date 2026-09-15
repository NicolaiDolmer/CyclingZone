import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_SHELL_COOKIE, appShellHeaders, fetchAppShell } from "./fetchAppShell.mjs";

test("appShellHeaders sender cz_session-cookien", () => {
  assert.deepEqual(appShellHeaders(), { cookie: APP_SHELL_COOKIE });
});

test("appShellHeaders bevarer ekstra headers uden at overskrive cookien", () => {
  assert.deepEqual(appShellHeaders({ accept: "text/html" }), {
    cookie: APP_SHELL_COOKIE,
    accept: "text/html",
  });
});

test("fetchAppShell sender cz_session-cookien med i det udgaaende kald", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("ok");
  };
  try {
    await fetchAppShell("https://cyclingzone.org/", { redirect: "follow" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://cyclingzone.org/");
  assert.equal(calls[0].init.redirect, "follow");
  assert.equal(calls[0].init.headers.cookie, APP_SHELL_COOKIE);
});
