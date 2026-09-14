// apiFetch — klientens centrale fetch-lag med Retry-After-respekt (#5089).
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// Railway-loggen 10/9 viste flere hundrede 429'ere på fire millisekunder —
// klienten fyrede simpelthen igen med det samme, selvom backenden allerede
// sender `Retry-After` (sekunder) + `retry_after_seconds` i JSON-kroppen på
// hver 429 (backend/lib/rateLimiters.js, standardHeaders draft-7). Der var
// ingen fælles fetch-indpakning der læste det svar — hvert kaldsted lavede sit
// eget bare `fetch()` og opdagede aldrig at serveren bad om at vente.
//
// Dette modul er IKKE et forsøg på at migrere hele appens ~100+ `fetch()`-
// kaldsteder på én PR (uden for lanens ejerskab og tidsramme, se PR'ens "Fund
// til opfoelger") — det er den genbrugelige indpakning en fremtidig migrering
// (eller nye kaldsteder) kan bruge, plus dens egen dækkende testsuite.
//
// ── Kontrakt ────────────────────────────────────────────────────────────────
//
// · Et 429 SÆTTER et vindue pr. url ("retry ikke før X"). Et NYT kald mod
//   SAMME url inden for vinduet rammer aldrig netværket — det får med det
//   samme `{ limited: true }` tilbage. Det er den "ingen automatiske retries
//   før vinduet er udløbet"-regel #5089 punkt 2 kræver, og det forhindrer helt
//   klasses byge fra 10/9 (14 kald der alle rammer det samme udløbne vindue).
// · `limited: true` er bevidst IKKE en fejl kaldstedet skal vise en fejlkasse
//   for — punkt 2's "stille backoff": et 429 der løses af at vente skal se ud
//   som "intet nyt endnu", ikke som en fejlmeddelelse.
// · Et 401 afleveres ÉN gang til networkErrorGuards' session-rejected-kæde
//   (#4350) og returneres som `{ unauthorized: true }` — aldrig retry'et her.
// · Alt andet (2xx, 4xx≠401/429, 5xx) sendes uændret videre; modulet opfinder
//   ingen ny fejlhåndtering for dem.

import { reportUnauthorizedResponse } from "./networkErrorGuards.js";

/** @type {Map<string, number>} url -> epoch ms hvor vinduet slutter */
const retryNotBefore = new Map();

/**
 * Læs Retry-After ud af et 429-svar. Backenden sender altid sekunder (heltal)
 * i BÅDE header og JSON-krop (rateLimiters.js), men headeren læses først, så
 * indpakningen ikke antager en bestemt kropsform for endpoints der en dag
 * svarer 429 uden JSON.
 *
 * @param {Response} res
 * @param {unknown} body
 * @returns {number | null} sekunder, eller null hvis intet brugbart tal fandtes.
 */
export function parseRetryAfterSeconds(res, body) {
  const header = res.headers?.get?.("Retry-After");
  if (header != null && header !== "") {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    // Retry-After MÅ ifølge HTTP-spec'en også være en dato — backenden gør det
    // aldrig i dag, men en fremtidig proxy/CDN-429 kunne. Konverter forsigtigt.
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
  }
  const bodySeconds = body?.retry_after_seconds;
  if (typeof bodySeconds === "number" && Number.isFinite(bodySeconds) && bodySeconds >= 0) {
    return bodySeconds;
  }
  return null;
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ now?: () => number, fetchImpl?: typeof fetch, source?: string, authClient?: object }} [ctx]
 *   `now`/`fetchImpl` injiceres i tests. `source` navngiver kaldstedet i
 *   401-loggen (networkErrorGuards) — default er url'en selv. `authClient`
 *   videresendes til networkErrorGuards (samme injektions-mønster, se der).
 * @returns {Promise<{ ok: boolean, status: number, data: unknown, limited?: boolean, unauthorized?: boolean, retryAt?: number }>}
 */
export async function apiFetch(url, options = {}, ctx = {}) {
  const { now = () => Date.now(), fetchImpl = fetch, source = url, authClient } = ctx;

  const blockedUntil = retryNotBefore.get(url);
  if (blockedUntil != null && blockedUntil > now()) {
    // Stille backoff (#5089 punkt 2): ingen netværkskald, ingen fejlkasse —
    // kaldstedet skal behandle dette som "intet nyt endnu", ikke som en fejl.
    return { ok: false, status: 429, limited: true, retryAt: blockedUntil, data: null };
  }

  const res = await fetchImpl(url, options);

  if (res.status === 401) {
    await reportUnauthorizedResponse(res, options.headers, source, authClient);
    // Ingen retry-loop (#5089 punkt 3): kaldstedet får et entydigt svar og skal
    // IKKE selv forsøge igen — session-rejected-kæden tager over (eller gjorde
    // det ikke, men så var 401'en ikke en død session, og en ny nu ville bare
    // gentage den samme afvisning).
    return { ok: false, status: 401, unauthorized: true, data: null };
  }

  if (res.status === 429) {
    let body = null;
    try {
      body = await res.clone().json();
    } catch {
      // Ikke-JSON eller tomt 429-svar — vinduet sættes stadig hvis headeren findes.
    }
    const seconds = parseRetryAfterSeconds(res, body);
    if (seconds != null) retryNotBefore.set(url, now() + seconds * 1000);
    return { ok: false, status: 429, limited: true, retryAt: retryNotBefore.get(url) ?? null, data: body };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Tomt/ikke-JSON svar (fx 204 No Content) — kaldstedet får data: null.
  }
  return { ok: res.ok, status: res.status, data };
}

/** Kun til tests: ryd alle aktive Retry-After-vinduer. */
export function _clearRetryWindowsForTests() {
  retryNotBefore.clear();
}
