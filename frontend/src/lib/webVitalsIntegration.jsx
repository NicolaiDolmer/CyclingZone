import { useEffect } from "react";
import { onCLS, onINP, onLCP, onFCP, onTTFB } from "web-vitals";
import { useConsent } from "./consent.jsx";

const ENABLED = import.meta.env.PROD;

// Modul-scope guard: lytterne registreres kun én gang pr. page load, så et
// consent-toggle der remounter komponenten ikke dobbelt-abonnerer.
let registered = false;

// Sender hver Core Web Vital til GA4 som event via den delte gtag-pipeline
// (samme stream som gaIntegration). GA4 forventer en heltals-`value`: CLS ganges
// med 1000 (ellers afrundes 0.0x til 0), de øvrige rundes til ms. `metric_id`
// giver dedup + distribution i GA4; `non_interaction` holder CWV-events ude af
// bounce/engagement-tallene. Guard på window.gtag: hvis GA endnu ikke er startet
// (rækkefølge mellem de to consent-gatede komponenter er ikke garanteret) droppes
// målingen hellere end at fejle — næste metrik/page load fanger den.
function sendToGa({ name, delta, value, id }) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, {
    value: Math.round(name === "CLS" ? delta * 1000 : delta),
    metric_id: id,
    metric_value: value,
    metric_delta: delta,
    non_interaction: true,
  });
}

function registerWebVitals() {
  if (registered || !ENABLED) return;
  registered = true;
  onCLS(sendToGa);
  onINP(sendToGa);
  onLCP(sendToGa);
  onFCP(sendToGa);
  onTTFB(sendToGa);
}

// Mounted inside ConsentProvider. Sender anonyme field Core Web Vitals (LCP/INP/
// CLS/FCP/TTFB) til GA4, kun når analytics-samtykke er givet — samme gate som
// GA4/Clarity/Vercel Analytics, så "Kun nødvendige" tavsgør alle vendors. Gratis
// erstatning for den betalte Vercel Speed Insights (vi router gennem GA4-streamen
// vi i forvejen ikke betaler for). Ingen teardown ved revoke: web-vitals har ingen
// unsubscribe, og næste page load respekterer det nye valg.
export default function WebVitalsIntegration() {
  const { hasConsent } = useConsent();
  const analyticsOn = hasConsent("analytics");

  useEffect(() => {
    if (!analyticsOn) return;
    registerWebVitals();
  }, [analyticsOn]);

  return null;
}
