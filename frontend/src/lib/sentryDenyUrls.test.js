import { test } from "node:test";
import assert from "node:assert/strict";
import { DENY_URLS, isDeniedUrl } from "./sentryDenyUrls.js";

// #2018: Vercel Live Feedback / Toolbar injicerer /_next-live/feedback/instrument.js
// og kaster tredjeparts-fejl (CYCLINGZONE-18/19/1A/1B/1C). Disse SKAL filtreres,
// men filteret maa ikke vaere saa bredt at aegte app-fejl ryger med.

test("Vercel-toolbar-URL'er filtreres (dropper toolbar-stoej)", () => {
  const toolbarUrls = [
    // De faktiske stacktrace-URL'er fra CYCLINGZONE-18/19/1A/1B/1C.
    "https://cyclingzone.org/_next-live/feedback/instrument.js",
    "https://cycling-zone.vercel.app/_next-live/feedback/instrument.js",
    "https://some-preview-abc123.vercel.app/_next-live/feedback/instrument.js?v=2",
    // Sourcemapped/minificeret variant med line:col-suffix.
    "https://cyclingzone.org/_next-live/feedback/instrument.js:1:4200",
  ];
  for (const url of toolbarUrls) {
    assert.equal(isDeniedUrl(url), true, `toolbar-URL burde filtreres: ${url}`);
  }
});

test("browser-extension-URL'er filtreres fortsat (#1792 — ingen regression)", () => {
  assert.equal(isDeniedUrl("chrome-extension://abcdef/inpage.js"), true);
  assert.equal(isDeniedUrl("moz-extension://abcdef/inpage.js"), true);
  assert.equal(isDeniedUrl("safari-extension://abcdef/inpage.js"), true);
  assert.equal(isDeniedUrl("safari-web-extension://abcdef/inpage.js"), true);
});

test("normale app-fejl filtreres IKKE (filteret er ikke for bredt)", () => {
  const appUrls = [
    // Vores egne bundlede app-chunks.
    "https://cyclingzone.org/assets/index-a1b2c3.js",
    "https://cyclingzone.org/assets/RaceHubPage-d4e5f6.js",
    "https://cyclingzone.org/",
    // En app-fil der TILFAELDIGVIS hedder "instrument" men IKKE ligger under
    // /_next-live/feedback/ — maa ikke rammes af det snaevre anker.
    "https://cyclingzone.org/assets/instrument-xyz.js",
    // "feedback" i vores egen app (fx en feedback-side/-komponent) uden
    // _next-live-praefikset — maa ikke rammes.
    "https://cyclingzone.org/feedback/instrument-panel.js",
    "https://cyclingzone.org/assets/UserFeedbackForm-9f8e7d.js",
  ];
  for (const url of appUrls) {
    assert.equal(isDeniedUrl(url), false, `app-URL burde IKKE filtreres: ${url}`);
  }
});

test("isDeniedUrl haandterer tom/undefined URL uden at kaste", () => {
  assert.equal(isDeniedUrl(undefined), false);
  assert.equal(isDeniedUrl(null), false);
  assert.equal(isDeniedUrl(""), false);
});

test("toolbar-moensteret er tilfoejet til DENY_URLS-arrayet (bruges af Sentry.init)", () => {
  const hasToolbarPattern = DENY_URLS.some((re) =>
    re.test("https://cyclingzone.org/_next-live/feedback/instrument.js")
  );
  assert.equal(hasToolbarPattern, true, "DENY_URLS skal indeholde toolbar-moensteret");
});
