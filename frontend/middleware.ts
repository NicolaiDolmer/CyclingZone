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
// sessionCookie.ts via App.jsx's onAuthStateChange) er den eneste
// session-signal Vercel-edgen har adgang til — selve Supabase-sessionen bor i
// localStorage, usynlig for edgen.
//
// INGEN @vercel/functions-afhængighed: pakken er ikke installeret i dette
// worktree, og npm install er forbudt her (delt junction-node_modules, hard
// rule 14). Derfor implementeret med rene Request/Response/fetch-primitiver:
// - cookie til stede → returnér ingenting (pass-through til normal Vercel-
//   routing, dvs. filsystemets index.html/app.html som i dag).
// - cookie mangler → proxy'er selv marketing-originens forside ind, så
//   URL'en i browseren forbliver cyclingzone.org/.
//
// #4067 ejer-rettelse 1 (14/9, PR #5239 16:16 UTC) — FALLBACK: fejler
// marketing-origin (netværksfejl, non-2xx) eller svarer den ikke inden for
// UPSTREAM_TIMEOUT_MS, skal forsiden passe igennem til appens egen landing
// (LandingPage.jsx) i stedet for en fejlside. "Returnér ingenting" er den
// samme pass-through-mekanik som når cookien allerede er sat.
//
// #4067 ejer-rettelse 2 — VIDERESEND QUERY-STRENGEN: UTM-parametre
// (?utm_source=…) på den indkommende request skal med videre til
// marketing-origin uændret, så GROWTH_STACK's kanalmåling på forsiden
// overlever proxy'en (uden dette ser marketing-sitet aldrig UTM'erne, og al
// kanaltrafik til "/" ville fejlagtigt tælle som "direct").
//
// #4067 ejer-rettelse 3 — SPROG: Accept-Language med "da" som FØRSTE
// præference (fx "da,en;q=0.9" eller "da-DK,da;q=0.9,en;q=0.8") ruter til
// marketing-sitets danske forside ("/da") i stedet for den engelske ("/").
// Bevidst simpel fortolkning af "da først" — det første sprog-tag i selve
// header-strengen, ikke en fuld q-værdi-vægtet sortering — da det er sådan
// browsere reelt sender headeren, og det er det ejeren bad om.
const MARKETING_HOST = "cycling-zone-marketing.vercel.app";
const COOKIE_NAME = "cz_session";
const UPSTREAM_TIMEOUT_MS = 2000;

export const config = { matcher: "/" };

function prefersDanish(acceptLanguage: string): boolean {
  const first = acceptLanguage.split(",")[0]?.trim().split(";")[0]?.trim().toLowerCase();
  return first === "da" || (first?.startsWith("da-") ?? false);
}

export default async function middleware(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const hasSession = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=1(?:;|$)`).test(cookieHeader);
  if (hasSession) return;

  const incoming = new URL(request.url);
  const acceptLanguage = request.headers.get("accept-language") || "";
  const upstreamPath = prefersDanish(acceptLanguage) ? "/da" : "/";
  const upstream = new URL(`https://${MARKETING_HOST}${upstreamPath}`);
  // Videresend UTM/øvrige query-parametre uændret, så GROWTH_STACK's
  // kanalmåling på forsiden overlever proxy'en (ejer-rettelse 2).
  upstream.search = incoming.search;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstream.toString(), {
      headers: {
        "x-forwarded-host": incoming.host,
        "x-forwarded-proto": "https",
        "user-agent": request.headers.get("user-agent") || "",
        ...(acceptLanguage ? { "accept-language": acceptLanguage } : {}),
      },
      signal: timeoutController.signal,
    });

    // Marketing-origin svarede, men med en fejl (5xx/4xx) — fald igennem til
    // appens egen landing i stedet for at vise marketingens fejlside videre
    // (ejer-rettelse 1).
    if (!upstreamResponse.ok) return;

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
  } catch {
    // Netværksfejl eller timeout (>UPSTREAM_TIMEOUT_MS) mod marketing-origin
    // — pass-through til appens egen landing i stedet for en fejlside
    // (ejer-rettelse 1).
    return;
  } finally {
    clearTimeout(timeoutId);
  }
}
