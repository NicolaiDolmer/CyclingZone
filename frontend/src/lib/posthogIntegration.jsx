import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useConsent } from "./consent.jsx";
import { useUserProfile } from "./userProfile.jsx";
import {
  POSTHOG_ENABLED,
  isPosthogAllowed,
  resolveEffectiveConsent,
  startPosthog,
  capturePosthogPageview,
  identifyPosthog,
  resetPosthog,
  optOutPosthog,
} from "./posthogClient.js";

// PostHog-wiringen (#4321). SDK-håndteringen ligger i posthogClient.js; her
// kobles den til samtykke, SPA-navigation og auth-tilstand.
//
// Gate (ejer 6/10, variant A): PostHog kører cookieløst (memory-persistence)
// for alle besøgende UNDTAGEN dem der aktivt har afvist analytics. Ubesvaret
// banner = kører. Afvisning undervejs = optOut med det samme. Intet nyt banner.
//
// Monteres inde i ConsentProvider (og dermed UserProfileProvider), inde i
// BrowserRouter (useLocation) og inde i AnalyticsBoundary (CYCLINGZONE-5B:
// telemetri må aldrig tage spillet ned).
export default function PosthogIntegration() {
  const { consent, hasResponded } = useConsent();
  const { userId, profile, loading: profileLoading } = useUserProfile();
  // Samme forrang som ConsentProvider: DB-værdien vinder over den lokale. Vi
  // læser profilen direkte (ikke kun den synkede context-værdi), så en
  // afvisning fra en anden enhed gælder i SAMME render som profilen lander.
  const effectiveConsent = resolveEffectiveConsent(
    hasResponded ? consent : null,
    profile?.consent_preferences,
  );
  const posthogOn = isPosthogAllowed(effectiveConsent);
  const location = useLocation();
  // Sandt når vi har nået at starte SDK'et mindst én gang i denne page load —
  // bruges så pageview-effekten ikke fyrer før init.
  const startedRef = useRef(false);
  // Seneste identificerede bruger-id, så vi ikke kalder identify() på hver
  // eneste navigation.
  const identifiedRef = useRef(null);

  useEffect(() => {
    if (!POSTHOG_ENABLED) return;
    if (!posthogOn) {
      // Afvist (også midt i sessionen): ingen ren teardown (samme som
      // Clarity/GA), men opt-out stopper afsendelsen med det samme. Næste
      // page load starter slet ikke SDK'et.
      if (startedRef.current) optOutPosthog();
      identifiedRef.current = null;
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
  }, [posthogOn]);

  // Identify efter login, ved HVER page load: memory-persistence giver en ny
  // anonym id pr. load, og identify er det der binder sessionerne sammen.
  // KUN den interne UUID (#2041: aldrig e-mail/navn til en tredjeparts UI).
  //
  // Vi venter til profilen for netop denne bruger er hentet (userId sat og
  // !profileLoading). Først da kender vi brugerens DB-samtykke; ellers kunne
  // en bruger der har afvist på en anden enhed nå at blive identify'et i
  // vinduet før profilen landede. Logget-ud brugere identificeres bevidst
  // ikke: person_profiles er "identified_only".
  const profileReady = Boolean(userId) && !profileLoading;
  useEffect(() => {
    if (!POSTHOG_ENABLED || !posthogOn) return;
    let cancelled = false;
    startPosthog().then(() => {
      if (cancelled) return;
      if (userId && profileReady) {
        if (identifiedRef.current === userId) return;
        identifiedRef.current = userId;
        identifyPosthog(userId);
      } else if (!userId && identifiedRef.current) {
        // Logget ud: bryd koblingen, så næste anonyme session på samme fane
        // ikke hænger på den forrige bruger.
        identifiedRef.current = null;
        resetPosthog();
      }
    });
    return () => { cancelled = true; };
  }, [posthogOn, userId, profileReady]);

  // SPA-route-skift giver ingen page load, så $pageview fyres manuelt pr.
  // navigation (samme sted som Clarity re-identify'er). Den første pageview
  // fyres af start-effekten ovenfor; denne springer den over via startedRef.
  useEffect(() => {
    if (!posthogOn || !POSTHOG_ENABLED || !startedRef.current) return;
    capturePosthogPageview();
  }, [posthogOn, location.pathname]);

  return null;
}
