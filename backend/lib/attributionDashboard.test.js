import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateAttribution, referrerHost } from "./attributionDashboard.js";

test("aggregateAttribution tæller pr. source/medium/referrer, nyeste-uafhængigt", () => {
  const agg = aggregateAttribution([
    { utm_source: "reddit", utm_medium: "social", referrer: "https://reddit.com/r/x" },
    { utm_source: "reddit", utm_medium: "social", referrer: "https://reddit.com/r/y" },
    { utm_source: "newsletter", utm_medium: "email", referrer: null },
  ]);
  assert.equal(agg.total, 3);
  assert.deepEqual(agg.by_source, [
    { key: "reddit", count: 2 },
    { key: "newsletter", count: 1 },
  ]);
  assert.deepEqual(agg.by_medium, [
    { key: "social", count: 2 },
    { key: "email", count: 1 },
  ]);
  // De to reddit-referrers kollapser til hosten reddit.com.
  assert.deepEqual(agg.by_referrer, [
    { key: "reddit.com", count: 2 },
    { key: "(direct)", count: 1 },
  ]);
});

test("aggregateAttribution mapper manglende source/medium/referrer til direct/none", () => {
  const agg = aggregateAttribution([
    { utm_source: null, utm_medium: null, referrer: null },
    { utm_source: "  ", utm_medium: "", referrer: "   " },
  ]);
  assert.deepEqual(agg.by_source, [{ key: "(direct)", count: 2 }]);
  assert.deepEqual(agg.by_medium, [{ key: "(none)", count: 2 }]);
  assert.deepEqual(agg.by_referrer, [{ key: "(direct)", count: 2 }]);
});

test("aggregateAttribution er robust over for tom/ugyldig input", () => {
  assert.deepEqual(aggregateAttribution([]), {
    total: 0, by_source: [], by_medium: [], by_referrer: [],
  });
  assert.equal(aggregateAttribution(null).total, 0);
  assert.equal(aggregateAttribution(undefined).total, 0);
});

test("aggregateAttribution tie-break er deterministisk (count desc, så key asc)", () => {
  const agg = aggregateAttribution([
    { utm_source: "b" }, { utm_source: "a" }, { utm_source: "c" },
  ]);
  assert.deepEqual(agg.by_source, [
    { key: "a", count: 1 },
    { key: "b", count: 1 },
    { key: "c", count: 1 },
  ]);
});

test("referrerHost trækker host ud og falder tilbage på rå/direct", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=cycling"), "www.google.com");
  assert.equal(referrerHost("ikke-en-url"), "ikke-en-url");
  assert.equal(referrerHost(null), "(direct)");
  assert.equal(referrerHost("   "), "(direct)");
});
