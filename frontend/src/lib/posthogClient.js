// PostHog (EU) client — #4321.
//
// Leaf-modul med selve SDK-håndteringen: lazy load, init, identify, capture.
// React-wiringen (consent-gate, route-skift, auth-skift) ligger i
// posthogIntegration.jsx. Opdelingen findes fordi logEvent.js skal kunne
// spejle sine events uden at importere en .jsx-fil.
//
// Designvalg (ejer-beslutning 27/8 + 8/9 + 6/10, se #4321 og
// docs/superpowers/specs/2026-10-06-ejer-beslutninger-stabilitet-10x.md #2+#3):
//   - Additivt lag. player_events og signup_attribution bliver i Postgres og
//     er fortsat sandheden; PostHog erstatter intet. GA4 og Clarity beholdes.
//   - COOKIELØS (6/10): persistence "memory". SDK'et skriver ALDRIG cookies,
//     localStorage eller sessionStorage, heller ikke lite's support-probe (se
//     MemoryOnlyPostHog nedenfor). Konsekvens: ny anonym id pr. page load;
//     identify() efter login binder en brugers sessioner sammen.
//   - Gate (6/10): kun i PROD, og for alle besøgende UNDTAGEN dem der aktivt
//     har afvist analytics. Ubesvaret banner = PostHog kører (cookieløst).
//     Selve beslutningen er isPosthogAllowed() nedenfor; wiringen er i
//     posthogIntegration.jsx. Intet nyt banner.
//   - Reverse proxy (/ingest) frem for eu.i.posthog.com direkte, så
//     adblockere ikke spiser en femtedel af trafikken. Se frontend/vercel.json.
//   - autocapture er SLÅET FRA: vi spejler vores egne, navngivne events
//     (KNOWN_EVENTS i logEvent.js) i stedet for en støjsky af DOM-klik.
//   - session recording er SLÅET FRA: session-optagelser bliver i Clarity
//     (ejer 6/10).
//   - identify() får KUN den interne UUID. Aldrig e-mail, navn eller holdnavn.
//
// SDK: posthog-js-lite (#5055). posthog-js vejede 88,7 KB gzip — den STØRSTE
// enkelt-chunk i hele buildet — og leverede autocapture, session replay,
// surveys, toolbar og exception-capture som alle er slået fra hos os. Vi bruger
// kun init/capture/identify/reset/opt-out, hvilket er præcis den flade
// posthog-js-lite (PostHogs egen officielle lette klient) dækker.
// Forskellene er dokumenteret i PR'en; de to der betyder noget er håndteret her:
//   - lite batcher som standard (flushAt 20 / 10 s) og har INGEN
//     pagehide/sendBeacon-flush. Et $pageview fra en besøgende der forlader
//     siden hurtigt ville gå tabt. Derfor flushAt: 1 — hvert event sendes med
//     det samme, samme adfærd som posthog-js.
//   - lite sender ikke kampagne-parametre (utm_*/gclid/…) automatisk. De
//     tilføjes her i CAMPAIGN_PARAMS-hjælperen, så PostHogs kanal- og
//     UTM-opdelinger stadig virker.

import { isLikelyAutomation, isPrerendering } from "./clarityBotSignals.js";

// import.meta.env optional-chained så modulet kan importeres i node --test,
// jf. konventionen i trafficBeacon.js / clarityIntegration.jsx.
//
// Nøglen kommer UDELUKKENDE fra env — der er bevidst ingen fallback-token i
// koden. PostHog's client-side "project API key" er per design offentlig (den
// ligger i enhver besøgendes bundle og kan kun skrive events, ikke læse data),
// men den holdes alligevel ude af repoet: gitleaks i CI og repoets
// secret-sanitize-hook bider begge på PostHog-token-mønstret, og en hardcodet
// nøgle ville blokere hver eneste PR. Den sættes som VITE_POSTHOG_KEY i Vercel
// (Production + Preview). Mangler den, er hele integrationen en tavs no-op —
// præcis som GA4 uden VITE_GA_MEASUREMENT_ID (gaIntegration.jsx).
const PROJECT_KEY = import.meta.env?.VITE_POSTHOG_KEY;

// Relativ sti = samme origin = ingen adblocker-liste rammer den. Rewrites i
// frontend/vercel.json sender /ingest videre til EU-cloud'en.
const API_HOST = "/ingest";

export const POSTHOG_ENABLED = Boolean(import.meta.env?.PROD) && Boolean(PROJECT_KEY);

