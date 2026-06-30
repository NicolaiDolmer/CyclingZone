import React from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AppProviders } from "./AppProviders.jsx";
import { initSentry } from "./lib/sentry.jsx";
import { installChunkReloadHandlers } from "./lib/chunkErrors.js";
import { captureFirstTouch } from "./lib/attribution.js";
import { BrowserRouter } from "react-router-dom";
import i18n from "./i18n";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

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

  // "/" serveres som prerendret landing (dist/index.html med markup i #root) →
  // hydrér oven på den, så hero/LCP allerede er malet før JS booter. Alle andre
  // ruter får den tomme app-shell (dist/app.html) → frisk createRoot.
  if (rootEl.firstElementChild) {
    hydrateRoot(rootEl, tree);
  } else {
    createRoot(rootEl).render(tree);
  }
})();
