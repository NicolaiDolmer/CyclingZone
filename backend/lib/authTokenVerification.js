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

/**
 * Verificér et bearer-token mod Supabase og oversæt svaret til en afgørelse.
 *
 * Exceptions fanges her: en kastet fejl fra fetch-laget er per definition
 * "kunne ikke spørge", og den må ikke blive til en 500 der ligner en bug i
 * vores egen kode.
 *
 * @param {{ auth: { getUser: (token: string) => Promise<any> } }} authClient
 * @param {string} token
 * @returns {Promise<{ outcome: "authenticated" | "rejected" | "unavailable", reason: string, user: object | null }>}
 */
export async function verifyBearerToken(authClient, token) {
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
