// #5493: Ahrefs Web Analytics — 2 KB, cookie-frit, samler ingen persondata
// (https://help.ahrefs.com/en/articles/10247870-about-ahrefs-web-analytics).
//
// Ejer-beslutning 22/9: scriptet kører UDEN samtykke-gate, på ALLE sider —
// samme klasse som frontend/src/components/TrafficBeacon.jsx (cookie-fri,
// ingen storage). Ikke via Google Tag Manager: der findes ingen GTM-container
// i stakken (GA4 kører direkte via gtag i src/lib/gaIntegration.jsx), og vi
// indfører ikke én for et 2 KB-script.
//
// Nøglen læses fra VITE_AHREFS_ANALYTICS_KEY (Infisical/Vercel env, samme
// injektions-mekanik som VITE_GA_MEASUREMENT_ID) og må ALDRIG hardkodes.
// Ubesat (lokalt/preview, jf. .env.example-kommentaren for GA4) → pluginet er
// en no-op, så dev-/preview-trafik aldrig rammer Ahrefs.
//
// Statisk <script>-tag frem for GA4's runtime JS-injektion (gaIntegration.jsx
// starter kun EFTER samtykke): #5493's egen verifikation er
// `curl -s https://cyclingzone.org/ | grep analytics.ahrefs.com` — et
// klient-injiceret script efter hydration er usynligt for curl/ikke-JS-
// crawlere. transformIndexHtml kører derimod FØR prerender.mjs læser den
// byggede index.html-template, så tagget følger med i BÅDE de prerendrede
// ruter og app.html-shellen (samme mekanik som releaseMetaPlugin).
import type { Plugin } from "vite";

export function ahrefsAnalyticsPlugin(): Plugin {
  return {
    name: "cz-ahrefs-analytics",
    transformIndexHtml() {
      // CodeRabbit-fund: trim, ellers sender et env med leading/trailing
      // whitespace et ANDET data-key end det Ahrefs-dashboardet viser, og
      // trafikmålingen slår fejl uden en synlig fejlmeddelelse.
      const key = (process.env.VITE_AHREFS_ANALYTICS_KEY || "").trim();
      if (!key) return [];
      return [
        {
          tag: "script",
          attrs: {
            src: "https://analytics.ahrefs.com/analytics.js",
            "data-key": key,
            async: true,
          },
          injectTo: "head",
        },
      ];
    },
  };
}

export default ahrefsAnalyticsPlugin;
