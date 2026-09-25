import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirstTouchRecord, captureFirstTouch, getAttribution } from "./attribution.js";

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

// #5310: marketing-forsiden ligger på samme origin som SPA'en. Et klik derfra
// giver en same-origin referrer, som aldrig må gemmes som kanal.
const ORIGIN = "https://cyclingzone.org";

test("same-origin referrer med UTM i query: UTM udledes derfra, referrer gemmes ikke (#5310)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?mode=signup",
    referrer: "https://cyclingzone.org/?utm_source=reddit&utm_medium=paid&utm_campaign=s4-ads-test",
    path: "/login",
    origin: ORIGIN,
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.utm_source, "reddit");
  assert.equal(a.utm_medium, "paid");
  assert.equal(a.utm_campaign, "s4-ads-test");
  assert.equal(a.utm_term, null);
  assert.equal(a.referrer, null);
  assert.equal(a.landing_path, "/login");
});

test("same-origin referrer uden UTM gemmes ikke som kanal (#5310)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?mode=signup",
    referrer: "https://cyclingzone.org/da",
    path: "/login",
    origin: ORIGIN,
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.utm_source, null);
  assert.equal(a.referrer, null);
});

test("UTM på den aktuelle URL vinder over UTM i en same-origin referrer (#5310)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?mode=signup&utm_source=discord&utm_medium=community",
    referrer: "https://cyclingzone.org/?utm_source=reddit&utm_medium=paid",
    path: "/login",
    origin: ORIGIN,
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.utm_source, "discord");
  assert.equal(a.utm_medium, "community");
  assert.equal(a.referrer, null);
});

test("ekstern referrer bevares, og dens query giver ikke UTM (#5310)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "",
    referrer: "https://www.google.com/search?utm_source=spoof",
    path: "/",
    origin: ORIGIN,
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.referrer, "https://www.google.com/search?utm_source=spoof");
  assert.equal(a.utm_source, null);
});

test("buildFirstTouchRecord holder feltrækkefølge og beskærer lange værdier", () => {
  const record = buildFirstTouchRecord({
    search: `?utm_source=${"x".repeat(300)}`,
    referrer: `https://example.com/${"y".repeat(600)}`,
    path: "/",
    origin: ORIGIN,
    firstSeenAt: "t1",
  });
  assert.deepEqual(Object.keys(record), [
    "first_seen_at", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "ttclid", "msclkid", "source_hint", "referrer", "landing_path",
  ]);
  assert.equal(record.utm_source.length, 200);
  assert.equal(record.referrer.length, 500);
});

// #5304: click-ids (fbclid/gclid/ttclid/msclkid) fanges i samme first-touch-
// lagring som utm_*, med samme afkortning og samme "første besøg vinder"-regel.
test("fbclid uden utm fanges og kilden markeres som paid-candidate (#5304)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?fbclid=abc123xyz",
    referrer: "",
    path: "/",
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.fbclid, "abc123xyz");
  assert.equal(a.gclid, null);
  assert.equal(a.utm_source, null);
  assert.equal(a.source_hint, "paid-candidate");
});

test("utm + gclid fanges begge, kilden markeres IKKE som paid-candidate naar utm_source findes (#5304)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?utm_source=google&utm_medium=cpc&gclid=xyz789",
    referrer: "",
    path: "/",
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.utm_source, "google");
  assert.equal(a.gclid, "xyz789");
  assert.equal(a.source_hint, null);
});

test("ingen click-id: felterne er null og eksisterende utm-adfaerd er uaendret (#5304)", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?utm_source=reddit&utm_medium=social",
    referrer: "",
    path: "/",
    storage: s,
    now: () => "t1",
  });
  const a = getAttribution(s);
  assert.equal(a.utm_source, "reddit");
  assert.equal(a.fbclid, null);
  assert.equal(a.gclid, null);
  assert.equal(a.ttclid, null);
  assert.equal(a.msclkid, null);
  assert.equal(a.source_hint, null);
});

test("click-id alene beskaeres til 200 tegn ligesom utm-vaerdier (#5304)", () => {
  const record = buildFirstTouchRecord({
    search: `?gclid=${"g".repeat(300)}`,
    referrer: "",
    path: "/",
    origin: ORIGIN,
    firstSeenAt: "t1",
  });
  assert.equal(record.gclid.length, 200);
});

test("click-id recovers fra same-origin referrer naar det mangler paa den aktuelle URL (#5304)", () => {
  const record = buildFirstTouchRecord({
    search: "?mode=signup",
    referrer: "https://cyclingzone.org/?fbclid=recovered123",
    path: "/login",
    origin: ORIGIN,
    firstSeenAt: "t1",
  });
  assert.equal(record.fbclid, "recovered123");
  assert.equal(record.referrer, null);
  assert.equal(record.source_hint, "paid-candidate");
});

test("getAttribution returnerer null uden data og ved korrupt JSON", () => {
  const empty = fakeStorage();
  assert.equal(getAttribution(empty), null);
  const corrupt = fakeStorage();
  corrupt.setItem("cz_attribution_v1", "{not json");
  assert.equal(getAttribution(corrupt), null);
});
