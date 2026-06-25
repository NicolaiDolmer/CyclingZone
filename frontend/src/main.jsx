import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { ConsentProvider } from "./lib/consent.jsx";
import { LanguageProvider } from "./lib/language.jsx";
import { initSentry, SentryBoundary } from "./lib/sentry.jsx";
import { installChunkReloadHandlers } from "./lib/chunkErrors.js";
import { captureFirstTouch } from "./lib/attribution.js";
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
// kan afvente installeringen FØR createRoot uden top-level await i entry-modulet.
(async () => {
  if (import.meta.env.VITE_PREVIEW_MOCK) {
    const { installPreviewMock } = await import("./preview/installPreviewMock.js");
    installPreviewMock();
  }

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <SentryBoundary>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <ConsentProvider>
              <LanguageProvider>
                <App />
              </LanguageProvider>
            </ConsentProvider>
          </ThemeProvider>
        </I18nextProvider>
      </SentryBoundary>
    </React.StrictMode>
  );
})();
