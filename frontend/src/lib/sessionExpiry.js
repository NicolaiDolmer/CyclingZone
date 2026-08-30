// #4350 — appen opdagede ikke når serveren afviste sessionen.
//
// Kæden der logger en spiller ud FANDTES allerede i forvejen og virker:
//   SIGNED_OUT → App.jsx rydder session-state → ProtectedRoute sender til
//   /login?next=<deep-link>.
//
// Bugget er at kæden aldrig starter i netop dette tilfælde. supabase-js fyrer
// kun SIGNED_OUT når den SELV ved at sessionen er væk. Når serveren afviser et
// token som klienten lokalt stadig tror på — tilbagetrukket token, slettet
// bruger, tidsforskydning, eller AuthRetryableFetchError når fornyelsen ikke kan
// nå Supabase — sker der ingenting. Fanen bliver stående med frosne tal.
//
// Dette modul er ikke en ny udlognings-mekanik; det er den manglende DETEKTOR,
// der trækker i den snor der allerede er der.
//
// Bevidst fri for imports: modulet skal kunne unit-testes under Node's
// ESM-loader uden at trække den env-afhængige supabase-client (og en .ts-fil)
// ind — samme begrundelse som getAuthedUser.js (CLAUDE.md #803). Kaldstedet
// leverer derfor selv sessionens nuværende token.

/**
 * Træk det token ud som et `authHeaders()`-objekt faktisk sendte.
 *
 * @param {Record<string, string> | null | undefined} headers
 *   Returværdien fra `authHeaders()` i lib/supabase.ts — `null` når der ikke er
 *   nogen brugbar session.
 * @returns {string | null}
 */
export function tokenFromAuthHeaders(headers) {
  const raw = headers?.Authorization;
  if (typeof raw !== "string") return null;
  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : null;
  // #4347's fejlklasse: en død session interpolerede `session?.access_token`
  // som teksten "undefined" ind i Bearer-strengen. Den kanoniske authHeaders()
  // kan ikke længere producere det, men guarden er billig og gør returværdien
  // her ærlig uanset hvem der kalder.
  if (!token || token === "undefined" || token === "null") return null;
  return token;
}

/**
 * Afgør om et svar betyder "sessionen er død" — eller bare "det her svar er
 * forældet".
 *
 * Hele fixets vanskelighed ligger i den anden mulighed. supabase-js forny'r
 * tokens i baggrunden, så et kald kan nå at gå afsted med et token der udløber
 * mens det er undervejs. Serveren svarer korrekt 401, men sessionen er sund —
 * den har bare et nyt token nu. Logger vi ud på DEN 401, har vi byttet et bug
 * hvor spilleren ikke bliver logget ud, med et hvor han bliver logget ud uden
 * grund. Det sidste er værre.
 *
 * Reglen er derfor: en 401 gælder kun det token den blev sendt med. Er
 * sessionens token skiftet siden, kasserer vi svaret.
 *
 * 403 tæller bevidst ikke med: backendens `requireAuth` (routes/api.js) svarer
 * 401 udelukkende på afvist/manglende token, mens per-ressource-afvisning er
 * 403 via `requireAdmin`. En 403 betyder "du må ikke det her", ikke "du er ikke
 * dig".
 *
 * @param {object} args
 * @param {number} args.status        HTTP-status fra svaret.
 * @param {string | null} args.sentToken     Token'et kaldet gik afsted med.
 * @param {string | null} args.currentToken  Token'et i sessionen NU.
 * @returns {boolean}
 */
export function shouldDeclareExpired({ status, sentToken, currentToken }) {
  if (status !== 401) return false;
  // Ingen session tilbage at forny — så er 401'eren sandheden.
  if (!currentToken) return true;
  // Fornyet i mellemtiden: svaret gælder et token vi ikke bruger længere.
  if (sentToken && currentToken !== sentToken) return false;
  return true;
}

