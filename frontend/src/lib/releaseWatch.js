// Lag 3 i chunk-fejl-forsvaret (#5033): opdag en NY release mens fanen er aaben,
// og genindlaes roligt ved naeste navigation i stedet for at lade en client-side
// route hente et chunk der ikke findes laengere.
//
// Baggrund (CYCLINGZONE-56, #4595): lag 1 er stabile chunk-navne (#4970 + #5021),
// lag 2 er recovery EFTER fejlen (lazyWithRetry + chunkErrors.js). Begge lag er
// reaktive: de rydder op naar importen allerede er fejlet. Dette lag er proaktivt
// og fjerner selve vinduet, fordi et fuldt dokument-load henter en frisk
// index.html med de nye asset-URL'er.
//
// Kilden til sandhed er `/version.json`, som buildet skriver med SAMME sha som
// <meta name="cz-release"> (se `czVersionFilePlugin` i frontend/vite.config.js).
// Den ligger bevidst uden for /assets/, saa den ikke rammes af
// `immutable`-headeren, og hentes med `cache: "no-store"`.
//
// Fail-closed hele vejen: kan vi ikke BEVISE at der findes en ny release, sker
// der intet, og lazyWithRetry er stadig sikkerhedsnettet.

export const RELEASE_ENDPOINT = "/version.json";

// Hoejst eet tjek pr. 60 s pr. fane, uanset hvor meget brugeren klikker rundt.
export const MIN_CHECK_INTERVAL_MS = 60_000;

// Tab-fokus tjekkes foerst naar fanen har ligget i baggrunden laengere end dette.
// Et hurtigt alt-tab er ikke et deploy-vindue.
export const BACKGROUND_THRESHOLD_MS = 5 * 60_000;

// Loop-guard-noegle: hoejst ÉT reload pr. maal-release pr. session. Uden den
// kunne en klient der IKKE faar den nye HTML efter reloadet (fx en mellemliggende
// cache) blive ved med at genindlaese.
const RELOAD_GUARD_PREFIX = "cz:app-version-reload:";

// Telemetrien skal overleve selve navigationen: eventet skrives efter reloadet,
// fra den nye side, hvor der er tid til at naa Supabase.
export const PENDING_TELEMETRY_KEY = "cz:app-version-reload-pending";

// "dev" og "unknown" er release.js' fallbacks naar der ikke er en sha (dev-server
// eller et build uden VERCEL_GIT_COMMIT_SHA). De kan ikke sammenlignes
// meningsfuldt, saa de slaar hele mekanikken fra.
const UNCOMPARABLE = new Set(["", "dev", "unknown"]);

export function isComparableRelease(release) {
  return typeof release === "string" && !UNCOMPARABLE.has(release.trim());
}

/**
 * Sand KUN naar begge sider er rigtige release-id'er OG de er forskellige.
 * Enhver usikkerhed (tom, "dev", "unknown", ikke-streng) giver false.
 */
export function isNewRelease(current, next) {
  if (!isComparableRelease(current) || !isComparableRelease(next)) return false;
  return current.trim() !== next.trim();
}

const META_RELEASE_PATTERN =
  /<meta[^>]+name=["']cz-release["'][^>]*content=["']([^"']*)["']/i;

/**
 * Laeser release-id'et ud af et svar-body. Primaert `/version.json`
 * (`{"release":"<sha>"}`); faldet tilbage til <meta name="cz-release"> saa
 * mekanikken ogsaa virker hvis version.json mangler paa et deployment og
 * Vercel-rewriten derfor svarer med app.html.
 * @returns {string} release-id eller "" hvis intet kunne laeses.
 */
export function parseRelease(text) {
  if (typeof text !== "string" || text.trim() === "") return "";
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const release = parsed?.release;
      return typeof release === "string" ? release.trim() : "";
    } catch {
      return "";
    }
  }
  const match = trimmed.match(META_RELEASE_PATTERN);
  return match ? match[1].trim() : "";
}

