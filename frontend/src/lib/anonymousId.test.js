import { test } from "node:test";
import assert from "node:assert/strict";
import { getAnonymousId } from "./anonymousId.js";

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test("getAnonymousId mints and persists an id on first call", () => {
  const s = fakeStorage();
  const id = getAnonymousId(s);
  assert.ok(typeof id === "string" && id.length > 0, "returns a non-empty string");
  assert.equal(s.getItem("cz_clarity_aid_v1"), id, "persists the id to storage");
});

test("getAnonymousId is stable across calls (returning user recognised)", () => {
  const s = fakeStorage();
  const first = getAnonymousId(s);
  const second = getAnonymousId(s);
  assert.equal(first, second, "same id returned on subsequent calls");
});

test("getAnonymousId reuses an already-stored id", () => {
  const s = fakeStorage();
  s.setItem("cz_clarity_aid_v1", "preexisting-id");
  assert.equal(getAnonymousId(s), "preexisting-id");
});

test("getAnonymousId falls back gracefully when storage throws", () => {
  const throwingStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  const id = getAnonymousId(throwingStorage);
  assert.ok(typeof id === "string" && id.length > 0, "still returns an id in private mode");
});
