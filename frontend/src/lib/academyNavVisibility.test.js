import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAcademyNavVisible,
  readCachedAcademyNav,
  writeCachedAcademyNav,
} from "./academyNavVisibility.js";

afterEach(() => { delete globalThis.localStorage; });

function stubStorage(initial = {}) {
  const store = { ...initial };
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  return store;
}

// ── resolveAcademyNavVisible: kun autoritative svar ændrer tilstanden ──────────
test("200 + enabled:true → synlig", () => {
  assert.equal(resolveAcademyNavVisible({ status: 200, enabled: true, lastKnown: false }), true);
});

test("200 + enabled:false → skjult (autoritativt slukket, overruler cache)", () => {
  assert.equal(resolveAcademyNavVisible({ status: 200, enabled: false, lastKnown: true }), false);
});

test("409 academy_disabled → skjult", () => {
  assert.equal(resolveAcademyNavVisible({ status: 409, lastKnown: true }), false);
});

test("401 (udløbet/fornyende session, #1792) → behold sidst kendte, fejl LUKKER ikke", () => {
  assert.equal(resolveAcademyNavVisible({ status: 401, lastKnown: true }), true);
  assert.equal(resolveAcademyNavVisible({ status: 401, lastKnown: false }), false);
});

test("500 → behold sidst kendte", () => {
  assert.equal(resolveAcademyNavVisible({ status: 500, lastKnown: true }), true);
});

test("netværksfejl (ingen status) → behold sidst kendte", () => {
  assert.equal(resolveAcademyNavVisible({ lastKnown: true }), true);
  assert.equal(resolveAcademyNavVisible({}), false);
});

// ── cache-helpers ──────────────────────────────────────────────────────────────
test("write + read round-trip", () => {
  stubStorage();
  writeCachedAcademyNav(true);
  assert.equal(readCachedAcademyNav(), true);
  writeCachedAcademyNav(false);
  assert.equal(readCachedAcademyNav(), false);
});

test("read uden storage → false (ingen crash i private mode)", () => {
  assert.equal(readCachedAcademyNav(), false);
});
