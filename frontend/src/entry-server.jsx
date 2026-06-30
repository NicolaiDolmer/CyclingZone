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
// Prerender låses til EN (primært sprog). En EN-klient hydrerer 1:1; en
// DA-klient får en hurtig client-rerender af tekst-noderne (ingen layout-shift,
// da markuppet er identisk). LCP er allerede malet fra den prerendrede HTML.
export async function render(url = "/") {
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
  return renderToString(
    <AppProviders>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </AppProviders>
  );
}
