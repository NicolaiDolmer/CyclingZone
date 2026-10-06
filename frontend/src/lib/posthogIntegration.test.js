// #4321 — PostHog (EU), variant A (ejer 6/10): cookieløs før login,
// identify efter login, kører for alle undtagen dem der aktivt har afvist.
//
// Tre slags dækning i én fil:
//   1. Runtime: posthogClient.js kan importeres direkte (rene afhængigheder,
//      import.meta.env optional-chained), så vi kan bevise at intet starter og
//      intet kaster uden for PROD.
//   2. Runtime mod den ÆGTE posthog-js-lite-pakke: createPosthogClient() med
//      vores init-konfiguration må aldrig røre cookies, localStorage eller
//      sessionStorage, heller ikke ved identify/opt-out/opt-in/reset.
//   3. Kilde-vagt: gate-wiringen, init-konfigurationen og reverse-proxy-
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
  POSTHOG_OPTIONS,
  isPosthogStarted,
  isPosthogCapturing,
  isPosthogAllowed,
  resolveEffectiveConsent,
  createPosthogClient,
  startPosthog,
  capturePosthogEvent,
  capturePosthogPageview,
  identifyPosthog,
  resetPosthog,
  optOutPosthog,
} from "./posthogClient.js";
import { isTeamNewlyCreated, TEAM_CREATED_WINDOW_MS } from "./teamDrafted.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(__dirname, "posthogClient.js"), "utf8");
const integrationSource = readFileSync(join(__dirname, "posthogIntegration.jsx"), "utf8");
const logEventSource = readFileSync(join(__dirname, "logEvent.js"), "utf8");
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
  assert.equal(isPosthogCapturing(), false);
  assert.doesNotThrow(() => capturePosthogEvent("auction_bid_placed", { amount: 1 }));
});

test("capture/identify/reset/optOut er tavse no-ops før SDK'et er startet", () => {
  // Spejlingen fra logEvent.js må aldrig kaste eller blokere — player_events
  // i Postgres er sandheden og skal skrives uanset PostHogs tilstand.
  assert.doesNotThrow(() => capturePosthogEvent("auction_bid_placed", { amount: 1 }));
  assert.doesNotThrow(() => capturePosthogEvent("first_bid", {}, { userId: "u-1" }));
  assert.doesNotThrow(() => capturePosthogPageview());
  assert.doesNotThrow(() => identifyPosthog("00000000-0000-0000-0000-000000000000"));
  assert.doesNotThrow(() => resetPosthog());
  assert.doesNotThrow(() => optOutPosthog());
  assert.equal(isPosthogStarted(), false);
});

// --- Gate-matrix (ejer 6/10) --------------------------------------------------
// PostHog kører for alle UNDTAGEN dem der aktivt har afvist analytics.

const ACCEPTED = { version: 1, necessary: true, analytics: true, marketing: false, email_marketing: false, updated_at: "2026-10-01T10:00:00.000Z" };
const REJECTED = { version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: "2026-10-01T10:00:00.000Z" };
// Tilbagekaldt = accepteret først, senere slået fra: et nyere besvaret objekt.
const REVOKED = { ...ACCEPTED, analytics: false, updated_at: "2026-10-05T10:00:00.000Z" };

test("gate: ubesvaret banner ⇒ PostHog kører (cookieløst)", () => {
  assert.equal(isPosthogAllowed(null), true);
  assert.equal(isPosthogAllowed(undefined), true);
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(null, null)), true);
});

test("gate: aktivt afvist ⇒ PostHog kører IKKE", () => {
  assert.equal(isPosthogAllowed(REJECTED), false);
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(REJECTED, null)), false);
});

test("gate: accepteret ⇒ PostHog kører", () => {
  assert.equal(isPosthogAllowed(ACCEPTED), true);
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(ACCEPTED, null)), true);
});

test("gate: tilbagekaldt (accepteret → afvist) ⇒ PostHog kører IKKE", () => {
  assert.equal(isPosthogAllowed(REVOKED), false);
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(REVOKED, null)), false);
});

test("gate: besvaret objekt uden analytics: true tæller som afvisning (samme normalisering som consent.jsx)", () => {
  assert.equal(isPosthogAllowed({ necessary: true }), false);
  assert.equal(isPosthogAllowed({ analytics: "true" }), false);
});

