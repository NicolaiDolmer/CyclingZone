import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { ConsentProvider } from "./lib/consent.jsx";
import { LanguageProvider } from "./lib/language.jsx";
import { initSentry, SentryBoundary } from "./lib/sentry.jsx";
import i18n from "./i18n";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

initSentry();

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
