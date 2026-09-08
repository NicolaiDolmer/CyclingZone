import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useConsent } from "./consent.jsx";
import { supabase } from "./supabase";
import { getAuthedUser } from "./getAuthedUser.js";
import {
  POSTHOG_ENABLED,
  startPosthog,
  capturePosthogPageview,
  identifyPosthog,
  resetPosthog,
  optOutPosthog,
} from "./posthogClient.js";

// PostHog-wiringen (#4321). SDK-håndteringen ligger i posthogClient.js; her
// kobles den til consent, SPA-navigation og auth-tilstand, efter samme mønster
// som clarityIntegration.jsx.
//
// Monteres inde i ConsentProvider, inde i BrowserRouter (useLocation) og inde i
// AnalyticsBoundary (CYCLINGZONE-5B: telemetri må aldrig tage spillet ned).
export default function PosthogIntegration() {
  const { hasConsent } = useConsent();
  const analyticsOn = hasConsent("analytics");
  const location = useLocation();
  // Sandt når vi har nået at starte SDK'et mindst én gang i denne
  // browser-session — bruges så pageview-effekten ikke fyrer før init.
  const startedRef = useRef(false);
  // Seneste identificerede bruger-id, så vi ikke kalder identify() på hver
  // eneste navigation (PostHog de-dup'er selv, men kaldet koster en round-trip
  // gennem den async modul-reference).
  const identifiedRef = useRef(null);

  useEffect(() => {
    if (!POSTHOG_ENABLED) return;
    if (!analyticsOn) {
      // Tilbagekaldt samtykke: ingen ren teardown (samme som Clarity/GA), men
      // opt-out stopper afsendelsen med det samme hvis SDK'et allerede kører.
      if (startedRef.current) optOutPosthog();
      return;
    }
    let cancelled = false;
    startPosthog().then(() => {
      if (cancelled) return;
      startedRef.current = true;
      // Første sidevisning: capture_pageview er slået fra, så den fyres her.
      capturePosthogPageview();
    });
    return () => { cancelled = true; };
  }, [analyticsOn]);

  // Identify på start + ved auth-skift. KUN den interne UUID sendes med
  // (#2041: aldrig e-mail/navn til en tredjeparts analytics-UI). Logget-ud
  // brugere identificeres bevidst ikke: person_profiles er "identified_only",
  // så anonyme besøg tæller i web analytics uden at bruge person-kvote.
  useEffect(() => {
    if (!analyticsOn || !POSTHOG_ENABLED) return;
    let cancelled = false;

    async function identifyFromSession() {
      let user = null;
      try {
        user = await getAuthedUser();
      } catch { /* best-effort — uidentificeret trafik er stadig gyldig */ }
      if (cancelled) return;
      if (user?.id) {
        if (identifiedRef.current === user.id) return;
        identifiedRef.current = user.id;
        identifyPosthog(user.id);
      } else if (identifiedRef.current) {
        // Logget ud: bryd koblingen, så næste anonyme session på samme enhed
        // ikke hænger på den forrige bruger.
        identifiedRef.current = null;
        resetPosthog();
      }
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

  // SPA-route-skift giver ingen page load, så $pageview fyres manuelt pr.
  // navigation (samme sted som Clarity re-identify'er). Den første pageview
  // fyres af start-effekten ovenfor; denne springer den over via startedRef.
  useEffect(() => {
    if (!analyticsOn || !POSTHOG_ENABLED || !startedRef.current) return;
    capturePosthogPageview();
  }, [analyticsOn, location.pathname]);

  return null;
}
