import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { ThemeProvider } from "./lib/theme.jsx";
import { ConsentProvider } from "./lib/consent.jsx";
import { LanguageProvider } from "./lib/language.jsx";
import { SentryBoundary } from "./lib/sentry.jsx";

// Delt provider-træ brugt af BÅDE client-entry (main.jsx) og prerender-entry
// (entry-server.jsx). At begge bruger nøjagtig samme wrapper-rækkefølge er det
// der gør hydration på den prerendrede landing-side ren — DOM'en under #root
// matcher 1:1 mellem server-render og klientens første render.
//
// Kun rene context-providers her — ingen side-effekter (initSentry,
// captureFirstTouch, chunk-reload-handlers). De hører til client-only boot i
// main.jsx og påvirker ikke markuppet, så de skal ikke køre under prerender.
export function AppProviders({ children }) {
  return (
    <SentryBoundary>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ConsentProvider>
            <LanguageProvider>{children}</LanguageProvider>
          </ConsentProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SentryBoundary>
  );
}
