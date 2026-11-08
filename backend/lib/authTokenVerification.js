/**
 * #4369 — requireAuth svarede 401 i to helt forskellige situationer.
 *
 * `supabase.auth.getUser(token)` returnerer `error` BÅDE når tokenet er ægte
 * afvist (tilbagetrukket, udløbet, slettet bruger) og når backenden slet ikke
 * kunne få fat i Supabase til at spørge. Den gamle kode slog dem sammen:
 *
 *   const { data: { user }, error } = await supabase.auth.getUser(token);
 *   if (error || !user) return res.status(401).json({ error: "Invalid token" });
 *
 * De to tilstande betyder stik modsat. Den ene er en død session; den anden er
 * en rask spiller midt i et kortvarigt udfald. Da frontenden i #4350 begyndte
 * at HANDLE på en 401 (rydde sessionen og sende spilleren til login), blev
 * sammenblandingen farlig: et Supabase-udfald ville logge raske spillere ud.
 *
 * Modulet er bevidst uden imports — hverken supabase-js eller env. Det gør det
 * unit-testbart under Node's ESM-loader uden at trække hele HTTP-fladen ind
 * (samme begrundelse som frontendens sessionExpiry.js).
 *
 * Sikkerheds-note: "unavailable" giver ALDRIG adgang. Både 401 og 503 afviser
 * requestet; forskellen er kun hvad klienten må konkludere om sessionen.
 */

/** Distinkt fejlkode på 503, så klienten kan skelne uden at gætte. */
export const AUTH_UNAVAILABLE_ERROR = "auth_unavailable";

/** Kontrakten requireAuth svarer med, samlet ét sted så testene kan pinne den. */
export const AUTH_FAILURE_RESPONSES = {
  rejected: { status: 401, body: { error: "Invalid token" } },
  unavailable: { status: 503, body: { error: AUTH_UNAVAILABLE_ERROR } },
};

// Fejl-navne der ALDRIG er en afvisning af tokenet, uanset hvad de bærer af
// status. `AuthRetryableFetchError` er supabase-js's egen klasse for "kunne
// ikke nå frem" (den svarer med status 0 ved rent netværksudfald). De øvrige
// er de former undici/Node kaster igennem, når fetch fejler før et svar.
const UNREACHABLE_ERROR_NAMES = new Set([
  "AuthRetryableFetchError",
  "FetchError",
  "TypeError", // undici: "fetch failed"
  "AbortError",
  "TimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
]);

/**
 * Kort, log-sikker grund til afvisningen. Kun fejl-KODEN, aldrig token eller
 * header (hard rule: dump aldrig secret-værdier).
 *
 * @param {{ code?: string, name?: string } | null | undefined} error
 * @returns {string}
 */
export function authFailureReason(error) {
  return error?.code || error?.name || "no_user";
}

/**
 * Afgør hvad et `getUser()`-svar betyder.
 *
 * Reglen ved tvivl: svar "unavailable". At kalde et ægte dødt token for et
 * udfald koster spilleren et par fejlende kald, indtil han selv logger ud. At
 * kalde et udfald for et dødt token smider raske spillere ud. Kun den ene af
 * de to fejl er destruktiv, så al usikkerhed peger samme vej.
 *
 * @param {object} args
 * @param {object | null | undefined} args.user   `data.user` fra getUser().
 * @param {object | null | undefined} args.error  `error` fra getUser(), eller
 *   en exception kaldet kastede.
 * @returns {{ outcome: "authenticated" | "rejected" | "unavailable", reason: string }}
 */
export function classifyAuthFailure({ user, error }) {
  if (!error) {
    // Supabase svarede uden fejl. Så er fraværet af en bruger et entydigt svar.
    if (user) return { outcome: "authenticated", reason: "ok" };
    return { outcome: "rejected", reason: "no_user" };
  }

  const reason = authFailureReason(error);

  if (UNREACHABLE_ERROR_NAMES.has(error.name)) {
    return { outcome: "unavailable", reason };
  }

  const status = typeof error.status === "number" ? error.status : null;

  // 4xx = Supabase svarede, og svaret var "nej". Det er en ægte afvisning.
  if (status !== null && status >= 400 && status <= 499) {
    return { outcome: "rejected", reason };
  }

  // 5xx, status 0 (netværk) og alt uden en genkendelig status: vi ved det ikke.
  return { outcome: "unavailable", reason };
}

