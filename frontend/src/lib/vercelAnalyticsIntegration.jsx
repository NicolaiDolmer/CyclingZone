import { Analytics } from "@vercel/analytics/react";
import { useConsent } from "./consent.jsx";

const ENABLED = import.meta.env.PROD;

// Mounted inside ConsentProvider. Sends anonymous page views to Vercel
// Web Analytics only when analytics consent is granted, mirroring the
// Clarity and Speed Insights gates so a "Kun nødvendige" choice silences
// all three vendors.
export default function VercelAnalyticsIntegration() {
  const { hasConsent } = useConsent();
  if (!ENABLED || !hasConsent("analytics")) return null;
  return <Analytics />;
}
