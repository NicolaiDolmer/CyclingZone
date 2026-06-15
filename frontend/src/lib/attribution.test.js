import { test } from "node:test";
import assert from "node:assert/strict";
import { captureFirstTouch, getAttribution } from "./attribution.js";

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test("captureFirstTouch gemmer UTM + referrer + landing ved første besøg", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?utm_source=reddit&utm_medium=social&utm_campaign=launch",
    referrer: "https://www.reddit.com/r/cycling",
    path: "/login",
    storage: s,
    now: () => "2026-06-15T10:00:00.000Z",
  });
  const a = getAttribution(s);
  assert.equal(a.utm_source, "reddit");
  assert.equal(a.utm_medium, "social");
  assert.equal(a.utm_campaign, "launch");
  assert.equal(a.referrer, "https://www.reddit.com/r/cycling");
  assert.equal(a.landing_path, "/login");
  assert.equal(a.first_seen_at, "2026-06-15T10:00:00.000Z");
});

test("captureFirstTouch overskriver ikke en eksisterende first-touch", () => {
  const s = fakeStorage();
  captureFirstTouch({ search: "?utm_source=first", referrer: "", path: "/", storage: s, now: () => "t1" });
  captureFirstTouch({ search: "?utm_source=second", referrer: "", path: "/", storage: s, now: () => "t2" });
  assert.equal(getAttribution(s).utm_source, "first");
});

test("captureFirstTouch håndterer direct-trafik (ingen utm/referrer)", () => {
  const s = fakeStorage();
  captureFirstTouch({ search: "", referrer: "", path: "/", storage: s, now: () => "t1" });
  const a = getAttribution(s);
  assert.equal(a.utm_source, null);
  assert.equal(a.referrer, null);
  assert.equal(a.landing_path, "/");
});

test("getAttribution returnerer null uden data og ved korrupt JSON", () => {
  const empty = fakeStorage();
  assert.equal(getAttribution(empty), null);
  const corrupt = fakeStorage();
  corrupt.setItem("cz_attribution_v1", "{not json");
  assert.equal(getAttribution(corrupt), null);
});