// --- Gaten (ejer 6/10) ------------------------------------------------------
// PostHog kører for alle UNDTAGEN dem der aktivt har afvist analytics.
//
// `stored` er et BESVARET samtykke-objekt (form som cz_consent_v1 /
// users.consent_preferences) eller null/undefined når banneret er ubesvaret.
// consent.jsx normaliserer `analytics` til `raw.analytics === true`, så ethvert
// besvaret objekt uden analytics: true er en afvisning. Det samme gælder et
// tilbagekaldt samtykke (accepteret, senere slået fra): det er bare et nyere
// besvaret objekt med analytics: false.
export function isPosthogAllowed(stored) {
  if (!stored || typeof stored !== "object") return true;
  return stored.analytics === true;
}

// Hvilket samtykke der gælder for PostHog: det MEST restriktive af det lokale
// (cz_consent_v1) og DB-værdien (users.consent_preferences). En afvisning et
// hvilket som helst sted lukker gaten.
//   - "Afvist på enhed A, første besøg på enhed B": lokalt tomt, profilen bærer
//     afvisningen ⇒ lukket, og vi identify'er ikke den bruger.
//   - "Afviser nu i banneret": saveConsent() opdaterer det lokale med det samme,
//     men profilen først når DB-skrivningen er lykkedes. Lod vi DB-værdien vinde
//     (som ConsentProvider gør ved synk), ville PostHog køre videre i det vindue,
//     og i al evighed hvis skrivningen fejler.
// Omvendt (lokal afvisning, nyere accept i DB fra en anden enhed) er gaten
// lukket indtil ConsentProvider har synket DB-værdien ned lokalt. Det er den
// sikre retning at tage fejl i.
export function resolveEffectiveConsent(localConsent, remoteConsent) {
  const local = localConsent && typeof localConsent === "object" ? localConsent : null;
  const remote = remoteConsent && typeof remoteConsent === "object" ? remoteConsent : null;
  if (local && !isPosthogAllowed(local)) return local;
  if (remote && !isPosthogAllowed(remote)) return remote;
  return remote || local;
}

// Den ene klient-instans. Sat af startPosthog(), aldrig genskabt.
let client = null;
let posthogStarted = false;
// Sand efter optOutPosthog() indtil startPosthog() opter ind igen. Holdes her
// (ikke kun i SDK'et), så logEvent.js billigt kan spørge om spejlingen er aktiv
// uden at lave et identitets-opslag for ingenting.
let posthogOptedOut = false;
// Den UUID klienten er identify'et som i denne page load (null = anonym).
let identifiedUserId = null;
// Bruger-events (logEvent-spejlingen) der kom FØR identify. De bindes til den
// rigtige person ved at vente på identify i stedet for at gå afsted på den
// anonyme memory-id. Kun i hukommelsen; ryddes ved opt-out/reset.
const pendingUserEvents = [];
const MAX_PENDING_USER_EVENTS = 50;

// SDK'et dynamic-importeres så det ikke lander i main bundle (samme mønster
// som Clarity, #479).
function loadPosthog() {
  return import("posthog-js-lite").then((m) => m.PostHog || m.default);
}

export function isPosthogStarted() {
  return posthogStarted;
}

// Sand når et capture faktisk vil blive sendt: SDK'et kører og står ikke
// opted out. logEvent.js bruger den til at springe identitets-opslaget over
// når hverken Postgres eller PostHog skal have eventet.
export function isPosthogCapturing() {
  return posthogStarted && Boolean(client) && !posthogOptedOut;
}

// Kampagne-parametre. posthog-js læste dem selv af URL'en og hængte dem på hvert
// event; lite gør ikke, så listen er PostHogs egen (den delmængde der driver
// kanal- og UTM-opdelingerne i Web Analytics). Læses ved hvert capture, præcis
// som posthog-js gjorde — en SPA-navigation kan skifte query-strengen.
//
// BEMÆRK: person-egenskaberne $initial_utm_* (posthog-js' $set_once ved første
// besøg) er bevidst IKKE genskabt. Sandheden om signup-attribution er tabellen
// signup_attribution i Postgres (#4321); PostHog-kopien skal kunne opdele
// events på kampagne, ikke eje attributionen.
const CAMPAIGN_PARAMS = Object.freeze([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "gad_source", "fbclid", "msclkid", "ttclid", "twclid", "li_fat_id",
]);

function campaignProperties() {
  if (typeof window === "undefined" || !window.location?.search) return null;
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
  let found = null;
  for (const key of CAMPAIGN_PARAMS) {
    const value = params.get(key);
    if (value) {
      found = found || {};
      found[key] = value;
    }
  }
  return found;
}

