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

// Der må ALDRIG ligge en project-token i repoet: gitleaks i CI og repoets
// secret-sanitize-hook bider begge på mønstret, og en hardcodet nøgle blokerer
// enhver PR. Token-præfikset stykkes sammen her, netop så denne vagt ikke selv
// bliver det fund den skal forhindre.
const TOKEN_PATTERN = new RegExp(`ph${"c"}_[A-Za-z0-9]`);

test("ingen fallback-token i koden — nøglen kommer kun fra env", () => {
  assert.doesNotMatch(clientSource, TOKEN_PATTERN, "hardcodet PostHog-token i posthogClient.js");
  assert.doesNotMatch(clientSource, /FALLBACK_KEY/, "ingen fallback-konstant må genindføres");
  assert.match(
    clientSource,
    /const PROJECT_KEY = import\.meta\.env\?\.VITE_POSTHOG_KEY;/,
    "nøglen læses udelukkende fra VITE_POSTHOG_KEY, uden ||-fallback",
  );
  assert.match(
    clientSource,
    /export const POSTHOG_ENABLED = Boolean\(import\.meta\.env\?\.PROD\) && Boolean\(PROJECT_KEY\);/,
    "integrationen skal kræve både PROD og en env-nøgle",
  );
});

test("uden VITE_POSTHOG_KEY er integrationen en tavs no-op", async () => {
  // node --test kører uden Vite, så import.meta.env er undefined: præcis samme
  // tilstand som et deploy hvor nøglen mangler. Intet må starte, intet kaste.
  assert.equal(POSTHOG_ENABLED, false, "ingen env-nøgle ⇒ slået fra");
  await startPosthog();
  assert.equal(isPosthogStarted(), false, "SDK'et må ikke starte uden nøgle");
  assert.doesNotThrow(() => capturePosthogEvent("auction_bid_placed", { amount: 1 }));
});

test("startPosthog() starter ikke SDK'et når integrationen er slået fra", async () => {
  await startPosthog();
  assert.equal(isPosthogStarted(), false, "PostHog må aldrig starte uden PROD + samtykke");
});

test("capture/identify/reset er tavse no-ops før SDK'et er startet", async () => {
  // Spejlingen fra logEvent.js må aldrig kaste eller blokere — player_events
  // i Postgres er sandheden og skal skrives uanset PostHogs tilstand.
  // Alle fire er synkrone efter #5055 (lite holder én klient-instans i
  // modul-scope frem for en async SDK-reference), så de vagtes med doesNotThrow.
  assert.doesNotThrow(() => capturePosthogEvent("auction_bid_placed", { amount: 1 }));
  assert.doesNotThrow(() => capturePosthogPageview());
  assert.doesNotThrow(() => identifyPosthog("00000000-0000-0000-0000-000000000000"));
  assert.doesNotThrow(() => resetPosthog());
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

test("init-konfigurationen holder de besluttede grænser (#4321, #5055)", () => {
  assert.match(clientSource, /host: API_HOST/);
  assert.match(clientSource, /const API_HOST = "\/ingest"/, "reverse proxy, ikke eu.i.posthog.com direkte");
  assert.match(clientSource, /autocapture: false/, "vi spejler egne events, ikke DOM-klik");
  assert.match(clientSource, /personProfiles: "identified_only"/);
  assert.match(
    clientSource,
    /captureHistoryEvents: false/,
    "SPA: $pageview fyres manuelt pr. route, ikke via en history-patch",
  );
  assert.match(
    clientSource,
    /import\("posthog-js-lite"\)/,
    "SDK'et skal lazy-loades, ikke ligge i main bundle",
  );
  // #5055: posthog-js' 88,7 KB bar autocapture, session replay, surveys,
  // toolbar og exception-capture — alt sammen slået fra hos os. Vagten holder
  // den tunge pakke ude, så et fremtidigt "bare lige" ikke trækker den ind igen.
  assert.doesNotMatch(
    clientSource,
    /"posthog-js"|'posthog-js'/,
    "posthog-js må ikke genindføres — lite dækker init/capture/identify/reset/opt-out",
  );
});

test("lite-specifikke valg: ingen tabte events, ingen ekstra rundture (#5055)", () => {
  // Lite har INGEN pagehide/sendBeacon-flush. Med default-batchen (20 events /
  // 10 s) ville $pageview fra en besøgende der forlader siden hurtigt gå tabt —
  // netop bounce-tilfældet. flushAt: 1 sender hvert event med det samme.
  assert.match(clientSource, /flushAt: 1/, "hvert event skal sendes med det samme");
  assert.match(clientSource, /preloadFeatureFlags: false/, "vi bruger ingen feature flags");
  assert.match(clientSource, /disableSurveys: true/, "vi bruger ingen surveys");
  // posthog-js hængte selv kampagne-parametre på hvert event; lite gør ikke.
  assert.match(clientSource, /utm_source/, "kampagne-parametre skal stadig med på events");
  assert.match(clientSource, /gclid/, "klik-id'er skal stadig med på events");
});

test("genoptaget samtykke ophæver et persisteret opt-out (#5055)", () => {
  // @posthog/core læser `getPersistedProperty(OptedOut) ?? !defaultOptIn`, så et
  // opt-out i localStorage OVERSKRIVER defaultOptIn og overlever sessionen. Uden
  // et modsvarende optIn() ville en besøgende der engang trak sit samtykke
  // tilbage forblive tavs for evigt — uden en eneste log-linje.
  const startBlock = clientSource.slice(clientSource.indexOf("export async function startPosthog"));
  assert.match(
    startBlock,
    /optIn\(\);/,
    "startPosthog() skal ophæve et persisteret opt-out, ellers er genoptaget samtykke en stille no-op",
  );
  // Begge veje: en helt ny klient OG en der allerede kører (samtykke trukket
  // tilbage og givet igen i samme session, hvor startPosthog() returnerer tidligt).
  assert.equal(
    (startBlock.match(/optIn\(\);/g) || []).length,
    2,
    "både den tidlige retur for en kørende klient og den nye klient skal kalde optIn()",
  );
});

test("identify sender kun UUID'et videre, aldrig e-mail eller navn (#2041)", () => {
  const identifyBlock = clientSource.slice(clientSource.indexOf("export function identifyPosthog"));
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
