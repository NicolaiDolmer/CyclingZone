// Anonym, storage-less, cookieless engagement-beacon (#2040) — KUN public-sider.
// Ingen id/cookie/storage på enheden; serveren dedup'er via visit_hash. Engaged =
// ≥2 pageviews i denne page-session ELLER interaktion efter ≥10s.
//
// #4320: beaconen bærer nu også kanal-kontekst (referrer + UTM), så trafik- og
// signup-siden af funnellen kan holdes op mod hinanden. Stadig storage-less:
// konteksten lever i modul-scope for denne page-session og skrives ingen steder
// hen på enheden.
//
// import.meta.env tilgås optional-chained så modulet kan importeres i node --test
// (hvor import.meta.env er undefined) — kun de rene funktioner testes.
import { UTM_KEYS } from "./attribution.js";

const API = import.meta.env?.VITE_API_URL;
const ENABLED = Boolean(import.meta.env?.PROD) && Boolean(API);

// Kun de tre kanal-bærende UTM-felter sendes. term/content er annonce-niveau og
// hører til i signup_attribution, ikke i en per-pageview-beacon.
const BEACON_UTM_KEYS = UTM_KEYS.filter(
  (k) => k === "utm_source" || k === "utm_medium" || k === "utm_campaign"
);

// Ren tærskel-maskine: kalder onEngaged ÉN gang når engagement-tærsklen krydses.
export function makeEngagementTracker(onEngaged) {
  let pageviews = 0;
  let engaged = false;
  function fire() {
    if (!engaged) {
      engaged = true;
      onEngaged();
    }
  }
  return {
    pageview() {
      pageviews += 1;
      if (pageviews >= 2) fire();
    },
    // `elapsed` = ms siden page-load (injiceres af wrapperen / i test).
    interaction(elapsed) {
      if (elapsed >= 10_000) fire();
    },
  };
}

// Snapshot af hvordan dette besøg startede. Ren funktion; argumenterne
// injiceres i test.
//
// Skal fanges ÉN gang ved page-load: UTM-parametrene forsvinder fra URL'en så
// snart brugeren navigerer i SPA'en, og landing_path skal blive ved med at pege
// på den FØRSTE side, ikke den nuværende. Længdegrænserne spejler
// attribution.js, så de to attributions-veje trunkerer ens.
export function captureVisitContext({
  search = typeof window !== "undefined" ? window.location.search : "",
  referrer = typeof document !== "undefined" ? document.referrer : "",
  path = typeof window !== "undefined" ? window.location.pathname : "",
} = {}) {
  const context = {};
  try {
    const params = new URLSearchParams(search || "");
    for (const key of BEACON_UTM_KEYS) {
      const value = params.get(key);
      if (value) context[key] = value.slice(0, 200);
    }
  } catch {
    // Ugyldig query-streng — kanal-kontekst er best-effort.
  }
  if (referrer) context.referrer = String(referrer).slice(0, 500);
  if (path) context.landingPath = String(path).slice(0, 200);
  return context;
}

// Modul-scope cache for denne page-session. Bevidst ikke localStorage: modulet
// er storage-less by design (#2040), og en reload er et nyt besøg.
let visitContext = null;
function getVisitContext() {
  if (!visitContext) visitContext = captureVisitContext();
  return visitContext;
}

// Testhook: nulstiller den cachede kontekst, så en test kan fange en ny.
export function _resetVisitContext() {
  visitContext = null;
}

function deviceType() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

// Tynd send — fire-and-forget. Må aldrig kaste.
export function sendBeacon(event, path) {
  if (!ENABLED) return;
  try {
    const body = JSON.stringify({
      event,
      path,
      deviceType: deviceType(),
      ...getVisitContext(),
    });
    const url = `${API}/api/collect`;
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else if (typeof fetch === "function") {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* telemetry må aldrig kaste */
  }
}
