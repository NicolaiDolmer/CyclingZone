import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateAttribution, effectiveChannel, LOST_IN_MARKETING, referrerHost } from "./attributionDashboard.js";

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

// #5310: rækker siden 14/9 har vores egen marketing-forside som referrer og NULL
// utm_source. Læse-siden udleder UTM fra referrerens query, uden DB-skriv.
test("effectiveChannel udleder utm_* fra same-origin-referrer når utm_source er NULL (#5310)", () => {
  assert.deepEqual(
    effectiveChannel({ utm_source: null, utm_medium: null, referrer: "https://cyclingzone.org/?utm_source=reddit&utm_medium=paid" }),
    { source: "reddit", medium: "paid", referrer: LOST_IN_MARKETING },
  );
  assert.deepEqual(
    effectiveChannel({ utm_source: null, referrer: "https://www.cyclingzone.org/da?utm_source=discord" }),
    { source: "discord", medium: "(none)", referrer: LOST_IN_MARKETING },
  );
});

test("effectiveChannel: same-origin uden UTM er 'ukendt (tabt i marketing)', aldrig en kanal (#5310)", () => {
  for (const referrer of [
    "https://cyclingzone.org/",
    "https://cyclingzone.org/how-it-works",
    "https://cycling-zone.vercel.app/",
    "https://cycling-zone-marketing.vercel.app/",
  ]) {
    assert.deepEqual(effectiveChannel({ utm_source: null, referrer }), {
      source: LOST_IN_MARKETING, medium: "(none)", referrer: LOST_IN_MARKETING,
    });
  }
  assert.equal(LOST_IN_MARKETING, "ukendt (tabt i marketing)");
});

test("effectiveChannel: gemt utm_source vinder, og fremmede/lookalike-hosts er uberørte (#5310)", () => {
  assert.deepEqual(
    effectiveChannel({ utm_source: "email", utm_medium: "email", referrer: "https://cyclingzone.org/?utm_source=reddit" }),
    { source: "email", medium: "email", referrer: LOST_IN_MARKETING },
  );
  assert.deepEqual(
    effectiveChannel({ utm_source: null, referrer: "https://evil-cyclingzone.org/?utm_source=spoof" }),
    { source: "(direct)", medium: "(none)", referrer: "evil-cyclingzone.org" },
  );
  assert.deepEqual(
    effectiveChannel({ utm_source: null, referrer: "https://cyclingzone.org.example.com/" }),
    { source: "(direct)", medium: "(none)", referrer: "cyclingzone.org.example.com" },
  );
});

test("aggregateAttribution tæller med læse-side-fallbacken (#5310)", () => {
  const agg = aggregateAttribution([
    { utm_source: null, referrer: "https://cyclingzone.org/?utm_source=reddit&utm_medium=paid" },
    { utm_source: "reddit", utm_medium: "paid", referrer: "https://www.reddit.com/" },
    { utm_source: null, referrer: "https://cyclingzone.org/" },
  ]);
  assert.deepEqual(agg.by_source, [
    { key: "reddit", count: 2 },
    { key: LOST_IN_MARKETING, count: 1 },
  ]);
  assert.deepEqual(agg.by_medium, [
    { key: "paid", count: 2 },
    { key: "(none)", count: 1 },
  ]);
  assert.deepEqual(agg.by_referrer, [
    { key: LOST_IN_MARKETING, count: 2 },
    { key: "www.reddit.com", count: 1 },
  ]);
});

test("referrerHost trækker host ud og falder tilbage på rå/direct", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=cycling"), "www.google.com");
  assert.equal(referrerHost("ikke-en-url"), "ikke-en-url");
  assert.equal(referrerHost(null), "(direct)");
  assert.equal(referrerHost("   "), "(direct)");
});
