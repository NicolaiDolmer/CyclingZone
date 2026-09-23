// #4925 — hydrations-signalet der gater LanguageProvider's deferrede sprogskifte.
// Det rigtige React-forløb (skal committer før rute-boundary'en) dækkes af
// tests/e2e/landing-hydration.spec.js; her låses selve kontrakten.
import test from "node:test";
import assert from "node:assert/strict";
import {
  markPrerenderHydrated,
  resetPrerenderHydrationForTests,
  whenPrerenderHydrated,
} from "./prerenderHydration.ts";

test.beforeEach(() => resetPrerenderHydrationForTests());

test("en lytter fra før signalet kører først når boundary'en melder hydreret", () => {
  let calls = 0;
  whenPrerenderHydrated(() => {
    calls += 1;
  });
  assert.equal(calls, 0, "sprogskiftet må ikke ske før boundary'en er hydreret");

  markPrerenderHydrated();
  assert.equal(calls, 1);
});

test("en lytter der kommer efter signalet kører med det samme", () => {
  // Klient-render uden dehydreret boundary: markøren (barn) committer sin
  // effekt FØR LanguageProvider (forælder) når at abonnere.
  markPrerenderHydrated();
  let calls = 0;
  whenPrerenderHydrated(() => {
    calls += 1;
  });
  assert.equal(calls, 1);
});

test("en afmeldt lytter kører aldrig (effekt-cleanup, fx StrictMode)", () => {
  let calls = 0;
  const unsubscribe = whenPrerenderHydrated(() => {
    calls += 1;
  });
  unsubscribe();
  markPrerenderHydrated();
  assert.equal(calls, 0);
});

test("signalet er idempotent: en lytter kaldes højst én gang", () => {
  let calls = 0;
  whenPrerenderHydrated(() => {
    calls += 1;
  });
  markPrerenderHydrated();
  markPrerenderHydrated();
  assert.equal(calls, 1);
});
