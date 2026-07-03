import React from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AppProviders } from "./AppProviders.jsx";
import { initSentry } from "./lib/sentry.jsx";
import { installChunkReloadHandlers } from "./lib/chunkErrors.js";
import { installTranslationResilience } from "./lib/translationResilience.js";
import { captureFirstTouch } from "./lib/attribution.js";
import { BrowserRouter } from "react-router-dom";
import i18n from "./i18n";
import "./index.css";
// #2047: flag-icons-CSS (~ukomprimeret sprite) importeres IKKE længere globalt her.
// Landing bruger ingen `fi fi-*`-glyffer (LanguageToggle er ren tekst), så den
// blokerede boot uden gevinst. CSS'en scopes nu til de to moduler der faktisk
// renderer flag: `Flag.jsx` og `LanguageSwitcher.jsx` — Vite deduper importen,
// så den loades præcis én gang, første gang et flag-modul indlæses.

// Stale-chunk recovery (#906): et globalt net der fanger dynamic-import/preload-
// fejl efter et deploy FØR React's error-boundary kan ramme dem — både Vite's
// `vite:preloadError` og uhåndterede chunk-rejections (dynamic imports uden for
// React.lazy). Ét kontrolleret reload til frisk index.html, loop-guarded via
// samme per-release sessionStorage-nøgle som boundary'en.
const _release = import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA;
installChunkReloadHandlers({
  target: window,
  release: _release,
  storage: window.sessionStorage,
  reload: () => window.location.reload(),
});

// #2039: gør DOM-mutation fra browser-oversættelse non-fatal (belt-and-suspenders
// til <html lang>-fixet i LanguageProvider). Skal installeres FØR React renders.
installTranslationResilience();

initSentry();

// #679: snapshot first-touch acquisition source as early as possible — before any
// SPA navigation changes document.referrer. First visit wins; persisted at signup.
captureFirstTouch();

// Preview-mock (#prelive-harness): KUN når VITE_PREVIEW_MOCK er sat (Vercel
// preview-scope). Den dynamiske import bag build-time-guarden ⇒ prod-bundlen
// tree-shaker hele preview/-mappen væk (0 bytes i production). Async IIFE så vi
// kan afvente installeringen FØR mount uden top-level await i entry-modulet.
(async () => {
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { installPreviewMock } = await import("./preview/installPreviewMock.js");
    installPreviewMock();
  }

  // i18n initialiseres ved import, men .init() resolver i en microtask. Vent på
  // at den er klar FØR vi monterer — ellers renderer klientens første pass
  // oversættelses-keys (eller tom tekst) hvor den prerendrede markup har fuldt
  // oversat tekst → hydration-mismatch (React #418/#423). Resolver straks hvis
  // allerede initialiseret (inline resources gør den typisk synkron-klar).
  await new Promise((resolve) => {
    if (i18n.isInitialized) resolve();
    else i18n.on("initialized", resolve);
  });

  const rootEl = document.getElementById("root");

  // Providers ligger i AppProviders, så client-mount og build-time prerender
  // (entry-server.jsx) deler nøjagtig samme træ — det er forudsætningen for ren
  // hydration på landing.
  const tree = (
    <React.StrictMode>
      <AppProviders>
        {/* #969: v7_startTransition gør sidebar-nav interruptible. Routeren bor
            HER (ikke inde i App), så client-træet er identisk med prerenderens
            (entry-server bruger StaticRouter om samme <App/>) → ren hydration. */}
        <BrowserRouter future={{ v7_startTransition: true }}>
          <App />
        </BrowserRouter>
      </AppProviders>
    </React.StrictMode>
  );

  // Hydrér KUN når "/" faktisk ER serveret som den prerendrede landing (#root har
  // markup). På alle andre ruter laver vi en frisk client-render: den tomme
  // app-shell i prod, ELLER et miljø der — uden Vercel-rewriten — fejlserverer
  // landing-index.html for en app-rute (fx `vite preview` i e2e). Uden pathname-
  // gaten ville React forsøge at hydrere landing-markup mod en app-side → mismatch
  // (#418/#422). Vi rydder stale markup før createRoot, så app-ruten ikke arver et
  // glimt af landing.
  if (rootEl.firstElementChild && window.location.pathname === "/") {
    hydrateRoot(rootEl, tree);
  } else {
    if (rootEl.firstElementChild) rootEl.replaceChildren();
    createRoot(rootEl).render(tree);
  }
})();
