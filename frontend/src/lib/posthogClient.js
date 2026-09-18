// PostHog (EU) client — #4321.
//
// Leaf-modul med selve SDK-håndteringen: lazy load, init, identify, capture.
// React-wiringen (consent-gate, route-skift, auth-skift) ligger i
// posthogIntegration.jsx. Opdelingen findes fordi logEvent.js skal kunne
// spejle sine events uden at importere en .jsx-fil.
//
// Designvalg (ejer-beslutning 27/8 + 8/9, se #4321):
//   - Additivt lag. player_events og signup_attribution bliver i Postgres og
//     er fortsat sandheden; PostHog erstatter intet. GA4 og Clarity beholdes.
//   - Kun efter analytics-samtykke, og kun i PROD. Ingen requests før accept.
//   - Reverse proxy (/ingest) frem for eu.i.posthog.com direkte, så
//     adblockere ikke spiser en femtedel af trafikken. Se frontend/vercel.json.
//   - autocapture er SLÅET FRA: vi spejler vores egne, navngivne events
//     (KNOWN_EVENTS i logEvent.js) i stedet for en støjsky af DOM-klik.
//   - session recording er SLÅET FRA: Clarity dækker replay indtil de fire
//     ugers parallel drift er evalueret (#4321 afgrænsning).
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

// Den ene klient-instans. Sat af startPosthog(), aldrig genskabt.
let client = null;
let posthogStarted = false;

// SDK'et dynamic-importeres så det ikke lander i main bundle (samme mønster
// som Clarity, #479).
function loadPosthog() {
  return import("posthog-js-lite").then((m) => m.PostHog || m.default);
}

export function isPosthogStarted() {
  return posthogStarted;
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

function capture(name, properties) {
  const campaign = campaignProperties();
  client.capture(name, campaign ? { ...(properties || {}), ...campaign } : (properties || {}));
}

// optIn()/optOut() er async i core'en, men laver kun en synkron
// localStorage-skrivning bag en wrap(). Vi venter ikke på dem; vi sluger bare
// afvisningen, så samtykke-flowet aldrig kan give en unhandled rejection.
function optIn() {
  if (!client) return;
  try {
    Promise.resolve(client.optIn()).catch(() => {});
  } catch { /* best-effort */ }
}

function shouldSkipForAutomation() {
  return typeof navigator !== "undefined" && isLikelyAutomation(navigator);
}

// Starter PostHog. Kaldes KUN når analytics-samtykke er givet (se
// posthogIntegration.jsx). Idempotent.
export async function startPosthog() {
  if (!POSTHOG_ENABLED) return;
  if (posthogStarted) {
    // Samtykke givet igen efter en tilbagekaldelse i SAMME session: klienten
    // kører allerede, men står opted out. Uden dette ville den tavst blive
    // ved med at kassere events. Se optIn-kommentaren længere nede.
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
    client = new PostHog(PROJECT_KEY, {
      // Relativ sti gennem vores egen reverse proxy. Core'en bruger host som
      // ren streng-præfiks (`${host}/batch/`), så en relativ sti virker og
      // resolves mod vores origin — det er hele pointen med /ingest.
      host: API_HOST,
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
    // Opt-out PERSISTERES i localStorage og slår defaultOptIn: core læser
    // `getPersistedProperty(OptedOut) ?? !defaultOptIn`. En besøgende der
    // engang trak sit samtykke tilbage ville derfor forblive tavs for evigt,
    // også efter at have givet samtykke igen på et senere besøg — en STILLE
    // fejl uden en eneste log-linje. (Samme fælde fandtes med posthog-js'
    // opt_out_capturing(), som heller ikke blev modsvaret af et opt_in-kald;
    // den er altså ikke ny med #5055, men rettes her.)
    optIn();
    posthogStarted = true;
  } catch (err) {
    console.error("posthog init failed:", err);
  }
}

// Manuelt $pageview ved SPA-navigation (captureHistoryEvents: false ovenfor).
export function capturePosthogPageview() {
  if (!posthogStarted || !client) return;
  try {
    capture("$pageview");
  } catch { /* best-effort — telemetri må aldrig bryde en navigation */ }
}

// Spejler et player_event til PostHog. Aldrig blokerende, aldrig kastende:
// Postgres-skrivningen i logEvent.js er sandheden, dette er kopien.
export function capturePosthogEvent(name, properties) {
  if (!posthogStarted || !client || !name) return;
  try {
    capture(name, properties);
  } catch { /* best-effort — spejlingen må aldrig påvirke spillet */ }
}

// KUN den interne UUID. #2041 (Clarity-identify-fælden): identify må aldrig
// få e-mail eller andet der kan læses som PII i en tredjeparts UI.
export function identifyPosthog(userId) {
  if (!posthogStarted || !client || !userId) return;
  try {
    client.identify(String(userId));
  } catch { /* best-effort — identify må aldrig bryde brugerflowet */ }
}

// Ved logout: bryd koblingen mellem den næste anonyme session og den bruger
// der lige loggede ud (delte enheder).
export function resetPosthog() {
  if (!posthogStarted || !client) return;
  try {
    client.reset();
  } catch { /* best-effort */ }
}

// Tilbagekaldt samtykke: SDK'et kan ikke rives ned rent (samme som Clarity/GA),
// men optOut() stopper afsendelsen med det samme og husker valget i lite's egen
// persistence. Vores egen consent-gate i posthogIntegration.jsx er stadig den
// primære spærre — startPosthog() kaldes slet ikke uden analytics-samtykke.
export function optOutPosthog() {
  if (!posthogStarted || !client) return;
  try {
    Promise.resolve(client.optOut()).catch(() => {});
  } catch { /* best-effort */ }
}
