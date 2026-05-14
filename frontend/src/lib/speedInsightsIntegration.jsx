import { SpeedInsights } from "@vercel/speed-insights/react";
import { useConsent } from "./consent.jsx";

const ENABLED = import.meta.env.PROD;

// Mounted inside ConsentProvider. Sends anonymous Core Web Vitals to Vercel
// Speed Insights only when analytics consent is granted, mirroring the
// Clarity gate so a "Kun nødvendige" choice silences both vendors.
export default function SpeedInsightsIntegration() {
  const { hasConsent } = useConsent();
  if (!ENABLED || !hasConsent("analytics")) return null;
  return <SpeedInsights />;
}