/**
 * Maa vi genindlaese lige nu? Aldrig i baggrunden, og aldrig mens brugeren
 * skriver. Fokus paa et tekstfelt er det eneste signal vi har for "midt i
 * input", og det er praecist nok: reloadet sker ved navigation eller tab-fokus,
 * hvor et fokuseret felt betyder at der staar uafsendt tekst i det.
 */
export function isSafeToReload(doc) {
  if (!doc) return false;
  if (doc.visibilityState && doc.visibilityState !== "visible") return false;
  const el = doc.activeElement;
  if (!el) return true;
  if (el.isContentEditable) return false;
  const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  return !(tag === "input" || tag === "textarea" || tag === "select");
}

export function getReloadGuardKey(targetRelease) {
  return `${RELOAD_GUARD_PREFIX}${targetRelease || "unknown"}`;
}

/**
 * Braender loop-guarden for én maal-release. Returnerer true foerste gang og
 * false derefter. Uden storage (privat browsing) tillader vi forsoeget — den
 * kaldende hook har sin egen per-page-load-guard.
 */
export function claimReloadSlot(storage, targetRelease) {
  const key = getReloadGuardKey(targetRelease);
  try {
    if (!storage) return true;
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

export function rememberPendingTelemetry(storage, payload) {
  try {
    storage?.setItem(PENDING_TELEMETRY_KEY, JSON.stringify(payload));
  } catch {
    // best-effort: maalingen maa aldrig staa i vejen for recovery.
  }
}

/**
 * Henter (og rydder) telemetrien fra FOERRIGE page-load. Returnerer null hvis
 * der ikke ligger noget brugbart.
 */
export function takePendingTelemetry(storage) {
  let raw;
  try {
    raw = storage?.getItem(PENDING_TELEMETRY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    storage?.removeItem(PENDING_TELEMETRY_KEY);
  } catch {
    // best-effort
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const from = typeof parsed.from === "string" ? parsed.from : "";
    const to = typeof parsed.to === "string" ? parsed.to : "";
    if (!to) return null;
    return { from, to, trigger: typeof parsed.trigger === "string" ? parsed.trigger : "unknown" };
  } catch {
    return null;
  }
}

/**
 * Fuldt dokument-load af den URL brugeren allerede staar paa — det er hele
 * pointen: client-side navigation genbruger den gamle index.html's asset-graf.
 *
 * `assign()` til en URL der kun adskiller sig paa fragmentet ville vaere en ren
 * scroll-navigation uden dokument-load, saa URL'er med hash bruger reload().
 */
export function hardReload(win) {
  const href = win?.location?.href;
  if (!href) return;
  if (href.includes("#")) {
    win.location.reload?.();
    return;
  }
  win.location.assign?.(href);
}

/**
 * Throttlet release-tjek. Ét kald pr. `minIntervalMs`, ét netvaerkskald ad
 * gangen, og et fejlet tjek braender vinduet (ellers ville et daarligt netvaerk
 * give et kald pr. navigation).
 *
 * @returns {{check: (opts?: {force?: boolean}) => Promise<{status: string, release?: string, isNew?: boolean}>}}
 */
export function createReleaseWatcher({
  currentRelease,
  fetchFn,
  now = () => Date.now(),
  url = RELEASE_ENDPOINT,
  minIntervalMs = MIN_CHECK_INTERVAL_MS,
} = {}) {
  let lastCheckAt = -Infinity;
  let inFlight = null;

  const enabled = isComparableRelease(currentRelease) && typeof fetchFn === "function";

  async function run() {
    let text;
    try {
      const res = await fetchFn(url, { cache: "no-store", credentials: "same-origin" });
      if (!res?.ok) return { status: "error" };
      text = await res.text();
    } catch {
      return { status: "error" };
    }
    const release = parseRelease(text);
    if (!isComparableRelease(release)) return { status: "unknown", release };
    return { status: "ok", release, isNew: isNewRelease(currentRelease, release) };
  }

  return {
    async check({ force = false } = {}) {
      if (!enabled) return { status: "disabled" };
      if (inFlight) return inFlight;
      if (!force && now() - lastCheckAt < minIntervalMs) return { status: "throttled" };
      lastCheckAt = now();
      inFlight = run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
