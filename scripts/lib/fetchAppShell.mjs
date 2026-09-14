// Delt helper (#5251 runde 2): hent appens egen SPA-HTML fra en Cycling Zone-origin.
//
// Baggrund: frontend/middleware.ts (#4067, matcher "/") proxy'er anonyme besøg på "/"
// videre til marketing-sitet (cycling-zone-marketing.vercel.app) når klienten ikke
// sender markør-cookien `cz_session=1` (sat af frontend/src/lib/sessionCookie.ts ved
// login). Marketing-HTML'en har ingen /assets/*.js|css-referencer og intet
// <script type="module" src="/assets/index-*.js">, så et ægte anonymt GET "/" kan ikke
// længere bruges til at finde eller måle noget om appens egen build (#5239/#5251).
// Ethvert script der skal have fat i appens SPA-HTML — for at udtrække et hashet
// asset, entry-bundlen, osv. — skal derfor sende denne cookie med. Det får
// middleware.ts til at lade requesten passere igennem til filsystemets egen
// index.html/app.html, præcis som en logget-ind spiller oplever det.
//
// Kun "/" er ramt af middleware'ens matcher — et direkte GET på en konkret
// /assets/*-sti er ALDRIG proxy'et, og skal fortsat hentes helt anonymt (fx
// check-asset-miss-behaviour.mjs's rigtige-asset- og manglende-asset-probe).
//
// Scripts der bevidst vil måle den ÆGTE anonyme oplevelse på "/" (fx SPA-entry- og
// marketing-entry-cache-header-tjekket i check-cdn-cache-headers.mjs) skal IKKE bruge
// denne helper til det kald — brug almindelig fetch(url) uden cookie direkte.

export const APP_SHELL_COOKIE = "cz_session=1";

export function appShellHeaders(extraHeaders = {}) {
  return { cookie: APP_SHELL_COOKIE, ...extraHeaders };
}

// Henter en URL MED cz_session-cookien, så svaret er appens egen SPA-HTML i stedet for
// et anonymt besøgs marketing-proxy-svar på "/".
export async function fetchAppShell(url, init = {}) {
  return fetch(url, { ...init, headers: appShellHeaders(init.headers) });
}
