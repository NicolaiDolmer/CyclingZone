import { useEffect } from "react";
import { useConsent } from "./consent.jsx";

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
const ENABLED = import.meta.env.PROD && Boolean(MEASUREMENT_ID);

// gtag.js injectes først EFTER analytics-samtykke, så GA4 hverken sætter
// cookies eller sender requests før accept (ePrivacy/GDPR). Modul-scope
// guard som i clarityIntegration.
let gaStarted = false;

function startGa() {
  if (gaStarted || !ENABLED) return;
  gaStarted = true;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  // Consent Mode v2: scriptet kører kun post-accept, så analytics_storage er
  // granted pr. definition; ads-signaler holdes denied — vi kører ingen Google Ads.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

// Mounted inside ConsentProvider. Starts GA4 once analytics consent is granted,
// mirroring the Clarity/Vercel Analytics gates so a "Kun nødvendige" choice
// silences all vendors. SPA route changes are tracked by GA4 Enhanced
// Measurement (history events) — no manual page_view wiring needed. No teardown
// on revoke (gtag has no clean stop); the next page load respects the new choice.
export default function GaIntegration() {
  const { hasConsent } = useConsent();
  const analyticsOn = hasConsent("analytics");

  useEffect(() => {
    if (!analyticsOn) return;
    startGa();
  }, [analyticsOn]);

  return null;
}