// ── Engangs-besked til login-siden ───────────────────────────────────────────
//
// Spilleren skal vide HVORFOR han pludselig står på login. Beskeden kunne have
// ligget i router-state (som #2078's link-fejl-banner), men redirectet udføres
// ikke af os: det er ProtectedRoute's <Navigate>, der udløses af at
// session-state bliver null. Vi ville altså skulle kapre et redirect vi ikke
// ejer, og kappes med det om at lande sidst.
//
// sessionStorage er immun over for den kapløbssituation og bevarer samtidig
// ProtectedRoute's ?next=-deep-link, som er hele grunden til at lade den
// eksisterende kæde køre. Flaget lever kun i fanen og forsvinder når den lukkes.
export const SESSION_EXPIRED_FLASH_KEY = "cz-session-expired";

function storageOrNull(storage) {
  // Prerender (entry-server.jsx) kører uden sessionStorage; en manglende besked
  // må aldrig vælte en side-render.
  if (storage) return storage;
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage;
}

/** Markér at spilleren blev logget ud fordi serveren afviste sessionen. */
export function markSessionExpired(storage) {
  const s = storageOrNull(storage);
  if (!s) return false;
  try {
    s.setItem(SESSION_EXPIRED_FLASH_KEY, "1");
    return true;
  } catch {
    // Private mode / kvote: beskeden udebliver, men udlogningen skal stadig ske.
    return false;
  }
}

// Læsning og rydning er MED VILJE to funktioner.
//
// Det oplagte design — én consume() der læser og rydder — er ubrugeligt her:
// React StrictMode dobbelt-kalder en useState-initializer netop for at afsløre
// urene initializere. En consume() i initializeren rydder derfor flaget i
// første kald og returnerer false i andet, og React beholder det andet. Banneret
// ville aldrig blive vist, og unit-testene ville stadig være grønne.
//
// Samme opdeling som authLinkError i LoginPage.jsx (#2078): læs ved mount, ryd
// i en useEffect.

/** Læs beskeden uden at ændre noget. Sikker at kalde flere gange. */
export function peekSessionExpiredFlash(storage) {
  const s = storageOrNull(storage);
  if (!s) return false;
  try {
    return s.getItem(SESSION_EXPIRED_FLASH_KEY) === "1";
  } catch {
    return false;
  }
}

/** Ryd beskeden, så et reload af /login ikke genopliver banneret. */
export function clearSessionExpiredFlash(storage) {
  const s = storageOrNull(storage);
  if (!s) return;
  try {
    s.removeItem(SESSION_EXPIRED_FLASH_KEY);
  } catch {
    /* private mode: intet at rydde */
  }
}

// ── Var det et svar, eller bare et manglende svar? ───────────────────────────
//
// Anden-kilde-opslaget mod Supabase har samme faldgrube som backendens 401
// havde før #4369: `user: null` betyder BÅDE "brugeren findes ikke" og "jeg
// kunne ikke nå Supabase til at spørge". supabase-js returnerer et tomt
// user-felt med en AuthRetryableFetchError ved netværksudfald i stedet for at
// kaste. (Backenden skelner nu selv - den svarer 503 auth_unavailable, som
// shouldDeclareExpired aldrig kalder en død session. Her i klienten står vi
// stadig med det rå getUser()-svar, så reglen nedenfor er uændret nødvendig.)
//
// Læses det tomme svar som en afvisning, logger et Supabase-udfald ALLE
// spillere ud. Det er værre end bugget vi fikser, og det er præcis den
// sammenblanding fixet handler om — den må ikke bare flytte ét lag ned.
//
// Derfor: kun et entydigt svar tæller. Ingen fejl (Supabase svarede, og der er
// ingen bruger) eller en ægte auth-afvisning (401/403). Alt andet — netværk,
// timeout, 5xx, ukendt — betyder "ved ikke", og "ved ikke" gør ingenting.
export function isDefinitiveAuthDenial({ user, error }) {
  if (user) return false;
  if (!error) return true;
  return error.status === 401 || error.status === 403;
}
