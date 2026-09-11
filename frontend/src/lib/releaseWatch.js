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

import { documentIsStillLoadable } from "./chunkErrors.js";

export const RELEASE_ENDPOINT = "/version.json";

// Hoejst eet tjek pr. 60 s pr. fane, uanset hvor meget brugeren klikker rundt.
export const MIN_CHECK_INTERVAL_MS = 60_000;

// Tab-fokus tjekkes foerst naar fanen har ligget i baggrunden laengere end dette.
// Et hurtigt alt-tab er ikke et deploy-vindue.
export const BACKGROUND_THRESHOLD_MS = 5 * 60_000;

// Periodisk tjek mens fanen er SYNLIG. Uden det ville en bruger der bliver
// staaende paa samme side (fx en auktion) foerst opdage et deploy ved sin
// naeste navigation — og navigations-stien tjekker async EFTER routeren har
// committet, saa netop den navigation kan naa at hente et doedt chunk.
// Tjekket gaar gennem den samme 60 s-throttle som alle andre triggere.
export const PERIODIC_CHECK_INTERVAL_MS = 5 * 60_000;

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
 * false derefter.
 *
 * Fail-CLOSED uden brugbar storage (privat browsing, setItem/getItem kaster):
 * loop-guarden er det eneste der staar mellem os og en uendelig reload-ring.
 * `ctx.reloading`-flaget doer med page-loadet, saa det kan ikke baere guarden;
 * leverer reloadet ikke den nye release (CDN-skaevhed midt i et rollout),
 * ville et fail-OPEN svar genindlaese igen og igen. Samme valg som
 * `shouldAttemptChunkReload` i chunkErrors.js. Prisen ved fail-closed er at
 * lazyWithRetry bliver sikkerhedsnettet i stedet — den er billigere.
 */
