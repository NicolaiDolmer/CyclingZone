// #6584 · Badging API-wrapperen maa aldrig kaste og skal rydde ved 0.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBadgeCount, syncAppBadge } from "./appBadge.ts";

function fakeNav() {
  const calls: Array<[string, number | undefined]> = [];
  return {
    calls,
    setAppBadge: (n?: number) => {
      calls.push(["set", n]);
      return Promise.resolve();
    },
    clearAppBadge: () => {
      calls.push(["clear", undefined]);
      return Promise.resolve();
    },
  };
}

test("normalizes to a non-negative integer", () => {
  assert.equal(normalizeBadgeCount(3), 3);
  assert.equal(normalizeBadgeCount(2.9), 2);
  assert.equal(normalizeBadgeCount("4"), 4);
  assert.equal(normalizeBadgeCount(-1), 0);
  assert.equal(normalizeBadgeCount(Number.NaN), 0);
  assert.equal(normalizeBadgeCount(undefined), 0);
});

test("sets the badge for unread > 0 and clears it at 0", () => {
  const nav = fakeNav();
  assert.equal(syncAppBadge(5, nav), "set");
  assert.equal(syncAppBadge(0, nav), "cleared");
  assert.deepEqual(nav.calls, [["set", 5], ["clear", undefined]]);
});

test("unsupported browsers and throwing/rejecting APIs never throw", async () => {
  assert.equal(syncAppBadge(2, null), "unsupported");
  assert.equal(syncAppBadge(2, {}), "unsupported");
  const throwing = {
    setAppBadge: () => {
      throw new Error("not installed");
    },
    clearAppBadge: () => Promise.resolve(),
  };
  assert.equal(syncAppBadge(2, throwing), "unsupported");
  const rejecting = {
    setAppBadge: () => Promise.reject(new Error("NotAllowedError")),
    clearAppBadge: () => Promise.resolve(),
  };
  assert.equal(syncAppBadge(2, rejecting), "set");
  // Lad den afviste promise blive afviklet: en uhaandteret rejection ville fejle testen.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
