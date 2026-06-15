import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { ConsentProvider } from "./lib/consent.jsx";
import { LanguageProvider } from "./lib/language.jsx";
import { initSentry, SentryBoundary } from "./lib/sentry.jsx";
import { getChunkReloadKey } from "./lib/chunkErrors.js";
import { captureFirstTouch } from "./lib/attribution.js";
import i18n from "./i18n";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

// Stale-chunk recovery: fires when a dynamic import fails after a deploy
// (before React's error boundary can intercept it). Reuses the same
// per-release sessionStorage key as the error boundary to prevent loops.
const _release = import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA;
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const key = getChunkReloadKey(_release);
  try {
    if (window.sessionStorage.getItem(key) === "1") return;
    window.sessionStorage.setItem(key, "1");
    window.location.reload();
  } catch {
    window.location.reload();
  }
});

initSentry();

// #679: snapshot first-touch acquisition source as early as possible — before any
// SPA navigation changes document.referrer. First visit wins; persisted at signup.
captureFirstTouch();

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
