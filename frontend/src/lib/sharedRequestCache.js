// sharedRequestCache — delt request-lag for GLOBALE GET-kald (#5089).
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// Railway-loggen 10/9 kl. 10:12 UTC viste flere hundrede 429'ere fra
// `api-baseline` paa fire millisekunder. Moenstret var 14 kald pr. rytterkort,
// og tre af dem var GLOBALE: `/api/deadline-day/status`, `/api/transfers` og
// `/api/scouting/me` svarer det samme uanset hvilken rytter der vises, men blev
// hentet forfra ved hver eneste profil-mount.
//
// Hooket her er bevidst IKKE et nyt state-lag: der er ingen React-context,
// ingen store og ingen abonnenter. Det er en ren memoisering af en loader-
// funktion med (a) in-flight-dedupe, saa N samtidige mounts deler EET svar, og
// (b) en kort TTL, saa en navigation mellem to rytterprofiler ikke koster et
// nyt kald. Komponenterne beholder deres egen useState praecis som foer.
//
// ── Kontrakt ────────────────────────────────────────────────────────────────
//
// · Kun successvar caches. Kaster loaderen, ryddes noeglen med det samme, saa
//   naeste kalder proever igen (en netvaerksfejl maa ikke fryse i cachen).
// · TTL'en er kort med vilje. Den daekker "samme klik-serie", ikke "resten af
//   sessionen" — enhver mutation der aendrer svaret SKAL kalde invalidate().
// · Ingen auth-viden her. Kalderen henter selv sine headers og bygger loaderen,
//   saa modulet kan unit-testes uden supabase-klienten (repoet har bevidst
//   ingen jsdom/loader — se App.authRestore.test.js m.fl.).

const DEFAULT_TTL_MS = 30_000;

/**
 * @param {{ now?: () => number }} [options] `now` injiceres i tests saa TTL kan
 *   verificeres uden at vente paa vaegur-tid.
 */
export function createRequestCache({ now = () => Date.now() } = {}) {
  /** @type {Map<string, { value: unknown, expiresAt: number }>} */
  const entries = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map();
  let hits = 0;
  let misses = 0;

  return {
    /**
     * Hent `key` fra cachen, ellers via `loader`. Samtidige kald paa samme
     * noegle deler EEN promise.
     */
    async get(key, loader, ttlMs = DEFAULT_TTL_MS) {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) {
        hits += 1;
        return cached.value;
      }
      const running = inflight.get(key);
      if (running) {
        hits += 1;
        return running;
      }
      misses += 1;
      const pending = (async () => loader())();
      inflight.set(key, pending);
      try {
        const value = await pending;
        entries.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      } catch (err) {
        // Fejl caches ALDRIG: den naeste kalder skal have lov at proeve igen.
        entries.delete(key);
        throw err;
      } finally {
        inflight.delete(key);
      }
    },

    /** Ryd EEN noegle. Kaldes efter mutationer der aendrer svaret. */
    invalidate(key) {
      entries.delete(key);
      inflight.delete(key);
    },

    /** Ryd alt (logud, holdskift, test-opsaetning). */
    clear() {
      entries.clear();
      inflight.clear();
    },

    /** Kun til tests og fejlsoegning. */
    stats() {
      return { hits, misses, size: entries.size };
    },
  };
}

// Delt instans for hele appen. Noeglerne nedenfor er de tre globale endpoints
// fra #5089 — hold dem samlet her, saa en invalidering ikke staver forkert.
export const sharedRequestCache = createRequestCache();

export const SHARED_KEYS = {
  deadlineDayStatus: "GET /api/deadline-day/status",
  transferListings: "GET /api/transfers",
  scoutingMe: "GET /api/scouting/me",
};

// TTL pr. endpoint. Deadline day skifter tilstand paa minut-skala, mens
// transferlisten kan aendres af spilleren selv (derfor kort TTL + eksplicit
// invalidate ved hver mutation i TransferListButton).
export const SHARED_TTL_MS = {
  deadlineDayStatus: 60_000,
  transferListings: 15_000,
  scoutingMe: 30_000,
};