test("gate: DB-samtykket vinder over det lokale (samme forrang som ConsentProvider)", () => {
  // Afvist på enhed A, første besøg på enhed B: lokalt ubesvaret, profilen
  // bærer afvisningen ⇒ ingen PostHog, og dermed ingen identify.
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(null, REJECTED)), false);
  // Lokalt accepteret, men DB siger afvist ⇒ DB vinder.
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(ACCEPTED, REJECTED)), false);
  // Lokalt afvist, DB accepteret (nyere valg på en anden enhed) ⇒ DB vinder.
  assert.equal(isPosthogAllowed(resolveEffectiveConsent(REJECTED, ACCEPTED)), true);
});

// --- Memory-persistence mod den ægte posthog-js-lite -------------------------

function makeSpyStorage(log, label) {
  const data = new Map();
  return {
    getItem(key) { log.push(`${label}.getItem`); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { log.push(`${label}.setItem:${key}`); data.set(key, String(value)); },
    removeItem(key) { log.push(`${label}.removeItem:${key}`); data.delete(key); },
    clear() { log.push(`${label}.clear`); data.clear(); },
    key() { return null; },
    get length() { return data.size; },
  };
}

// Et minimalt browser-miljø med spioner på al storage. Returnerer en
// restore-funktion, så globalThis efterlades som før.
function installFakeBrowser() {
  const writes = [];
  const sent = [];
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    fetch: globalThis.fetch,
  };
  const localStorage = makeSpyStorage(writes, "localStorage");
  const sessionStorage = makeSpyStorage(writes, "sessionStorage");
  const document = { referrer: "" };
  Object.defineProperty(document, "cookie", {
    get() { return ""; },
    set(value) { writes.push(`document.cookie=${value}`); },
    configurable: true,
  });
  const window = {
    localStorage,
    sessionStorage,
    document,
    navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0", vendor: "", language: "en" },
    location: { href: "https://cyclingzone.org/dashboard", host: "cyclingzone.org", pathname: "/dashboard", search: "" },
    screen: { height: 800, width: 1280 },
    devicePixelRatio: 1,
  };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.fetch = async (url, options) => {
    sent.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    return { status: 200, ok: true, text: async () => "{}", json: async () => ({}) };
  };
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
  return { writes, sent, restore };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const sentEventNames = (sent) =>
  sent.flatMap((req) => (req.body?.batch || []).map((ev) => ev.event));

test("init-konfigurationen er cookieløs: persistence 'memory'", () => {
  assert.equal(POSTHOG_OPTIONS.persistence, "memory");
  assert.match(clientSource, /persistence: "memory"/);
});

test("memory-persistence: SDK'et skriver ALDRIG cookies, localStorage eller sessionStorage", async () => {
  const env = installFakeBrowser();
  try {
    const { PostHog } = await import("posthog-js-lite");
    const client = createPosthogClient(PostHog, "test-project-key");

    client.capture("$pageview", {});
    client.identify("11111111-1111-1111-1111-111111111111");
    client.capture("first_bid", {});
    await Promise.resolve(client.optOut());
    client.capture("auction_bid_placed", { amount: 1 });
    await Promise.resolve(client.optIn());
    client.capture("auction_view", {});
    client.reset();
    client.capture("$pageview", {});
    await settle();

    assert.deepEqual(
      env.writes,
      [],
      "ingen cookie-, localStorage- eller sessionStorage-skrivning, heller ikke support-proben",
    );
    // Events gik stadig afsted gennem reverse proxyen (memory ≠ slukket).
    assert.ok(env.sent.length > 0, "events skal stadig sendes");
    assert.ok(env.sent.every((req) => req.url.startsWith("/ingest/")), "kun gennem /ingest");
    const names = sentEventNames(env.sent);
    assert.ok(names.includes("first_bid"), "events efter identify sendes");
    assert.ok(!names.includes("auction_bid_placed"), "opt-out stopper afsendelsen med det samme");
    assert.ok(names.includes("auction_view"), "opt-in genoptager afsendelsen");
  } finally {
    env.restore();
  }
});

test("memory-persistence: opt-out og anonym id lever kun i klient-instansen", async () => {
  const env = installFakeBrowser();
  try {
    const { PostHog } = await import("posthog-js-lite");
    const first = createPosthogClient(PostHog, "test-project-key");
    const firstAnonId = first.getAnonymousId();
    await Promise.resolve(first.optOut());
    assert.equal(first.optedOut, true);

    // En ny instans svarer til næste page load: intet er husket.
    const second = createPosthogClient(PostHog, "test-project-key");
    assert.equal(second.optedOut, false, "opt-out må ikke overleve page load (intet er persisteret)");
    assert.notEqual(second.getAnonymousId(), firstAnonId, "ny anonym id pr. page load");
    assert.deepEqual(env.writes, [], "hverken opt-out eller anonym id rammer browser-storage");
  } finally {
    env.restore();
  }
});

test("kontrol: uden MemoryOnlyPostHog prober lite localStorage selv ved persistence 'memory'", async () => {
  // Hvis denne fejler, har posthog-js-lite fjernet support-proben, og
  // getWindow()-omvejen i posthogClient.js (memoryOnlyClass) kan forenkles.
  const env = installFakeBrowser();
  try {
    const { PostHog } = await import("posthog-js-lite");
    new PostHog("test-project-key", { ...POSTHOG_OPTIONS });
    assert.ok(
      env.writes.some((w) => w.includes("__mplssupport__")),
      "lite's support-probe skriver til storage; derfor findes memoryOnlyClass",
    );
  } finally {
    env.restore();
  }
});

test("memoryOnlyClass: getWindow() er tom under konstruktionen og normal bagefter", () => {
  const block = clientSource.slice(clientSource.indexOf("function memoryOnlyClass"));
  assert.match(block, /return this\.czConstructed \? super\.getWindow\(\) : undefined;/);
  assert.match(clientSource, /const MemoryOnlyPostHog = memoryOnlyClass\(PostHog\);/);
  assert.match(
    clientSource.slice(clientSource.indexOf("export async function startPosthog")),
    /client = createPosthogClient\(PostHog, PROJECT_KEY\);/,
    "startPosthog() skal bygge klienten gennem createPosthogClient",
  );
});

// --- Gate-wiringen i posthogIntegration.jsx ----------------------------------

test("posthogIntegration.jsx: gaten er isPosthogAllowed, ikke analytics-ja", () => {
  assert.match(integrationSource, /isPosthogAllowed\(effectiveConsent\)/);
  assert.match(
    integrationSource,
    /resolveEffectiveConsent\(\s*hasResponded \? consent : null,\s*profile\?\.consent_preferences,?\s*\)/,
    "ubesvaret lokalt = null; DB-samtykket fra profilen skal med",
  );
  assert.doesNotMatch(
    integrationSource,
    /hasConsent\("analytics"\)/,
    "PostHog må ikke længere kræve et aktivt analytics-ja (ejer 6/10)",
  );
  const startIndex = integrationSource.indexOf("startPosthog()");
  assert.ok(startIndex !== -1, "integrationen skal kalde startPosthog()");
  const beforeStart = integrationSource.slice(0, startIndex);
  assert.match(
    beforeStart,
    /if \(!posthogOn\) \{[\s\S]*optOutPosthog\(\)/,
    "afvisning undervejs skal opte ud FØR nogen start-sti",
  );
});

test("posthogIntegration.jsx: identify venter på profilen og bruger kun UUID'et", () => {
  assert.match(integrationSource, /const profileReady = Boolean\(userId\) && !profileLoading;/);
  assert.match(integrationSource, /identifyPosthog\(userId\)/);
  assert.match(integrationSource, /resetPosthog\(\)/, "logout skal resette");
  assert.doesNotMatch(integrationSource, /identifyPosthog\([^)]*(email|name)/i);
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
  assert.equal(POSTHOG_OPTIONS.flushAt, 1, "hvert event skal sendes med det samme");
  assert.equal(POSTHOG_OPTIONS.preloadFeatureFlags, false, "vi bruger ingen feature flags");
  assert.equal(POSTHOG_OPTIONS.disableSurveys, true, "vi bruger ingen surveys");
  // posthog-js hængte selv kampagne-parametre på hvert event; lite gør ikke.
  assert.match(clientSource, /utm_source/, "kampagne-parametre skal stadig med på events");
  assert.match(clientSource, /gclid/, "klik-id'er skal stadig med på events");
});

test("genoptaget samtykke ophæver et opt-out i samme page load (#5055)", () => {
  const startBlock = clientSource.slice(clientSource.indexOf("export async function startPosthog"));
  // Begge veje: en helt ny klient OG en der allerede kører (afvist og givet
  // igen i samme page load, hvor startPosthog() returnerer tidligt).
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

// --- logEvent.js: to adskilte gates ------------------------------------------

test("logEvent.js spejler til PostHog uden at røre Postgres-skrivningen", () => {
  assert.match(logEventSource, /import \{ capturePosthogEvent, isPosthogCapturing \} from "\.\/posthogClient\.js"/);
  const inserts = logEventSource.match(/supabase\.from\("player_events"\)\.insert\(/g) || [];
  assert.equal(inserts.length, 3, "de tre player_events-inserts skal stå uændrede tilbage");
  const mirrors = logEventSource.match(/mirrorToPosthog\(/g) || [];
  // 1 definition + 3 kaldsteder (logEvent, logFirstEvent, flushPendingSignup).
  assert.equal(mirrors.length, 4, "hvert player_event skal spejles præcis ét sted");
});

test("logEvent.js: spejlingen følger PostHog-gaten, Postgres beholder samtykke-kravet", () => {
  for (const fn of ["async function _logEvent", "async function _logFirstEvent", "async function _flushPendingSignup"]) {
    const start = logEventSource.indexOf(fn);
    assert.ok(start !== -1, `${fn} skal findes`);
    const body = logEventSource.slice(start, logEventSource.indexOf("\n}\n", start));
    // Ingen tidlig retur på analytics-samtykket alene: så ville PostHog-spejlingen
    // stadig hænge på player_events-samtykket.
    assert.doesNotMatch(body, /if \(!hasAnalyticsConsent\(\)\) return;/, `${fn}: spejlingen må ikke kræve analytics-ja`);
    assert.match(body, /activeSinks\(\)/, `${fn}: skal læse begge gates`);
    // Postgres-skrivningen skal stadig være bag toPostgres.
    const insertIndex = body.indexOf('supabase.from("player_events").insert(');
    assert.ok(insertIndex !== -1);
    assert.match(body.slice(0, insertIndex), /if \(!toPostgres\) (return;|\{)/, `${fn}: insert kun med analytics-ja`);
  }
  assert.match(
    logEventSource,
    /function activeSinks\(\) \{\s*return \{ toPostgres: hasAnalyticsConsent\(\), toPosthog: isPosthogCapturing\(\) \};/,
  );
});

test("team_created: kun nye hold tæller, så eksisterende brugere ikke fyrer ved deploy", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(isTeamNewlyCreated("2026-10-06T11:59:00.000Z", now), true, "lige oprettet");
  assert.equal(isTeamNewlyCreated(new Date(now - TEAM_CREATED_WINDOW_MS + 1000).toISOString(), now), true);
  assert.equal(isTeamNewlyCreated(new Date(now - TEAM_CREATED_WINDOW_MS - day).toISOString(), now), false, "gammelt hold");
  assert.equal(isTeamNewlyCreated(null, now), false);
  assert.equal(isTeamNewlyCreated("ikke-en-dato", now), false);
  assert.equal(isTeamNewlyCreated(new Date(now + day).toISOString(), now), false, "fremtid = urimelig værdi");
});

test("kerne-rejsen: team_created og first_training er navngivne events (#4321)", () => {
  const match = logEventSource.match(/KNOWN_EVENTS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(match);
  const names = [...match[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  for (const name of ["signup", "team_created", "first_bid", "first_training"]) {
    assert.ok(names.includes(name), `${name} skal stå i KNOWN_EVENTS`);
  }
  assert.match(logEventSource, /logFirstEvent\("first_training", \{ via: name \}\)/);
  assert.match(logEventSource, /logFirstEvent\("team_created", \{\}\)/);
  // team_created kædes efter signup-flushen, så PostHog ser signup først.
  assert.match(logEventSource, /signupFlushInFlight\.then\(\(\) => logFirstEvent\("team_created"/);
});
