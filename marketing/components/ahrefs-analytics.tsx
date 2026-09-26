// #5493: Ahrefs Web Analytics — 2 KB, cookie-frit, samler ingen persondata
// (https://help.ahrefs.com/en/articles/10247870-about-ahrefs-web-analytics).
//
// Ejer-beslutning 22/9: scriptet kører UDEN samtykke-gate, på ALLE sider —
// samme klasse som frontend/src/components/TrafficBeacon.jsx. Ikke via
// Google Tag Manager: der findes ingen GTM-container i stakken.
//
// Nøglen læses fra NEXT_PUBLIC_AHREFS_ANALYTICS_KEY (Infisical/Vercel env,
// samme mekanik som frontend/vite-plugins/ahrefs-analytics.ts) og må ALDRIG
// hardkodes. Next.js indlejrer NEXT_PUBLIC_*-værdier ved build, så et
// ubesat lokalt/preview-build gør komponenten til en no-op.
//
// Almindeligt <script>-tag (ikke next/script) fordi #5493's egen
// verifikation er `curl` mod den serverede HTML — komponenten er en
// Server Component (ingen "use client"), så tagget er en del af den
// statisk genererede HTML for hver marketing-side, synligt for curl og
// ikke-JS-crawlere.
import { getAhrefsAnalyticsKey } from "@/lib/ahrefsAnalytics";

export function AhrefsAnalytics() {
  const key = getAhrefsAnalyticsKey();
  if (!key) return null;
  return <script src="https://analytics.ahrefs.com/analytics.js" data-key={key} async />;
}
