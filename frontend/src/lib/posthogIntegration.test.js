// #4321 — PostHog (EU) bag analytics-samtykke.
//
// To slags dækning i én fil:
//   1. Runtime: posthogClient.js kan importeres direkte (rene afhængigheder,
//      import.meta.env optional-chained), så vi kan bevise at intet starter og
//      intet kaster uden for PROD/uden samtykke.
//   2. Kilde-vagt: consent-gaten, init-konfigurationen og reverse-proxy-
//      rewritene kan ikke aflæses runtime i node --test (JSX + Vercel-config),
//      så de vagtes på kildeteksten. Samme mønster som
//      App.analyticsBoundary.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  POSTHOG_ENABLED,
  isPosthogStarted,
  startPosthog,
  capturePosthogEvent,
  capturePosthogPageview,
  identifyPosthog,
  resetPosthog,
} from "./posthogClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(__dirname, "posthogClient.js"), "utf8");
const integrationSource = readFileSync(join(__dirname, "posthogIntegration.jsx"), "utf8");
const vercelConfig = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf8"),
);

test("PostHog er slået fra uden PROD (og dermed i test/dev)", () => {
  assert.equal(POSTHOG_ENABLED, false);
});

test("startPosthog() starter ikke SDK'et når integrationen er slået fra", async () => {
  await startPosthog();
  assert.equal(isPosthogStarted(), false, "PostHog må aldrig starte uden PROD + samtykke");
});

test("capture/identify/reset er tavse no-ops før SDK'et er startet", async () => {
  // Spejlingen fra logEvent.js må aldrig kaste eller blokere — player_events
  // i Postgres er sandheden og skal skrives uanset PostHogs tilstand.
  assert.doesNotThrow(() => capturePosthogEvent("auction_bid_placed", { amount: 1 }));
  await assert.doesNotReject(() => capturePosthogPageview());
  await assert.doesNotReject(() => identifyPosthog("00000000-0000-0000-0000-000000000000"));
  await assert.doesNotReject(() => resetPosthog());
  assert.equal(isPosthogStarted(), false);
});

test("posthogIntegration.jsx starter kun PostHog bag analytics-samtykke", () => {
  assert.match(
    integrationSource,
    /hasConsent\("analytics"\)/,
    "integrationen skal læse analytics-kategorien fra ConsentProvider",
  );
  const startIndex = integrationSource.indexOf("startPosthog()");
  assert.ok(startIndex !== -1, "integrationen skal kalde startPosthog()");
  // Alt før kaldet i samme effekt skal indeholde den negative consent-guard,
  // så en fremtidig refaktor ikke kan flytte starten uden om samtykket.
  const beforeStart = integrationSource.slice(0, startIndex);
  assert.match(
    beforeStart,
    /if \(!analyticsOn\) \{/,
    "startPosthog() må kun nås efter en eksplicit !analyticsOn-guard",
  );
});

test("init-konfigurationen holder de besluttede grænser (#4321)", () => {
  assert.match(clientSource, /api_host: API_HOST/);
  assert.match(clientSource, /const API_HOST = "\/ingest"/, "reverse proxy, ikke eu.i.posthog.com direkte");
  assert.match(clientSource, /const UI_HOST = "https:\/\/eu\.posthog\.com"/, "EU-hosting");
  assert.match(clientSource, /autocapture: false/, "vi spejler egne events, ikke DOM-klik");
  assert.match(clientSource, /disable_session_recording: true/, "Clarity ejer replay indtil evalueringen");
  assert.match(clientSource, /person_profiles: "identified_only"/);
  assert.match(clientSource, /capture_pageview: false/, "SPA: $pageview fyres manuelt pr. route");
  assert.match(clientSource, /import\("posthog-js"\)/, "SDK'et skal lazy-loades, ikke ligge i main bundle");
});

test("identify sender kun UUID'et videre, aldrig e-mail eller navn (#2041)", () => {
  const identifyBlock = clientSource.slice(clientSource.indexOf("export async function identifyPosthog"));
  assert.doesNotMatch(
    identifyBlock.slice(0, identifyBlock.indexOf("}\n\n")),
    /email|name|username/i,
    "identify må kun få den interne UUID",
  );
});

// PostHog's egen anvisning for Vercel (posthog.com/docs/advanced/proxy/vercel)
// er tre rewrites: /static og /array til eu-assets.i.posthog.com, resten til
// eu.i.posthog.com. De SKAL ligge før SPA-fallbacken, ellers sluger app.html
// dem, og adblocker-omgåelsen falder på gulvet uden at nogen opdager det.
test("vercel.json: /ingest-rewritene peger på EU og ligger før SPA-fallbacken", () => {
  const sources = vercelConfig.rewrites.map((r) => r.source);
  const fallbackIndex = vercelConfig.rewrites.findIndex((r) => r.destination === "/app.html");
  const staticIndex = sources.indexOf("/ingest/static/:path(.*)");
  const arrayIndex = sources.indexOf("/ingest/array/:path(.*)");
  const catchAllIndex = sources.indexOf("/ingest/:path(.*)");

  assert.ok(staticIndex !== -1 && arrayIndex !== -1 && catchAllIndex !== -1, "alle tre /ingest-rewrites skal findes");
  assert.ok(fallbackIndex !== -1, "SPA-fallbacken skal findes");
  assert.ok(catchAllIndex < fallbackIndex, "/ingest må ikke ligge efter SPA-fallbacken");
  assert.ok(staticIndex < catchAllIndex && arrayIndex < catchAllIndex, "asset-rewritene skal ligge før catch-all'en");

  assert.equal(
    vercelConfig.rewrites[staticIndex].destination,
    "https://eu-assets.i.posthog.com/static/:path",
  );
  assert.equal(
    vercelConfig.rewrites[catchAllIndex].destination,
    "https://eu.i.posthog.com/:path",
  );
});

test("logEvent.js spejler til PostHog uden at røre Postgres-skrivningen", () => {
  const logEventSource = readFileSync(join(__dirname, "logEvent.js"), "utf8");
  assert.match(logEventSource, /import \{ capturePosthogEvent \} from "\.\/posthogClient\.js"/);
  const inserts = logEventSource.match(/supabase\.from\("player_events"\)\.insert\(/g) || [];
  assert.equal(inserts.length, 3, "de tre player_events-inserts skal stå uændrede tilbage");
  const mirrors = logEventSource.match(/mirrorToPosthog\(/g) || [];
  // 1 definition + 3 kaldsteder (logEvent, logFirstEvent, flushPendingSignup).
  assert.equal(mirrors.length, 4, "hvert player_event skal spejles præcis ét sted");
});
