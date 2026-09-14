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
// apiFetch.js), med én ekstra egenskab Layout.jsx's version ikke har: et
// modul-niveau lås, så et 401-bygefald kun afleverer "sessionen er død" ÉN
// gang, i stedet for at gentage anden-kilde-opslaget for hvert enkelt kald.
//
// ── Kontrakt ────────────────────────────────────────────────────────────────
//
// · Kun status 401 udløser noget. 403 er "du må ikke det her", ikke "du er
//   ikke dig" (samme skel som #4350) — kaldstedet skal selv vise en fejl for
//   403, guarden her rører den aldrig.
// · Samtidige 401'er deler ÉT opslag: den anden kalder får samme promise
//   igen, i stedet for at starte et nyt Supabase-opslag ved siden af.
// · Når sessionen ÉN gang er erklæret død, returnerer alle efterfølgende kald
//   `true` med det samme uden at spørge Supabase igen — det er selve kuren
//   mod 23x401-loopet, ikke bare en dedupe af det første kald.
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

let inFlight = null;
let sessionDeclaredExpired = false;

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
  if (sessionDeclaredExpired) return true; // allerede afgjort — spørg aldrig Supabase igen
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const c = client ?? (await import("./supabase")).supabase;
      const { data } = await c.auth.getSession();
      const expired = shouldDeclareExpired({
        status: res.status,
        sentToken: tokenFromAuthHeaders(sentHeaders),
        currentToken: data?.session?.access_token ?? null,
      });
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

      console.warn(`[auth] session rejected by BOTH sources (${source}) - clearing it`);
      sessionDeclaredExpired = true;
      markSessionExpired();
      await c.auth.signOut();
      return true;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Kun til tests: nulstil modulets tilstand mellem testcases. */
export function _resetForTests() {
  inFlight = null;
  sessionDeclaredExpired = false;
}