// #5162 (K3): frontend-releasens indholds-id (<meta name="cz-frontend">) på
// hvert event. scripts/measure-client-release-age.mjs måler ud fra det hvor
// længe klienter kører en afløst release, og dermed hvilke gamle assets næste
// deploy skal bære videre. Læses én gang: id'et skifter aldrig i en page load.
let frontendIdCache;
function frontendIdProperty() {
  if (frontendIdCache === undefined) {
    frontendIdCache = "";
    try {
      frontendIdCache = document.querySelector('meta[name="cz-frontend"]')?.getAttribute("content")?.trim() || "";
    } catch { /* intet document (node --test) */ }
  }
  return frontendIdCache ? { cz_frontend: frontendIdCache } : null;
}

function capture(name, properties) {
  const campaign = campaignProperties();
  const release = frontendIdProperty();
  client.capture(name, campaign || release ? { ...(properties || {}), ...campaign, ...release } : (properties || {}));
}

// optIn()/optOut() er async i core'en, men laver kun en synkron
// persistence-skrivning (her: hukommelsen) bag en wrap(). Vi venter ikke på
// dem; vi sluger bare afvisningen, så samtykke-flowet aldrig kan give en
// unhandled rejection.
function optIn() {
  if (!client) return;
  posthogOptedOut = false;
  try {
    Promise.resolve(client.optIn()).catch(() => {});
  } catch { /* best-effort */ }
}

function shouldSkipForAutomation() {
  return typeof navigator !== "undefined" && isLikelyAutomation(navigator);
}

// lite's konstruktør kalder getStorage(persistence, this.getWindow()). Med et
// window-objekt PROBER den localStorage og sessionStorage (skriver og sletter
// nøglen "__mplssupport__") FØR den kigger på persistence-typen, også ved
// "memory". Det er en storage-skrivning, selv om den er kortvarig og uden
// identifikator. Ved at returnere undefined fra getWindow() UNDER
// konstruktionen springer lite proben over og går direkte til
// createMemoryStorage(). Efter konstruktionen svarer getWindow() normalt, så
// $current_url, $browser, $screen_* osv. stadig kommer med på hvert event.
// Verificeret mod posthog-js-lite 4.12.1 (dist/index.mjs, getStorage og
// PostHog-konstruktøren); vagtet runtime i posthogIntegration.test.js.
function memoryOnlyClass(PostHog) {
  return class MemoryOnlyPostHog extends PostHog {
    constructor(apiKey, options) {
      super(apiKey, options);
      this.czConstructed = true;
    }

    getWindow() {
      return this.czConstructed ? super.getWindow() : undefined;
    }
  };
}

// Init-konfigurationen. Eksporteret så testen kan bygge en ægte lite-klient
// med PRÆCIS samme indstillinger og bevise at intet rammer browser-storage.
export const POSTHOG_OPTIONS = Object.freeze({
  // Relativ sti gennem vores egen reverse proxy. Core'en bruger host som
  // ren streng-præfiks (`${host}/batch/`), så en relativ sti virker og
  // resolves mod vores origin — det er hele pointen med /ingest.
  host: API_HOST,
  // Cookieløs (ejer 6/10): anonym id, distinct id, opt-out-status og
  // event-kø lever kun i hukommelsen og dør med fanen. Ingen cookies, ingen
  // localStorage, ingen sessionStorage.
  persistence: "memory",
  // Person-profiler kun for identificerede brugere: anonyme besøg tæller
  // stadig i web analytics, men bruger ikke person-kvote.
  personProfiles: "identified_only",
  // Send hvert event med det samme. Lite har ingen unload-flush, så en
  // default-batch (20 events / 10 s) ville tabe $pageview for enhver
  // besøgende der forlader siden hurtigt — altså netop bounce-tilfældet.
  flushAt: 1,
  // Vi spejler vores egne navngivne events; DOM-autocapture ville
  // fordoble støjen og gøre funnels sværere at læse.
  autocapture: false,
  // SPA: React Router skifter side uden page load. Vi fyrer $pageview selv
  // ved hvert route-skift (capturePosthogPageview) frem for at lade lite
  // patche history.pushState.
  captureHistoryEvents: false,
  // Vi bruger ingen feature flags eller surveys her. Uden de to flag ville
  // init koste en ekstra rundtur til /flags og /api/surveys.
  preloadFeatureFlags: false,
  disableSurveys: true,
  // Content-Encoding: gzip gennem Vercel-rewritet er ikke verificeret, og
  // payloaden er et enkelt event ad gangen — komprimeringen ville spare
  // nogle hundrede bytes mod en uverificeret proxy-antagelse.
  disableCompression: true,
});

// Bygger klienten. Adskilt fra startPosthog() så testen kan køre den mod den
// ægte posthog-js-lite-pakke uden PROD/env-nøgle.
export function createPosthogClient(PostHog, projectKey, overrides) {
  const MemoryOnlyPostHog = memoryOnlyClass(PostHog);
  return new MemoryOnlyPostHog(projectKey, { ...POSTHOG_OPTIONS, ...(overrides || {}) });
}

