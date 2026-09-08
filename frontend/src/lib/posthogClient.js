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

import { isLikelyAutomation, isPrerendering } from "./clarityBotSignals.js";

// import.meta.env optional-chained så modulet kan importeres i node --test,
// jf. konventionen i trafficBeacon.js / clarityIntegration.jsx.
//
// Fallback-token: PostHog's client-side "project API key" er per design
// offentlig (den ligger i enhver besøgendes bundle og kan kun skrive events,
// ikke læse data). Den er derfor hardcodet som fallback, så integrationen ikke
// er tavs hvis en env-variabel mangler på et deploy. Den er IKKE en secret.
const FALLBACK_KEY = "phc_vykwxRnQyYyPSKX2wAYrK3fRKn85KxttbpaRYRU8LAFP";
const PROJECT_KEY = import.meta.env?.VITE_POSTHOG_KEY || FALLBACK_KEY;

// Relativ sti = samme origin = ingen adblocker-liste rammer den. Rewrites i
// frontend/vercel.json sender /ingest videre til EU-cloud'en.
const API_HOST = "/ingest";
// ui_host skal pege på PostHog's egen adresse, ellers linker toolbar og
// "view recording"-links tilbage til vores eget domæne.
const UI_HOST = "https://eu.posthog.com";

export const POSTHOG_ENABLED = Boolean(import.meta.env?.PROD) && Boolean(PROJECT_KEY);

let posthogPromise = null;
let posthogStarted = false;

// SDK'et dynamic-importeres så ~60 KB ikke lander i main bundle (samme mønster
// som Clarity, #479). Cached i modul-scope efter første load.
function loadPosthog() {
  if (!posthogPromise) {
    posthogPromise = import("posthog-js").then((m) => m.posthog || m.default);
  }
  return posthogPromise;
}

export function isPosthogStarted() {
  return posthogStarted;
}

function shouldSkipForAutomation() {
  return typeof navigator !== "undefined" && isLikelyAutomation(navigator);
}

// Starter PostHog. Kaldes KUN når analytics-samtykke er givet (se
// posthogIntegration.jsx). Idempotent.
export async function startPosthog() {
  if (posthogStarted || !POSTHOG_ENABLED) return;
  if (shouldSkipForAutomation()) return;
  if (typeof document !== "undefined" && isPrerendering(document)) {
    // Speculation-Rules-prerender bliver måske aldrig aktiveret — udskyd init
    // til siden er et rigtigt besøg (samme guard som Clarity, #3819).
    document.addEventListener("prerenderingchange", () => { startPosthog(); }, { once: true });
    return;
  }
  try {
    const posthog = await loadPosthog();
    if (posthogStarted) return; // re-entry guard
    posthog.init(PROJECT_KEY, {
      api_host: API_HOST,
      ui_host: UI_HOST,
      // SPA: React Router skifter side uden page load, så vi fyrer $pageview
      // selv ved hvert route-skift (capturePosthogPageview).
      capture_pageview: false,
      // Person-profiler kun for identificerede brugere: anonyme besøg tæller
      // stadig i web analytics, men bruger ikke person-kvote.
      person_profiles: "identified_only",
      // Vi spejler vores egne navngivne events; DOM-autocapture ville
      // fordoble støjen og gøre funnels sværere at læse.
      autocapture: false,
      // Clarity ejer session replay indtil #4321's 4-ugers-evaluering.
      disable_session_recording: true,
    });
    posthogStarted = true;
  } catch (err) {
    console.error("posthog init failed:", err);
  }
}

// Manuelt $pageview ved SPA-navigation (capture_pageview: false ovenfor).
export async function capturePosthogPageview() {
  if (!posthogStarted) return;
  try {
    const posthog = await loadPosthog();
    posthog.capture("$pageview");
  } catch { /* best-effort — telemetri må aldrig bryde en navigation */ }
}

// Spejler et player_event til PostHog. Aldrig blokerende, aldrig kastende:
// Postgres-skrivningen i logEvent.js er sandheden, dette er kopien.
export function capturePosthogEvent(name, properties) {
  if (!posthogStarted || !name) return;
  loadPosthog()
    .then((posthog) => { posthog.capture(name, properties || {}); })
    .catch(() => { /* best-effort — spejlingen må aldrig påvirke spillet */ });
}

// KUN den interne UUID. #2041 (Clarity-identify-fælden): identify må aldrig
// få e-mail eller andet der kan læses som PII i en tredjeparts UI.
export async function identifyPosthog(userId) {
  if (!posthogStarted || !userId) return;
  try {
    const posthog = await loadPosthog();
    posthog.identify(String(userId));
  } catch { /* best-effort — identify må aldrig bryde brugerflowet */ }
}

// Ved logout: bryd koblingen mellem den næste anonyme session og den bruger
// der lige loggede ud (delte enheder).
export async function resetPosthog() {
  if (!posthogStarted) return;
  try {
    const posthog = await loadPosthog();
    posthog.reset();
  } catch { /* best-effort */ }
}

// Tilbagekaldt samtykke: SDK'et kan ikke rives ned rent (samme som Clarity/GA),
// men opt_out_capturing() stopper afsendelsen med det samme og husker valget.
export async function optOutPosthog() {
  if (!posthogStarted) return;
  try {
    const posthog = await loadPosthog();
    posthog.opt_out_capturing();
  } catch { /* best-effort */ }
}
