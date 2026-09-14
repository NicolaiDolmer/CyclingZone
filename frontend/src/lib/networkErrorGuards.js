// networkErrorGuards — central 401-afvisning for klientens fetch-lag (#5089).
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// Railway-loggen viste en klient der hamrede 23 x 401 over to timer: hvert
// afvist kald blev behandlet isoleret, ingen huskede at sessionen allerede var
// erklæret død, så næste fetch (og den efter, og den efter...) startede hele
// anden-kilde-opslaget (#4350) forfra og forsøgte at logge ud igen.
//
// Layout.jsx har allerede sin egen kopi af nøjagtig dette mønster
// (`expireSessionIfRejected`, dækker heartbeat/presence/online-count) — den
// flyttes IKKE herind i denne PR (uden for lanens ejerskab, risiko for
// konflikt med andre samtidige baner — se PR'ens "Fund til opfoelger"). Dette
// modul er den samme kæde, tilgængelig for enhver ANDEN klient-fetch (fx
// apiFetch.js), med to egenskaber Layout.jsx's version ikke har:
//
//   1. Et lås PR. sendt token (ikke globalt): to samtidige 401'er for SAMME
//      token deler ét Supabase-opslag, men to samtidige 401'er for
//      FORSKELLIGE tokens (en gammel + en lige fornyet, begge undervejs da
//      fornyelsen skete) afgøres HVER for sig. Et globalt fælles lås ville
//      lade den gamle tokens "ikke udløbet"-konklusion smitte af på den nye
//      (CodeRabbit-fund, #5089).
//   2. Et sidste tjek AF SESSIONEN, lige før den destruktive handling
//      (markSessionExpired + signOut): getUser()-opslaget er et netværkskald
//      der kan tage tid, og sessionen kan nå at forny sig MENS det er
//      undervejs. Uden det sidste tjek ville en langsom bekræftelse af en
//      GAMMEL 401 kunne rydde en session der er blevet frisk i mellemtiden.
//
// · Sticky "allerede erklæret død"-tilstanden er bevidst GLOBAL (ikke pr.
//   token): når sessionen én gang er væk, er currentToken null uanset hvilket
//   (nu forældet) token en sen fetch blev sendt med — det er selve kuren mod
//   det sekventielle 23x401-loop, adskilt fra token-nøglet dedupe ovenfor.
// · `client` er injicérbar og default-clienten lazy-importeres (i stedet for
//   et top-niveau `import { supabase }`), så modulet kan unit-testes under
//   Node's ESM-loader uden den env-afhængige Supabase-client + .ts-fil —
//   nøjagtig samme mønster som getAuthedUser.js (CLAUDE.md #803).
// · Reset (`_resetForTests`) findes kun til unit-tests — i browseren
//   nulstiller et fuldt sideload (efter redirect til /login) tilstanden
//   naturligt.

import {
  tokenFromAuthHeaders,
  shouldDeclareExpired,
  isDefinitiveAuthDenial,
  markSessionExpired,
} from "./sessionExpiry.js";

/** @type {Map<string | null, Promise<boolean>>} sendt token -> igangværende afgørelse */
const inFlightByToken = new Map();

// undefined = intet afgjort endnu. Ellers: det `currentToken` (typisk `null`,
// "ingen session") vi sidst bekræftede var dødt — matcher et kalds
// currentToken stadig dette, er det den SAMME afgjorte episode, og vi spørger
// aldrig Supabase igen. Er strict equality-sammenligningen falsk (fx et NYT
// token efter et re-login), er det en frisk episode.
let expiredForToken;

/**
 * Aflever et 401-svar til session-rejected-kæden. Returnerer `true` når svaret
 * blev accepteret som en død session (udlogningen er sat i gang eller allerede
 * kørt) — kaldstedet skal IKKE vise en fejlkasse eller selv forsøge en retry i
 * så fald, kun lade den eksisterende ProtectedRoute-redirect tage over.
 *
 * @param {{ status: number }} res
 * @param {Record<string, string> | null | undefined} sentHeaders - headers
 *   kaldet blev sendt med (fra `authHeaders()`), bruges til at afgøre om 401'en
 *   gælder et token sessionen selv allerede har skiftet væk fra.
 * @param {string} source - kaldstedets navn, kun til logging.
 * @param {{ auth: { getSession: Function, getUser: Function, signOut: Function } }} [client]
 *   Supabase-client; injicérbar for test, default lazy-importeres.
 * @returns {Promise<boolean>}
 */
export async function reportUnauthorizedResponse(res, sentHeaders, source, client) {
  if (res.status !== 401) return false;

  const sentToken = tokenFromAuthHeaders(sentHeaders);
  const existing = inFlightByToken.get(sentToken);
  if (existing) return existing;

  const decision = (async () => {
    try {
      const c = client ?? (await import("./supabase.js")).supabase;
      const { data } = await c.auth.getSession();
      const currentToken = data?.session?.access_token ?? null;

      // Samme afgjorte episode som sidst (typisk: stadig ingen session efter en
      // tidligere signOut()) — den billige lokale getSession() afslører det
      // uden at skulle spørge Supabase's getUser() (netværkskald) igen.
      if (expiredForToken !== undefined && currentToken === expiredForToken) return true;

      const expired = shouldDeclareExpired({ status: res.status, sentToken, currentToken });
      if (!expired) return false;

      let denied;
      try {
        const { data: userData, error } = await c.auth.getUser();
        denied = isDefinitiveAuthDenial({ user: userData?.user ?? null, error });
      } catch {
        // Kunne slet ikke spørge — ved ikke, så gør ingenting (samme regel som #4350).
        return false;
      }
      if (!denied) {
        console.warn(
          `[auth] 401 from ${source}, but Supabase did not confirm it - leaving the session alone`,
        );
        return false;
      }

      // Sidste tjek FØR den destruktive handling (CodeRabbit-fund, #5089):
      // getUser() ovenfor er selv et netværkskald der tager tid, og sessionen
      // kan være blevet fornyet MENS det var undervejs. Uden dette ville en
      // langsomt bekræftet gammel 401 kunne rydde en session der nu er frisk.
      const { data: recheck } = await c.auth.getSession();
      const tokenNow = recheck?.session?.access_token ?? null;
      if (tokenNow !== currentToken) {
        console.warn(
          `[auth] 401 from ${source} confirmed dead, but the session renewed while checking - leaving it alone`,
        );
        return false;
      }

      console.warn(`[auth] session rejected by BOTH sources (${source}) - clearing it`);
      markSessionExpired();
      await c.auth.signOut();
      // Efter signOut() er sessionen væk — currentToken vil være `null` ved
      // næste kald, uanset hvad den var HER. Det er den tilstand vi låser mod.
      expiredForToken = null;
      return true;
    } finally {
      inFlightByToken.delete(sentToken);
    }
  })();

  inFlightByToken.set(sentToken, decision);
  return decision;
}

/** Kun til tests: nulstil modulets tilstand mellem testcases. */
export function _resetForTests() {
  inFlightByToken.clear();
  expiredForToken = undefined;
}