// Starter PostHog. Kaldes KUN når gaten tillader det (se
// posthogIntegration.jsx). Idempotent.
export async function startPosthog() {
  if (!POSTHOG_ENABLED) return;
  if (posthogStarted) {
    // Samtykke givet igen efter en afvisning i SAMME page load: klienten
    // kører allerede, men står opted out. Uden dette ville den tavst blive
    // ved med at kassere events.
    optIn();
    return;
  }
  if (shouldSkipForAutomation()) return;
  if (typeof document !== "undefined" && isPrerendering(document)) {
    // Speculation-Rules-prerender bliver måske aldrig aktiveret — udskyd init
    // til siden er et rigtigt besøg (samme guard som Clarity, #3819).
    document.addEventListener("prerenderingchange", () => { startPosthog(); }, { once: true });
    return;
  }
  try {
    const PostHog = await loadPosthog();
    if (posthogStarted) return; // re-entry guard
    client = createPosthogClient(PostHog, PROJECT_KEY);
    // Med memory-persistence starter hver page load uden persisteret opt-out,
    // så optIn() er strengt taget overflødigt her. Det står der stadig som
    // forsvar: skifter nogen persistence tilbage til localStorage, ville et
    // persisteret opt-out ellers overleve et senere samtykke i stilhed
    // (core læser `getPersistedProperty(OptedOut) ?? !defaultOptIn`).
    optIn();
    posthogStarted = true;
  } catch (err) {
    console.error("posthog init failed:", err);
  }
}

// Manuelt $pageview ved SPA-navigation (captureHistoryEvents: false ovenfor).
export function capturePosthogPageview() {
  if (!isPosthogCapturing()) return;
  try {
    capture("$pageview");
  } catch { /* best-effort — telemetri må aldrig bryde en navigation */ }
}

// Spejler et player_event til PostHog. Aldrig blokerende, aldrig kastende:
// Postgres-skrivningen i logEvent.js er sandheden, dette er kopien.
//
// userId (valgfri): den bruger eventet hører til. Er klienten endnu ikke
// identify'et som netop den bruger, holdes eventet i hukommelsen og sendes
// når identifyPosthog() kører, så det lander på personen og ikke på en anonym
// memory-id der aldrig bliver koblet.
export function capturePosthogEvent(name, properties, { userId } = {}) {
  if (!isPosthogCapturing() || !name) return;
  if (userId && identifiedUserId !== String(userId)) {
    if (pendingUserEvents.length < MAX_PENDING_USER_EVENTS) {
      pendingUserEvents.push({ userId: String(userId), name, properties });
    }
    return;
  }
  try {
    capture(name, properties);
  } catch { /* best-effort — spejlingen må aldrig påvirke spillet */ }
}

function flushPendingUserEvents() {
  const queued = pendingUserEvents.splice(0, pendingUserEvents.length);
  for (const ev of queued) {
    // Events fra en anden bruger (logout/login på samme fane før identify)
    // smides væk frem for at blive bundet til den forkerte person.
    if (ev.userId !== identifiedUserId) continue;
    try {
      capture(ev.name, ev.properties);
    } catch { /* best-effort */ }
  }
}

// KUN den interne UUID. #2041 (Clarity-identify-fælden): identify må aldrig
// få e-mail eller andet der kan læses som PII i en tredjeparts UI.
// Kaldes ved HVER page load efter login: memory-persistence giver en ny anonym
// id pr. load, og identify er det der binder brugerens sessioner sammen.
export function identifyPosthog(userId) {
  if (!isPosthogCapturing() || !userId) return;
  const id = String(userId);
  try {
    client.identify(id);
    identifiedUserId = id;
  } catch { /* best-effort — identify må aldrig bryde brugerflowet */ }
  if (identifiedUserId === id) flushPendingUserEvents();
}

// Ved logout: bryd koblingen mellem den næste anonyme session og den bruger
// der lige loggede ud (delte enheder).
export function resetPosthog() {
  identifiedUserId = null;
  pendingUserEvents.length = 0;
  if (!posthogStarted || !client) return;
  try {
    client.reset();
  } catch { /* best-effort */ }
}

// Afvist analytics (også midt i en session): SDK'et kan ikke rives ned rent
// (samme som Clarity/GA), men optOut() stopper afsendelsen med det samme.
// Med memory-persistence huskes valget kun i denne page load; ved næste load
// starter posthogIntegration.jsx slet ikke SDK'et, fordi gaten læser det
// gemte samtykke. Ventende bruger-events smides væk.
export function optOutPosthog() {
  pendingUserEvents.length = 0;
  if (!posthogStarted || !client) return;
  posthogOptedOut = true;
  try {
    Promise.resolve(client.optOut()).catch(() => {});
  } catch { /* best-effort */ }
}
