import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import i18n from "./i18n";
import { AppProviders } from "./AppProviders.jsx";
import App from "./App.jsx";

// Prerender-entry (Node, build-time) — bruges af scripts/prerender.mjs til at
// generere den prerendrede landing i dist/index.html.
//
// Vi renderer det SAMME <App/> som klienten (main.jsx), bare med StaticRouter i
// stedet for BrowserRouter. Det er afgørende: hydration kræver at server- og
// client-træet er strukturelt identiske (samme komponent-dybde → samme useId
// osv.). På "/" har App ingen session endnu (getSession kører kun i en useEffect,
// som renderToString ikke eksekverer), så App renderer LandingPage — præcis som
// klientens første render gør.
//
// Renderes ÉN gang på engelsk (prerender.mjs → dist/index.html). Header-baseret
// per-sprog-servering er umulig: Vercels CDN cacher "/" på URL alene (ignorerer
// Accept-Language). En da-klient hydrerer derfor mod EN og skifter til sit sprog
// FØRST efter hydration (main.jsx's deferredLanguage → LanguageProvider mount-
// effect) — ellers ville klientens da-render mismatche EN-HTML'en (React
// #418/#422/#425, se .claude/learnings/2026-07-03-landing-hydration-lang-mismatch.md).
export async function render(url = "/", lng = "en") {
  if (i18n.language !== lng) {
    await i18n.changeLanguage(lng);
  }
  return renderToString(
    <AppProviders>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </AppProviders>
  );
}
