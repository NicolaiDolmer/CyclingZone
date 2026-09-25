// #5493: nøglen kommer KUN fra NEXT_PUBLIC_AHREFS_ANALYTICS_KEY — aldrig
// hardkodet — og et ubesat/tomt env skal give null, så komponenten bliver
// en no-op (dev/preview rammer aldrig Ahrefs).
import { test } from "node:test";
import assert from "node:assert/strict";

import { getAhrefsAnalyticsKey } from "./ahrefsAnalytics.ts";

test("intet env → null", () => {
  assert.equal(getAhrefsAnalyticsKey({}), null);
});

test("tom streng → null", () => {
  assert.equal(getAhrefsAnalyticsKey({ NEXT_PUBLIC_AHREFS_ANALYTICS_KEY: "" }), null);
});

test("kun whitespace → null", () => {
  assert.equal(getAhrefsAnalyticsKey({ NEXT_PUBLIC_AHREFS_ANALYTICS_KEY: "   " }), null);
});

test("sat nøgle → trimmet værdi", () => {
  assert.equal(getAhrefsAnalyticsKey({ NEXT_PUBLIC_AHREFS_ANALYTICS_KEY: "  abc123  " }), "abc123");
});
