import assert from "node:assert/strict";
import test from "node:test";
import { ONLINE_WINDOW_MS, isOnlineSince, onlineCutoffIso } from "./presenceWindow.js";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");

test("online window is 30 minutes", () => {
  assert.equal(ONLINE_WINDOW_MS, 30 * 60 * 1000);
});

test("isOnlineSince: inside and outside the window", () => {
  assert.equal(isOnlineSince(new Date(NOW - 29 * 60 * 1000).toISOString(), NOW), true);
  assert.equal(isOnlineSince(new Date(NOW - 10 * 60 * 1000).toISOString(), NOW), true);
  assert.equal(isOnlineSince(new Date(NOW - 31 * 60 * 1000).toISOString(), NOW), false);
  assert.equal(isOnlineSince(new Date(NOW - ONLINE_WINDOW_MS).toISOString(), NOW), false);
});

test("isOnlineSince: missing or invalid timestamps are offline", () => {
  assert.equal(isOnlineSince(null, NOW), false);
  assert.equal(isOnlineSince(undefined, NOW), false);
  assert.equal(isOnlineSince("not-a-date", NOW), false);
});

test("onlineCutoffIso is now minus the window", () => {
  assert.equal(onlineCutoffIso(NOW), new Date(NOW - ONLINE_WINDOW_MS).toISOString());
});