// ── #7663: lokalt login-tjek ────────────────────────────────────────────────
// Før kaldte hvert eneste request /auth/v1/user. Det er et netværkskald pr.
// request og gør Supabase Auth til et enkelt fejlpunkt. supabase-js' getClaims()
// verificerer et asymmetrisk signeret token (ES256/RS256) lokalt mod projektets
// offentlige nøgler (JWKS, som biblioteket selv henter og husker), og falder
// selv tilbage til /auth/v1/user for symmetrisk signerede tokens.
//
// Kun to udfald af det lokale tjek er endelige:
//  - gyldig signatur + ikke udløbet + ligner en bruger-session → authenticated
//  - AuthInvalidJwtError (udløbet, forkert signatur, ødelagt token) → rejected
// ALT andet (JWKS kunne ikke hentes, ukendt fejl, ingen getClaims på klienten,
// et token der ikke ligner en bruger-session) går videre til det gamle kald,
// så tvivl aldrig bliver til en afvisning den gamle sti ikke ville have givet.
//
// Bevidst afvejning: et lokalt tjek ser ikke en session der er logget ud eller
// en bruger der er slettet, før tokenet selv udløber. Det er prisen for at
// slippe for et kald pr. request, og den samme som Supabase selv anbefaler.

/** Fejl-navnet supabase-js bruger når selve tokenet er ugyldigt. */
const INVALID_JWT_ERROR_NAME = "AuthInvalidJwtError";

/**
 * Byg det bruger-objekt requireAuth sætter på `req.user` ud fra JWT-claims.
 * Nedstrøms bruges `id` (overalt) og `email` (billing); resten er med, så
 * formen ligner getUser()'s svar.
 *
 * @param {Record<string, any>} claims
 */
export function userFromClaims(claims) {
  return {
    id: claims.sub,
    email: claims.email ?? null,
    phone: claims.phone ?? null,
    role: claims.role ?? null,
    aud: claims.aud ?? null,
    app_metadata: claims.app_metadata ?? {},
    user_metadata: claims.user_metadata ?? {},
    is_anonymous: claims.is_anonymous === true,
  };
}

function looksLikeUserSession(claims) {
  return Boolean(claims)
    && typeof claims.sub === "string" && claims.sub.length > 0
    && claims.role === "authenticated";
}

/**
 * Forsøg lokal verifikation. Returnerer en afgørelse, eller null når den gamle
 * sti (getUser) skal spørges.
 *
 * @param {{ auth: { getClaims?: (token: string) => Promise<any> } }} authClient
 * @param {string} token
 * @returns {Promise<{ outcome: "authenticated" | "rejected", reason: string, user: object | null } | null>}
 */
export async function verifyBearerTokenLocally(authClient, token) {
  if (typeof authClient?.auth?.getClaims !== "function") return null;
  let result;
  try {
    result = await authClient.auth.getClaims(token);
  } catch {
    // catch-ok: lokal verifikation er en genvej, ikke sandheden. Kaster den
    // (fx WebCrypto eller en uventet algoritme), spørges /auth/v1/user som
    // før, og den sti klassificerer og logger selv sine fejl.
    return null;
  }
  const error = result?.error ?? null;
  if (error) {
    if (error.name === INVALID_JWT_ERROR_NAME) {
      return { outcome: "rejected", reason: authFailureReason(error), user: null };
    }
    // Netværk, JWKS-hentning, eller getClaims' egen getUser-fallback: lad den
    // gamle sti afgøre det, så klassifikationen er præcis som i dag.
    return null;
  }
  const claims = result?.data?.claims ?? null;
  if (!looksLikeUserSession(claims)) return null;
  return { outcome: "authenticated", reason: "ok", user: userFromClaims(claims) };
}

/**
 * Verificér et bearer-token og oversæt svaret til en afgørelse. Først lokalt
 * (#7663), ved tvivl mod /auth/v1/user.
 *
 * Exceptions fanges her: en kastet fejl fra fetch-laget er per definition
 * "kunne ikke spørge", og den må ikke blive til en 500 der ligner en bug i
 * vores egen kode.
 *
 * @param {{ auth: { getUser: (token: string) => Promise<any>, getClaims?: (token: string) => Promise<any> } }} authClient
 * @param {string} token
 * @returns {Promise<{ outcome: "authenticated" | "rejected" | "unavailable", reason: string, user: object | null }>}
 */
export async function verifyBearerToken(authClient, token) {
  const local = await verifyBearerTokenLocally(authClient, token);
  if (local) return local;
  return verifyBearerTokenRemotely(authClient, token);
}

/**
 * Den oprindelige sti: spørg /auth/v1/user (supabase-js getUser).
 *
 * @param {{ auth: { getUser: (token: string) => Promise<any> } }} authClient
 * @param {string} token
 */
export async function verifyBearerTokenRemotely(authClient, token) {
  let user = null;
  let error = null;
  try {
    const result = await authClient.auth.getUser(token);
    user = result?.data?.user ?? null;
    error = result?.error ?? null;
  } catch (e) {
    // catch-ok: fejlen sluges IKKE - den bliver klassifikationens input og
    // ender som en 503 med sin egen warn-linje i requireAuth. Intet Sentry-kald
    // her med vilje: et Supabase-udfald rammer hvert eneste request, så et
    // issue pr. forekomst ville være samme falske positiv som #4299.
    error = e;
  }

  const verdict = classifyAuthFailure({ user, error });
  return { ...verdict, user: verdict.outcome === "authenticated" ? user : null };
}
