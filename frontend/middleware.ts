// #4067 — betinget forside-routing: en anonym besøgende på cyclingzone.org/
// skal se marketing-forsiden (bedre SEO, se #4067/#2824); en logget-ind spiller
// skal fortsat se app'en (der selv redirecter til /dashboard, jf. App.jsx).
//
// HVORFOR MIDDLEWARE OG IKKE EN vercel.json-REWRITE:
// frontend/vercel.json's rewrites-array kan IKKE bruges til dette — Vercels
// filsystem vinder altid over rewrites, og buildet emitter en literal
// dist/index.html (den prerenderede LandingPage) som ligger PRÆCIS på "/".
// Bekræftet empirisk på preview-deployet FØR denne fil eksisterede: en
// "missing cookie"-rewrite på source "/" i vercel.json blev aldrig ramt —
// samme Content-Length som den statiske index.html, uanset cookie. Routing
// Middleware kører derimod FØR filsystem-opslaget og kan derfor rent faktisk
// overstyre det.
//
// Cookien ("cz_session", ikke-følsom, sat/ryddet af frontend/src/lib/
// sessionCookie.js via App.jsx's onAuthStateChange) er den eneste
// session-signal Vercel-edgen har adgang til — selve Supabase-sessionen bor i
// localStorage, usynlig for edgen.
//
// INGEN @vercel/functions-afhængighed: pakken er ikke installeret i dette
// worktree, og npm install er forbudt her (delt junction-node_modules, hard
// rule 14). Derfor implementeret med rene Request/Response/fetch-primitiver:
// - cookie til stede → returnér ingenting (pass-through til normal Vercel-
//   routing, dvs. filsystemets index.html/app.html som i dag).
// - cookie mangler → proxy'er selv marketing-originens "/" ind, så URL'en i
//   browseren forbliver cyclingzone.org/.
const MARKETING_HOST = "cycling-zone-marketing.vercel.app";
const COOKIE_NAME = "cz_session";

export const config = { matcher: "/" };

export default async function middleware(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const hasSession = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=1(?:;|$)`).test(cookieHeader);
  if (hasSession) return;

  const incoming = new URL(request.url);
  const upstream = new URL(`https://${MARKETING_HOST}/`);

  const upstreamResponse = await fetch(upstream.toString(), {
    headers: {
      "x-forwarded-host": incoming.host,
      "x-forwarded-proto": "https",
      "user-agent": request.headers.get("user-agent") || "",
    },
  });

  // content-encoding/content-length hører til upstreams RÅ transport-svar;
  // fetch() har allerede dekomprimeret body'et, så de originale værdier ville
  // give et korrupt/afkortet svar i browseren.
  const headers = new Headers(upstreamResponse.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}