export function claimReloadSlot(storage, targetRelease) {
  if (!storage) return false;
  const key = getReloadGuardKey(targetRelease);
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
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
 * Navigations-guard for reload-stien (#3602) — den samme kausale probe som
 * BEGGE eksisterende recovery-stier bruger (`documentIsStillLoadable` i
 * chunkErrors.js, delt med error-boundary'en i lib/sentry.jsx), ikke en kopi.
 *
 * Uden den kan et release-reload kapre en navigation brugeren allerede har
 * startet ("Navigation to /academy is interrupted by another navigation"):
 * et dokument der er paa vej vaek afviser nye fetches, og det er praecis det
 * probe'en spoerger om. Fail-closed: kan vi ikke bevise at dokumentet lever,
 * genindlaeser vi ikke, og markoeren bliver liggende til naeste rolige
 * oejeblik.
 *
 * Skal kaldes FOER `claimReloadSlot`, saa en afbrudt navigation ikke braender
 * det ene reload en senere, aegte ny release har brug for.
 */
export function canHardReload(win, { fetchFn, timeoutMs, timers } = {}) {
  const href = win?.location?.href;
  if (!href) return Promise.resolve(false);
  // Bindes: en loes fetch-reference kaldt uden `this` giver "Illegal invocation".
  const probe = fetchFn ?? (typeof win.fetch === "function" ? win.fetch.bind(win) : undefined);
  return documentIsStillLoadable({
    fetchFn: probe,
    url: href,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(timers === undefined ? {} : { timers }),
  });
}

/**
 * Samler hele beslutningen — tjek → er der en ny release → er det et roligt
 * oejeblik → reload — i én enhed, saa stien kan unit-testes uden en browser.
 * Hooken er derefter ren wiring.
 *
 * `pendingRelease` er markoeren: er en ny release foerst bevist, laver vi ikke
 * flere netvaerkskald, men venter blot paa et roligt oejeblik.
 */
export function createReleaseReloader({
  win,
  doc,
  storage,
  watcher,
  currentRelease,
  reload = hardReload,
  canReload = canHardReload,
} = {}) {
  const state = { pendingRelease: null, reloading: false };

  const attemptReload = async (target, trigger) => {
    if (state.reloading || !target) return false;
    if (!isSafeToReload(doc)) return false;
    // Navigations-guard FOER loop-guarden: en afbrudt navigation maa ikke
    // braende det ene reload denne release faar.
    if (!(await canReload(win))) return false;
    // Verden kan have aendret sig mens proben loeb.
    if (state.reloading || !isSafeToReload(doc)) return false;
    if (!claimReloadSlot(storage, target)) return false;
    state.reloading = true;
    rememberPendingTelemetry(storage, { from: currentRelease, to: target, trigger });
    reload(win);
    return true;
  };

  return {
    state,
    async runCheck(trigger) {
      if (state.reloading) return;
      if (state.pendingRelease) {
        await attemptReload(state.pendingRelease, trigger);
        return;
      }
      const result = await watcher?.check();
      if (result?.status !== "ok" || !result.isNew) return;
      state.pendingRelease = result.release;
      await attemptReload(result.release, trigger);
    },
  };
}

/**
 * Kobler de proaktive triggere paa og returnerer en cleanup-funktion.
 *
 * Triggere (alle gennem SAMME `runCheck`, og dermed samme 60 s-throttle):
 *   · `visibilitychange` → synlig igen efter mere end `backgroundThresholdMs`
 *   · `focus`/`pageshow` paa window — desktop-alt-tab aendrer ofte IKKE
 *     `visibilityState`, saa uden dem findes tab-fokus-stien reelt ikke paa
 *     desktop. `blur` starter baggrunds-uret i netop det tilfaelde.
 *   · et periodisk tjek mens fanen er synlig, saa et deploy fanges FOER
 *     brugerens naeste navigation.
 *
 * Dobbelt-tjek er udelukket ved konstruktion: den foerste handler nulstiller
 * `hiddenAt`, saa naar `visibilitychange` og `focus` fyrer sammen, ser nummer
 * to en baggrundstid paa 0 og gaar ikke videre.
 */
export function installReleaseWatchHandlers({
  target,
  doc,
  runCheck,
  now = () => Date.now(),
  timers,
  backgroundThresholdMs = BACKGROUND_THRESHOLD_MS,
  periodicIntervalMs = PERIODIC_CHECK_INTERVAL_MS,
} = {}) {
  if (!target?.addEventListener || !doc?.addEventListener) return () => {};

  const setTimer = timers?.set ?? ((fn, ms) => target.setInterval(fn, ms));
  const clearTimer = timers?.clear ?? ((handle) => target.clearInterval(handle));

  const isVisible = () => !doc.visibilityState || doc.visibilityState === "visible";

  // En fane der aabnes SKJULT (ctrl-klik i baggrunden) har ligget i baggrunden
  // siden mount. Med en fast 0 ville dens foerste fokus vaere "0 ms i
  // baggrunden" og tjekket aldrig ske.
  let hiddenAt = isVisible() ? 0 : now();

  const fire = (trigger) => {
    // Fejl i recovery-stien maa aldrig blive til en unhandledrejection —
    // chunkErrors.js' globale handler lytter paa netop dem.
    try {
      Promise.resolve(runCheck?.(trigger)).catch(() => {});
    } catch {
      // best-effort
    }
  };

  const markHidden = () => {
    if (!hiddenAt) hiddenAt = now();
  };

  const onReturn = () => {
    if (!isVisible()) return;
    const hiddenFor = hiddenAt ? now() - hiddenAt : 0;
    hiddenAt = 0;
    if (hiddenFor <= backgroundThresholdMs) return;
    fire("focus");
  };

  const onVisibilityChange = () => {
    if (!isVisible()) {
      markHidden();
      return;
    }
    onReturn();
  };

  const handle = setTimer(() => {
    // Aldrig i baggrunden: en skjult fane skal hverken bruge netvaerk eller
    // genindlaese sig selv under brugeren.
    if (!isVisible()) return;
    fire("interval");
  }, periodicIntervalMs);

  doc.addEventListener("visibilitychange", onVisibilityChange);
  target.addEventListener("focus", onReturn);
  target.addEventListener("pageshow", onReturn);
  target.addEventListener("blur", markHidden);

  return () => {
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    target.removeEventListener("focus", onReturn);
    target.removeEventListener("pageshow", onReturn);
    target.removeEventListener("blur", markHidden);
    clearTimer(handle);
  };
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
