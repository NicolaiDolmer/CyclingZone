import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useConsent } from "./consent.jsx";
import { supabase } from "./supabase";
import { getAuthedUser } from "./getAuthedUser.js";
import { getAnonymousId } from "./anonymousId.js";
import { CLARITY_CONSENT_V2_PAYLOAD } from "./clarityConsent.js";
import { isLikelyAutomation, isPrerendering, isSelfReferralEntry } from "./clarityBotSignals.js";

// import.meta.env optional-chained så modulet kan importeres i node --test,
// jf. konventionen i trafficBeacon.js.
const PROJECT_ID = import.meta.env?.VITE_CLARITY_PROJECT_ID;
const ENABLED = Boolean(import.meta.env?.PROD) && Boolean(PROJECT_ID);

// #479: Clarity SDK dynamic-importeres så ~10 KB ikke ender i main bundle.
// Cached i modul-scope efter første load; subsequent re-renders bruger samme ref.
let clarityPromise = null;
let clarityStarted = false;

function loadClarity() {
  if (!clarityPromise) {
    clarityPromise = import("@microsoft/clarity").then((m) => m.default);
  }
  return clarityPromise;
}

// #3819: known automation frameworks (Selenium/Puppeteer/Playwright m.fl.)
// sætter navigator.webdriver — ægte browsere gør aldrig. Billig, false-
// positive-fri filtrering; fanger ikke nødvendigvis #3819-spikens trafik
// (den undgik allerede Clarity's egen IsBot-heuristik) men er god praksis.
function shouldSkipForAutomation() {
  return typeof navigator !== "undefined" && isLikelyAutomation(navigator);
}

async function startClarity() {
  if (clarityStarted || !ENABLED) return;
  if (shouldSkipForAutomation()) return;
  if (typeof document !== "undefined" && isPrerendering(document)) {
    // Siden bliver måske aldrig aktiveret (Speculation Rules-prerender) —
    // udskyd init til den faktisk bliver et rigtigt besøg.
    document.addEventListener("prerenderingchange", () => { startClarity(); }, { once: true });
    return;
  }
  try {
    const Clarity = await loadClarity();
    if (clarityStarted) return; // re-entry guard
    Clarity.init(PROJECT_ID);
    // Must fire immediately after init, before any identify/pageview signal
    // can be recorded, so Clarity never processes a page as "unconsented".
    Clarity.consentV2(CLARITY_CONSENT_V2_PAYLOAD);
    clarityStarted = true;
    // #3819: tag self-referral entries (cyclingzone.org → cyclingzone.org,
    // det dominerende signal i den syntetiske spike, 2.929/~4.000 sessions)
    // så ejeren kan ekskludere dem i Clarity's dashboard-filtre uden at
    // blokere optagelsen — ægte selv-referral (fx target="_blank" fra en
    // intern side) findes og skal stadig kunne ses/inkluderes ved behov.
    if (typeof document !== "undefined" && typeof window !== "undefined"
      && isSelfReferralEntry(document.referrer, window.location.origin)) {
      setClarityTag("entry_referrer", "self");
    }
  } catch (err) {
    console.error("clarity init failed:", err);
  }
}

async function setClarityTag(key, value) {
  if (!clarityStarted || value == null) return;
  try {
    const Clarity = await loadClarity();
    Clarity.setTag(key, String(value));
  } catch { /* tagging is best-effort */ }
}

// #1797: tell Clarity *which* user this session belongs to so returning users
// are recognised across sessions instead of counting as brand-new every time
// (the dashboard showed a 1:1 session/user ratio because identify was never
// called). The custom-id is the authenticated user's id when logged in (a stable
// internal UUID — Clarity hashes it client-side, so no PII leaves the browser),
// otherwise a stable per-device anonymous id. Calling identify is idempotent:
// Clarity de-dups on the hashed id, so repeated calls with the same id do not
// double-count. Per Clarity docs the call should happen on each page, which the
// route-change effect below handles.
async function identifyClarity(customId) {
  if (!clarityStarted || !customId) return;
  try {
    const Clarity = await loadClarity();
    Clarity.identify(String(customId));
  } catch { /* identify is best-effort — never break the user flow */ }
}

// Resolve the custom-id to hand Clarity: the logged-in user's id, or the stable
// per-device anonymous id when logged out. Async because auth state is async.
async function resolveCustomId() {
  try {
    const user = await getAuthedUser();
    if (user?.id) return user.id;
  } catch { /* fall through to anonymous id */ }
  return getAnonymousId();
}

// Mounted inside ConsentProvider AND inside BrowserRouter (so useLocation works).
// Starts Clarity once analytics consent is granted, identifies the user/device,
// and stamps custom tags (manager_id, division, season_number) so weekly review
// can segment by audience. No teardown on revoke — Clarity SDK has no clean
// stop; the next page load will respect the new consent.
export default function ClarityIntegration() {
  const { hasConsent } = useConsent();
  const analyticsOn = hasConsent("analytics");
  const location = useLocation();
  // Caches the most recently resolved custom-id so the route-change effect can
  // re-identify on each page without an auth round-trip per navigation.
  const customIdRef = useRef(null);

  useEffect(() => {
    if (!analyticsOn) return;
    startClarity();
  }, [analyticsOn]);

  // Identify on start + whenever auth state changes (login/logout/token refresh),
  // switching between the anonymous device id and the authenticated user id.
  useEffect(() => {
    if (!analyticsOn || !ENABLED) return;
    let cancelled = false;

    async function identifyFromSession() {
      const customId = await resolveCustomId();
      if (cancelled) return;
      customIdRef.current = customId;
      identifyClarity(customId);
    }

    identifyFromSession();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        identifyFromSession();
      }
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, [analyticsOn]);

  // Re-identify on every SPA route change. Clarity's Identify API is documented
  // as "should be called for each page of the website"; in an SPA there is no
  // full page load per route, so we fire it on navigation using the cached id
  // (falls back to a fresh resolve on the first navigation before auth resolves).
  useEffect(() => {
    if (!analyticsOn || !ENABLED || !clarityStarted) return;
    const cached = customIdRef.current;
    if (cached) {
      identifyClarity(cached);
    } else {
      resolveCustomId().then((id) => {
        customIdRef.current = id;
        identifyClarity(id);
      });
    }
  }, [analyticsOn, location.pathname]);

  useEffect(() => {
    if (!analyticsOn || !ENABLED) return;
    let cancelled = false;

    async function tagFromSession() {
      const user = await getAuthedUser();
      if (!user || cancelled) return;

      const { data: team } = await supabase
        .from("teams")
        .select("id, division")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (team) {
        setClarityTag("manager_id", team.id);
        setClarityTag("division", team.division);
      }

      const { data: season } = await supabase
        .from("seasons")
        .select("number")
        .eq("status", "active")
        .order("number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      // Tag-key stays "season_number" (analytics convention); the value reads
      // the real column seasons.number (the table has no season_number column).
      if (season) setClarityTag("season_number", season.number);
    }

    tagFromSession();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") tagFromSession();
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, [analyticsOn]);

  return null;
}
