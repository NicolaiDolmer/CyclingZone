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
// · En TRANSPORTFEJL (#5322) — DNS, TLS, ingen rute, blokeret af et filter —
//   returneres som `{ ok: false, status: 0, networkError: true }` i stedet for
//   at kaste. `status: 0` er den etablerede konvention for "intet HTTP-svar"
//   og kolliderer ikke med nogen HTTP-status. Kaldstedet kan dermed SKELNE
//   "vi nåede aldrig serveren" fra "serveren svarede en fejl" uden at fange
//   exceptions, og et kaldsted der IKKE skelner rammer stadig sin egen
//   `!res.ok`-gren, præcis som da fejlen blev kastet ind i dets catch (#5312).
// · Alt andet (2xx, 4xx≠401/429, 5xx) sendes uændret videre; modulet opfinder
//   ingen ny fejlhåndtering for dem.

import { reportUnauthorizedResponse, type AuthClientLike } from "./networkErrorGuards.ts";
import { apiUrl } from "./apiBase.ts";

/**
 * Det underliggende svar apiFetch selv har brug for — løst nok til at både
 * det ægte `fetch()`s `Response` og testenes duck-typede fakes opfylder det
 * uden cast ved kaldsstedet.
 */
export interface ApiFetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers?: { get?: (name: string) => string | null };
  json(): Promise<unknown>;
  clone(): ApiFetchResponseLike;
}

export type ApiFetchImpl = (url: string, options?: RequestInit) => Promise<ApiFetchResponseLike>;

export interface ApiFetchContext {
  /** injicérbart ur — tests kører uden det ægte. */
  now?: () => number;
  /** injicérbar fetch — default er browserens globale `fetch`. */
  fetchImpl?: ApiFetchImpl;
  /** navngiver kaldstedet i 401-loggen (networkErrorGuards); default er url'en selv. */
  source?: string;
  /** videresendes uændret til networkErrorGuards (samme injektions-mønster, se der). */
  authClient?: AuthClientLike;
}

export interface ApiFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  limited?: boolean;
  unauthorized?: boolean;
  retryAt?: number | null;
  /** #5322: true når kaldet aldrig nåede serveren (intet HTTP-svar overhovedet). */
  networkError?: boolean;
  /** #5322: den oprindelige exception fra `fetch()`, så logning/Sentry beholder den. */
  error?: unknown;
}

/** url -> epoch ms hvor vinduet slutter */
const retryNotBefore = new Map<string, number>();

/**
 * Læs Retry-After ud af et 429-svar. Backenden sender altid sekunder (heltal)
 * i BÅDE header og JSON-krop (rateLimiters.js), men headeren læses først, så
 * indpakningen ikke antager en bestemt kropsform for endpoints der en dag
 * svarer 429 uden JSON.
 *
 * `now` er et injicérbart ur (samme værdi apiFetch selv bruger til at sætte
 * vinduet) — uden det ville dato-grenen regne mod DET RIGTIGE ur selv når
 * kaldstedet kører med et fiktivt (CodeRabbit-fund, #5089).
 *
 * @returns sekunder, eller null hvis intet brugbart tal fandtes.
 */
export function parseRetryAfterSeconds(
  res: ApiFetchResponseLike,
  body: unknown,
  now: () => number = () => Date.now(),
): number | null {
  const header = res.headers?.get?.("Retry-After");
  if (header != null && header !== "") {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    // Retry-After MÅ ifølge HTTP-spec'en også være en dato — backenden gør det
    // aldrig i dag, men en fremtidig proxy/CDN-429 kunne. Konverter forsigtigt.
    // Math.ceil (ikke round): et vindue der rundes NED kan udløbe FØR den dato
    // serveren bad om at vente til — det bryder selve "ikke før X"-kontrakten.
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.ceil((dateMs - now()) / 1000));
  }
  const bodySeconds = (body as { retry_after_seconds?: unknown } | null | undefined)?.retry_after_seconds;
  if (typeof bodySeconds === "number" && Number.isFinite(bodySeconds) && bodySeconds >= 0) {
    return bodySeconds;
  }
  return null;
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
  ctx: ApiFetchContext = {},
): Promise<ApiFetchResult> {
  const { now = () => Date.now(), fetchImpl = fetch as ApiFetchImpl, source = url, authClient } = ctx;

  // #5322: en relativ sti ("/api/x") får backendens base sat foran; en færdig
  // url passerer uændret igennem. Retry-vinduet nøgles på den OPLØSTE url, så
  // "/api/x" og "<base>/api/x" er samme ressource og deler ét vindue.
  const resolvedUrl = apiUrl(url);

  const blockedUntil = retryNotBefore.get(resolvedUrl);
  if (blockedUntil != null && blockedUntil > now()) {
    // Stille backoff (#5089 punkt 2): ingen netværkskald, ingen fejlkasse —
    // kaldstedet skal behandle dette som "intet nyt endnu", ikke som en fejl.
    return { ok: false, status: 429, limited: true, retryAt: blockedUntil, data: null };
  }

  let res: ApiFetchResponseLike;
  try {
    res = await fetchImpl(resolvedUrl, options);
  } catch (error) {
    // #5322 — kaldet nåede ALDRIG serveren. `fetch()` afviser med en TypeError
    // ved DNS-, TLS-, rute- og filter-fejl, og hver browser har sin egen
    // ordlyd (se backendReachability.js). Den boble røg før urørt op til
    // kaldstedet, som ikke kunne skelne den fra en hvilken som helst anden
    // exception og derfor viste sin generiske fejlkasse — præcis det der
    // gjorde #5312 dyr.
    //
    // En AFBRYDELSE er ikke en transportfejl: den er kaldstedets egen
    // annullering (AbortController), og den skal blive ved med at kaste, så
    // en unmount'et komponent ikke render en "kan ikke nå serveren"-fejl.
    if ((error as { name?: string } | null)?.name === "AbortError") throw error;
    return { ok: false, status: 0, networkError: true, error, data: null };
  }

  if (res.status === 401) {
    await reportUnauthorizedResponse(
      res,
      options.headers as Record<string, string> | null | undefined,
      source,
      authClient,
    );
    // Ingen retry-loop (#5089 punkt 3): kaldstedet får et entydigt svar og skal
    // IKKE selv forsøge igen — session-rejected-kæden tager over (eller gjorde
    // det ikke, men så var 401'en ikke en død session, og en ny nu ville bare
    // gentage den samme afvisning).
    return { ok: false, status: 401, unauthorized: true, data: null };
  }

  if (res.status === 429) {
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      // Ikke-JSON eller tomt 429-svar — vinduet sættes stadig hvis headeren findes.
    }
    const seconds = parseRetryAfterSeconds(res, body, now);
    if (seconds != null) retryNotBefore.set(resolvedUrl, now() + seconds * 1000);
    return { ok: false, status: 429, limited: true, retryAt: retryNotBefore.get(resolvedUrl) ?? null, data: body };
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Tomt/ikke-JSON svar (fx 204 No Content) — kaldstedet får data: null.
  }
  return { ok: res.ok, status: res.status, data };
}

/** Kun til tests: ryd alle aktive Retry-After-vinduer. */
export function _clearRetryWindowsForTests(): void {
  retryNotBefore.clear();
}
