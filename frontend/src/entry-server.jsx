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
// Renderes én gang pr. sprog (prerender.mjs → index.en.html + index.da.html).
// Vercel serverer den variant der matcher browserens Accept-Language, så en kold
// besøgende får sit sprog fra første maling — samme sprog som klientens i18n
// vælger (begge kommer fra browser-sproget) → ingen EN↔DA-flash.
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
