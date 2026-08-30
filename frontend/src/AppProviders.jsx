import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { ThemeProvider } from "./lib/theme.jsx";
import { UserProfileProvider } from "./lib/userProfile.jsx";
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
// `deferredLanguage` (valgfri) videresendes til LanguageProvider: main.jsx tvinger
// EN under landing-hydrationen og beder provideven skifte til den besøgendes
// faktiske sprog EFTER mount. Prerender-entry (entry-server.jsx) sender den ikke
// (undefined → null), så server-render og klientens hydrerings-render matcher 1:1.
//
// #3034: UserProfileProvider ligger OVER ConsentProvider/LanguageProvider —
// de to læser brugerens `users`-række (consent_preferences/language) fra dens
// context i stedet for hver at lave sit eget Supabase-opslag. Ren
// context-provider ligesom de andre (kun effekter, intet SSR-markup), så den
// er sikker at dele med prerender-entry'en.
export function AppProviders({ children, deferredLanguage = null }) {
  return (
    <SentryBoundary>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <UserProfileProvider>
            <ConsentProvider>
              <LanguageProvider deferredLanguage={deferredLanguage}>{children}</LanguageProvider>
            </ConsentProvider>
          </UserProfileProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SentryBoundary>
  );
}
