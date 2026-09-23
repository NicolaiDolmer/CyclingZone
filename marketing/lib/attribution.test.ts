// Unit-test af marketing-sitets first-touch-capture og UTM-videreførsel (#5310).
// Kører i `npm test`/`npm run lint` (node --test, Node 24 native TS-stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTION_STORAGE_KEY, FIRST_TOUCH_SCRIPT, UTM_KEYS, captureFirstTouch, withUtm } from "./attribution.ts";
// Paritet: SPA'en læser rækken marketing skriver, så formatet skal være identisk.
import { buildFirstTouchRecord, UTM_KEYS as FRONTEND_UTM_KEYS } from "../../frontend/src/lib/attribution.js";

const ORIGIN = "https://cyclingzone.org";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
  };
}

function read(storage: ReturnType<typeof fakeStorage>) {
  const raw = storage.getItem(ATTRIBUTION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

test("forsiden gemmer UTM, ekstern referrer og landing_path ved første besøg", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "?utm_source=reddit&utm_medium=community&utm_campaign=procyclingmanager",
    referrer: "https://www.reddit.com/r/procyclingmanager/",
    path: "/",
    origin: ORIGIN,
    storage: s,
    now: () => "2026-09-23T10:00:00.000Z",
  });
  assert.deepEqual(read(s), {
    first_seen_at: "2026-09-23T10:00:00.000Z",
    utm_source: "reddit",
    utm_medium: "community",
    utm_campaign: "procyclingmanager",
    utm_term: null,
    utm_content: null,
    referrer: "https://www.reddit.com/r/procyclingmanager/",
    landing_path: "/",
  });
});

test("skriver KUN når nøglen mangler, første besøg vinder", () => {
  const s = fakeStorage();
  s.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ utm_source: "first" }));
  captureFirstTouch({ search: "?utm_source=second", referrer: "", path: "/", origin: ORIGIN, storage: s, now: () => "t" });
  assert.equal(read(s).utm_source, "first");
});

test("same-origin referrer gemmes aldrig som kanal, men dens UTM udledes", () => {
  const s = fakeStorage();
  captureFirstTouch({
    search: "",
    referrer: "https://cyclingzone.org/?utm_source=discord&utm_medium=community",
    path: "/how-it-works",
    origin: ORIGIN,
    storage: s,
    now: () => "t",
  });
  const a = read(s);
  assert.equal(a.referrer, null);
  assert.equal(a.utm_source, "discord");
  assert.equal(a.utm_medium, "community");
});

test("blokeret localStorage vælter aldrig siden", () => {
  const throwing = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.doesNotThrow(() => captureFirstTouch({ search: "", referrer: "", path: "/", origin: ORIGIN, storage: throwing, now: () => "t" }));
});

test("paritet med SPA'ens record-format (frontend/src/lib/attribution.js)", () => {
  assert.deepEqual([...UTM_KEYS], FRONTEND_UTM_KEYS);
  const cases = [
    { search: "?utm_source=x&utm_content=c", referrer: "https://news.ycombinator.com/", path: "/" },
    { search: "", referrer: "https://cyclingzone.org/da?utm_source=hattrick&utm_campaign=signature", path: "/da" },
    { search: "?utm_medium=paid", referrer: "https://cyclingzone.org/?utm_source=reddit", path: "/" },
    { search: "", referrer: "", path: "/pro-cycling-manager-alternative" },
    { search: `?utm_term=${"z".repeat(250)}`, referrer: `https://example.com/${"r".repeat(600)}`, path: "/" },
  ];
  for (const c of cases) {
    const s = fakeStorage();
    captureFirstTouch({ ...c, origin: ORIGIN, storage: s, now: () => "t" });
    assert.deepEqual(read(s), buildFirstTouchRecord({ ...c, origin: ORIGIN, firstSeenAt: "t" }), c.referrer);
  }
});

test("inline-scriptet er selvstændigt og læser browser-konteksten uden argumenter", () => {
  const s = fakeStorage();
  const fakeWindow = {
    localStorage: s,
    location: { search: "?utm_source=email&utm_medium=email&utm_campaign=day1", pathname: "/da", origin: ORIGIN },
  };
  const fakeDocument = { referrer: "android-app://com.google.android.gm/" };
  // Kun window/document/URLSearchParams/URL/JSON/Date er i scope, præcis som i browseren.
  new Function("window", "document", FIRST_TOUCH_SCRIPT)(fakeWindow, fakeDocument);
  const a = read(s);
  assert.equal(a.utm_source, "email");
  assert.equal(a.utm_campaign, "day1");
  assert.equal(a.referrer, "android-app://com.google.android.gm/");
  assert.equal(a.landing_path, "/da");
  assert.match(a.first_seen_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("withUtm fører kun de tilladte utm_* videre til app-linket", () => {
  const search = "?utm_source=reddit&utm_medium=paid&utm_campaign=s4-ads-test&fbclid=abc&ref=x";
  assert.equal(
    withUtm("https://cyclingzone.org/login?mode=signup", search),
    "https://cyclingzone.org/login?mode=signup&utm_source=reddit&utm_medium=paid&utm_campaign=s4-ads-test",
  );
  assert.equal(
    withUtm("https://cyclingzone.org/login", "?utm_source=discord"),
    "https://cyclingzone.org/login?utm_source=discord",
  );
});

test("withUtm lader linket være uændret uden UTM, og overskriver aldrig linkets egne", () => {
  assert.equal(withUtm("https://cyclingzone.org/login?mode=signup", ""), "https://cyclingzone.org/login?mode=signup");
  assert.equal(withUtm("https://cyclingzone.org/login?mode=signup", "?fbclid=abc"), "https://cyclingzone.org/login?mode=signup");
  assert.equal(
    withUtm("https://cyclingzone.org/login?utm_source=own", "?utm_source=reddit&utm_medium=paid"),
    "https://cyclingzone.org/login?utm_source=own&utm_medium=paid",
  );
  assert.equal(withUtm("/login", "?utm_source=reddit"), "/login");
});
