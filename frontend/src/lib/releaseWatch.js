// Lag 3 i chunk-fejl-forsvaret (#5033/#5159): opdag en NY frontend mens fanen er
// åben, og genindlæs på et dokumenteret SIKKERT punkt i stedet for at lade en
// client-side route hente et chunk der ikke findes længere.
//
// Baggrund (CYCLINGZONE-56, #4595): lag 1 er stabile chunk-navne (#4970, #5021,
// #5160/#5170), lag 2 er recovery EFTER fejlen (lazyWithRetry + chunkErrors.js).
// Begge lag er reaktive. Dette lag er proaktivt.
//
// Hvad #5159 ændrer i forhold til det første udkast (#5139), efter Codex-auditten
// 11/9 — hvert punkt er et målt fund, ikke en forsigtighedsregel:
//
//   B1  Automatisk reload må ALDRIG slette ugemt arbejde. `isSafeToReload` så kun
//       på det fokuserede element; en spiller der havde sat sit hold og flyttet
//       fokus væk, mistede udtagelsen når intervallet fyrede (reproduceret i
//       Chromium + WebKit). Beslutningen ligger nu i reloadGate.js, som siderne
//       selv melder ind til. Opdagelse fortsætter under en blokering; kun selve
//       genindlæsningen venter.
//   H3  Beslutningen tages så vidt muligt FØR routerens commit:
//       `installPendingNavigationInterceptor` fanger klik på interne links i
//       capture-fasen og laver et rigtigt dokument-load til DESTINATIONEN, i
//       stedet for at lade routeren committe og derefter reloade den gamle URL.
//   H4  "Ny release" er frontendens INDHOLDS-id (<meta name="cz-frontend">,
//       skrevet af vite-plugins/frontend-content-id.js), ikke Git-sha'en. Et
//       docs- eller backend-deploy ændrer sha'en uden at røre en eneste
//       frontend-fil og må ikke genindlæse nogen. Sha'en følger stadig med i
//       telemetrien, så et forløb kan spores.
//   M1  Et brugt reload-slot blokerer KUN sin egen målrelease. Polling
//       fortsætter, så C stadig opdages efter et forgæves forsøg på B. Et
//       `reloading`-flag udløber også igen, så en afvist forlad-dialog ikke
//       fryser watcheren resten af dokumentets levetid.
//   M2  Versionskaldet har sin egen AbortController-deadline der dækker BÅDE
//       svaret og body-læsningen, så et hængende kald ikke dræber detektionen.
//   M3  Reloadet trækker på det FÆLLES recovery-budget i chunkErrors.js, sammen
//       med boot-vagten og den globale fejlhandler. Er budgettet brugt, bliver
//       opdateringen til banneret med den manuelle knap.
//   M4  Telemetrien siger om reloadet faktisk LANDEDE på målreleasen.
//
// Fail-closed hele vejen: kan vi ikke BEVISE at der findes en ny frontend, sker
// der intet, og lazyWithRetry er stadig sikkerhedsnettet.

import {
  documentIsStillLoadable,
  hasRecoveryBudget,
  spendRecoverySlot,
} from "./chunkErrors.js";
import { isReloadAllowed, onReloadAllowed, getReloadBlockReasons } from "./reloadGate.js";

export const RELEASE_ENDPOINT = "/version.json";

// Højst ét tjek pr. 60 s pr. fane, uanset hvor meget spilleren klikker rundt.
export const MIN_CHECK_INTERVAL_MS = 60_000;

// Tab-fokus tjekkes først når fanen har ligget i baggrunden længere end dette.
// Et hurtigt alt-tab er ikke et deploy-vindue.
export const BACKGROUND_THRESHOLD_MS = 5 * 60_000;

// Periodisk tjek mens fanen er SYNLIG, så et deploy fanges før næste navigation.
export const PERIODIC_CHECK_INTERVAL_MS = 5 * 60_000;

// M2: hele versionskaldet — svar OG body — skal være færdigt inden for dette.
// Et kald der aldrig afslutter, må ikke koste hele dokumentets detektion.
export const VERSION_FETCH_TIMEOUT_MS = 8_000;

// M1: `location.assign()` melder ikke tilbage når spilleren afviser sidens egen
// forlad-dialog. Lever dokumentet stadig så længe efter, at vi bad om
// navigationen, skete den ikke — og watcheren skal arbejde videre.
export const RELOAD_SETTLE_MS = 10_000;

// Loop-guard-nøgle: højst ÉT automatisk reload pr. mål-frontend pr. session.
const RELOAD_GUARD_PREFIX = "cz:app-version-reload:";

// Telemetrien skal overleve selve navigationen: eventet skrives efter reloadet,
// fra den nye side, hvor der er tid til at nå Supabase.
export const PENDING_TELEMETRY_KEY = "cz:app-version-reload-pending";

// Frontendens indholds-id i den serverede HTML (H4). Samme mekanik som
// <meta name="cz-release">: kun HTML, aldrig en hashet asset.
export const FRONTEND_META_NAME = "cz-frontend";

// "dev" og "unknown" er release.js' fallbacks uden en sha. De kan ikke
// sammenlignes meningsfuldt, så de slår hele mekanikken fra.
const UNCOMPARABLE = new Set(["", "dev", "unknown"]);

export function isComparableRelease(release) {
  return typeof release === "string" && !UNCOMPARABLE.has(release.trim());
}

/** Sand KUN når begge sider er rigtige id'er OG de er forskellige. */
export function isNewRelease(current, next) {
  if (!isComparableRelease(current) || !isComparableRelease(next)) return false;
  return current.trim() !== next.trim();
}

const META_PATTERN = (name) =>
  new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");

/**
 * Frontendens indholds-id fra den HTML dokumentet blev serveret med.
 * Tom streng hvis tagget mangler (SSR, `node --test`, eller et deployment fra
 * før #5159) — og så er mekanikken slået fra, hvilket er det rigtige.
 */
export function readFrontendIdMeta(doc = typeof document === "undefined" ? undefined : document) {
  const content = doc?.querySelector?.(`meta[name="${FRONTEND_META_NAME}"]`)?.getAttribute?.("content");
  return typeof content === "string" ? content.trim() : "";
}

/**
 * Læser `/version.json` (`{"release":"<sha>","frontend":"<indholds-id>"}`).
 * Falder tilbage til meta-tags i HTML, så mekanikken også virker hvis
 * version.json mangler på et deployment og Vercel-rewriten svarer med app.html.
 * @returns {{release: string, frontendId: string}}
 */
export function parseVersionPayload(text) {
  if (typeof text !== "string" || text.trim() === "") return { release: "", frontendId: "" };
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        release: typeof parsed?.release === "string" ? parsed.release.trim() : "",
        frontendId: typeof parsed?.frontend === "string" ? parsed.frontend.trim() : "",
      };
    } catch {
      return { release: "", frontendId: "" };
    }
  }
  const release = trimmed.match(META_PATTERN("cz-release"))?.[1]?.trim() ?? "";
  const frontendId = trimmed.match(META_PATTERN(FRONTEND_META_NAME))?.[1]?.trim() ?? "";
  return { release, frontendId };
}

/**
 * Er dokumentet i en tilstand hvor et reload er usynligt for spilleren?
 *
 * Dette er KUN de mekaniske betingelser: fanen skal være synlig, og markøren må
 * ikke stå i et felt der lige nu skrives i. Spørgsmålet om ugemt ARBEJDE hører
 * ikke til her — det ejer reloadGate.js, fordi kun siderne selv ved det (B1).
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
 * Brænder loop-guarden for ÉN mål-frontend. Returnerer true første gang og
 * false derefter.
 *
 * Fail-CLOSED uden brugbar storage: loop-guarden er det eneste der står mellem
 * os og en uendelig reload-ring, hvis reloadet ikke leverer den nye HTML (fx
 * CDN-skævhed midt i et rollout). Samme valg som `shouldAttemptChunkReload`.
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
    // best-effort: målingen må aldrig stå i vejen for recovery.
  }
}

/**
 * Henter (og rydder) telemetrien fra FORRIGE page-load og afgør M4-udfaldet:
 * landede vi faktisk på den frontend vi ville hen til?
 *
 * @param {Storage|null} storage
 * @param {string} actualFrontendId frontend-id'et i den HTML vi kører NU.
 * @returns {{from: string, to: string, trigger: string, outcome: string, actual: string}|null}
 */
export function takePendingTelemetry(storage, actualFrontendId = "") {
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
    const to = typeof parsed.to === "string" ? parsed.to : "";
    if (!to) return null;
    const actual = typeof actualFrontendId === "string" ? actualFrontendId.trim() : "";
    return {
      from: typeof parsed.from === "string" ? parsed.from : "",
      to,
      fromSha: typeof parsed.fromSha === "string" ? parsed.fromSha : "",
      sha: typeof parsed.sha === "string" ? parsed.sha : "",
      trigger: typeof parsed.trigger === "string" ? parsed.trigger : "unknown",
      actual,
      // M4: eventet beviser kun en opdatering hvis den HTML vi kører nu, ER
      // målet. Ellers er sandheden "reload uden effekt" — præcis den tilstand
      // auditten reproducerede (A -> forsøg på B -> stadig A).
      outcome: actual && actual === to ? "arrived" : "no_effect",
    };
  } catch {
    return null;
  }
}

/**
 * Fuldt dokument-load af den URL spilleren allerede står på — det er hele
 * pointen: client-side navigation genbruger den gamle index.html's asset-graf.
 *
 * `assign()` til en URL der kun adskiller sig på fragmentet ville være en ren
 * scroll-navigation uden dokument-load, så URL'er med hash bruger reload().
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
 * BEGGE eksisterende recovery-stier bruger (`documentIsStillLoadable`), ikke en
 * kopi. Uden den kan et release-reload kapre en navigation spilleren allerede
 * har startet. Fail-closed.
 */
export function canHardReload(win, { fetchFn, timeoutMs, timers } = {}) {
  const href = win?.location?.href;
  if (!href) return Promise.resolve(false);
  // Bindes: en løs fetch-reference kaldt uden `this` giver "Illegal invocation".
  const probe = fetchFn ?? (typeof win.fetch === "function" ? win.fetch.bind(win) : undefined);
  return documentIsStillLoadable({
    fetchFn: probe,
    url: href,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(timers === undefined ? {} : { timers }),
  });
}

/**
 * Samler hele beslutningen — tjek -> er der en ny frontend -> er det et sikkert
 * punkt -> reload — i én enhed, så stien kan unit-testes uden en browser.
 *
 * `pendingRelease` er markøren: er en ny frontend først bevist, laver vi ikke
 * flere netværkskald for den, men venter på et sikkert punkt.
 */
export function createReleaseReloader({
  win,
  doc,
  storage,
  watcher,
  currentRelease,
  currentFrontendId,
  reload = hardReload,
  canReload = canHardReload,
  isAllowed = isReloadAllowed,
  subscribeAllowed = onReloadAllowed,
  blockReasons = getReloadBlockReasons,
  onUpdateReady,
  now = () => Date.now(),
  settleMs = RELOAD_SETTLE_MS,
} = {}) {
  const state = {
    /** mål-frontend vi venter på et sikkert punkt for, eller null */
    pendingRelease: null,
    /** sidste kendte nye frontend, også når dens slot er brugt (banner-målet) */
    lastTarget: null,
    lastTargetSha: "",
    reloading: false,
    reloadStartedAt: 0,
    /** mål-frontends hvis automatiske slot er brugt op (M1) */
    exhausted: new Set(),
    updateReady: false,
  };

  // M1: `reloading` er ikke et endeligt farvel. Afviser spilleren sidens egen
  // forlad-dialog, bliver dokumentet liggende, og et fastlåst flag ville betyde
  // at watcheren aldrig arbejdede igen. Lever vi stadig efter settle-vinduet,
  // skete navigationen ikke.
  const clearStaleReloading = () => {
    if (!state.reloading || now() - state.reloadStartedAt <= settleMs) return;
    state.reloading = false;
    // Reloadet skete ikke, og dets slot er brændt. Markøren må derfor ikke blive
    // liggende og sluge alle senere triggere — så ville C aldrig blive opdaget
    // efter et forgæves forsøg på B (M1). Banneret bliver stående, og den
    // throttlede polling fortsætter.
    if (state.pendingRelease) {
      state.exhausted.add(state.pendingRelease);
      state.pendingRelease = null;
    }
  };

  // Pr. MAAL, ikke pr. fane: bliver B udskudt og C deployet bagefter, er C et nyt
  // faktum der skal maales for sig. Med en ren "er banneret vist?"-gate ville C's
  // sha og blokerings-aarsager aldrig blive registreret (CodeRabbit, 11/9).
  let notifiedTarget = null;
  const markUpdateReady = (target, sha) => {
    state.lastTarget = target;
    state.lastTargetSha = sha || "";
    state.updateReady = true;
    if (notifiedTarget === target) return;
    notifiedTarget = target;
    try {
      onUpdateReady?.({ target, sha: sha || "", reasons: blockReasons() });
    } catch {
      // et UI-kald må aldrig vælte recovery-stien
    }
  };

  /**
   * @param {string} target mål-frontend-id
   * @param {string} trigger hvad der udløste forsøget (til telemetri)
   * @param {{manual?: boolean}} [opts] manual = spillerens eget klik på banneret.
   *   Det springer porten, budgettet og loop-guarden over: det er spillerens
   *   beslutning, ikke appens, og siden må gerne stille sin egen forlad-dialog.
   */
  const attemptReload = async (target, trigger, { manual = false } = {}) => {
    clearStaleReloading();
    if (state.reloading || !target) return false;
    if (!manual) {
      // B1: porten først. Er der ugemt arbejde, en åben dialog, en igangværende
      // skrivning eller en kørende afspilning, sker der INTET — markøren bliver
      // liggende, og `subscribeAllowed` vækker os når det sidste slip sker.
      if (!isAllowed()) return false;
      if (!isSafeToReload(doc)) return false;
      // M3: fælles budget på tværs af boot-vagt, fejlhandler og denne sti.
      if (!hasRecoveryBudget(storage)) return false;
    }
    // Kausal navigations-guard FØR loop-guarden: en afbrudt navigation må ikke
    // brænde det ene reload denne frontend får.
    //
    // KUN på den automatiske sti (CodeRabbit 11/9). Proben findes for ikke at
    // kapre en navigation spilleren allerede har startet — et klik på banneret
    // ER spillerens navigation, så der beskytter den ingenting. Til gengæld er
    // den fail-closed: er netværket nede eller kaldet blokeret, svarer den
    // false, og så ville knappen være et dødt klik uden en eneste besked.
    if (!manual && !(await canReload(win))) return false;
    // Verden kan have ændret sig mens proben løb.
    clearStaleReloading();
    if (state.reloading) return false;
    if (!manual && (!isAllowed() || !isSafeToReload(doc))) return false;
    if (!manual) {
      if (!claimReloadSlot(storage, target)) {
        // M1: netop DENNE mål-frontend har brugt sit automatiske forsøg. Det må
        // ikke stoppe fremtidige versionsopslag — ellers opdages C aldrig efter
        // et forgæves forsøg på B. Markøren ryddes, banneret bliver stående, og
        // den throttlede polling fortsætter.
        state.exhausted.add(target);
        state.pendingRelease = null;
        return false;
      }
      spendRecoverySlot(storage, "release-watch");
    }
    state.reloading = true;
    state.reloadStartedAt = now();
    rememberPendingTelemetry(storage, {
      from: currentFrontendId,
      to: target,
      // H4: Git-sha'en beholdes til fejlsporing, selv om BESLUTNINGEN er taget
      // på frontendens indholds-id.
      fromSha: currentRelease,
      sha: state.lastTargetSha,
      trigger: manual ? "manual" : trigger,
    });
    reload(win);
    return true;
  };

  const runCheck = async (trigger) => {
    clearStaleReloading();
    if (state.reloading) return;
    // Er porten aaben, er markøren alt vi har brug for: gør forsøget og spar
    // netværkskaldet.
    if (state.pendingRelease && isAllowed()) {
      await attemptReload(state.pendingRelease, trigger);
      return;
    }
    // Er porten LUKKET, bliver vi ved med at tjekke (throttlet), så markøren
    // følger med. Uden det kunne en spiller med ugemt arbejde stå med B som mål
    // længe efter at C var deployet, og både loop-guard-nøglen og telemetrien
    // ville pege på en release han aldrig kom til (CodeRabbit 11/9).
    const result = await watcher?.check();
    if (result?.status !== "ok") return;
    if (!result.isNew) {
      // Serveren kører den frontend vi allerede har: der er intet mål længere.
      state.pendingRelease = null;
      return;
    }
    const target = result.frontendId;
    markUpdateReady(target, result.release);
    // Allerede brugt automatisk? Så er banneret hele svaret; bliv ved med at
    // polle, så en senere frontend stadig kan opdages.
    if (state.exhausted.has(target)) return;
    state.pendingRelease = target;
    await attemptReload(target, trigger);
  };

  // Det sikre punkt: sidste blokering blev sluppet (Gem, Annullér, dialog lukket,
  // afspilning slut). Har vi en markør liggende, prøver vi igen med det samme.
  const unsubscribeAllowed = subscribeAllowed?.(() => {
    if (!state.pendingRelease) return;
    Promise.resolve(attemptReload(state.pendingRelease, "gate-released")).catch(() => {});
  });

  return {
    state,
    runCheck,
    /** Spillerens eget klik på "Update"-banneret. */
    applyUpdate() {
      const target = state.pendingRelease || state.lastTarget;
      return attemptReload(target, "manual", { manual: true });
    },
    /** Er der en ny frontend klar som spilleren kan tage når han vil? */
    isUpdateReady() {
      return state.updateReady;
    },
    dispose() {
      unsubscribeAllowed?.();
    },
  };
}

/**
 * H3 — beslutningen FØR routerens commit.
 *
 * Auditten: en spiller klikker på en side han ikke har besøgt før, lige efter et
 * deploy. React Router har allerede ændret ruten og kan have startet importen,
 * før et asynkront versionstjek overhovedet er begyndt. Et versionsopslag kan
 * ikke rette det bagefter.
 *
 * Derfor: når vi ALLEREDE ved at der er en ny frontend, fanger vi klikket på et
 * internt link i CAPTURE-fasen — altså før routerens egen handler — og laver et
 * rigtigt dokument-load til DESTINATIONEN. Spilleren får den side han klikkede
 * på, hentet fra det nye deployment, uden mellemliggende reload af den gamle.
 *
 * Ingen kausal probe her: vi kaprer ikke en navigation, vi ER navigationen.
 * Porten (B1) gælder uændret — er der ugemt arbejde, rører vi ikke klikket, og
 * routeren håndterer det som altid.
 *
 * Hverken loop-guarden eller recovery-budgettet bruges her, og det er med vilje
 * (CodeRabbit 11/9): interceptoren laver ikke et EKSTRA sideskift, den ændrer
 * kun ét som spilleren allerede har bedt om, fra blødt til hårdt. Der er derfor
 * ingen ring at guarde imod. Havde vi brændt loop-guarden her, ville en side der
 * har en `beforeunload`-vagt UDEN at registrere en reloadGate-blokering kunne
 * stjæle det ene reload en senere, ægte ny release har brug for, hver gang
 * spilleren fortrød i browserens forlad-dialog. Budgettet læses (er det brugt
 * op, er hele det automatiske lag slået fra), men debiteres ikke.
 *
 * Loftet er i stedet per DOKUMENT og kun i hukommelsen: leverer et hårdt
 * sideskift ikke den nye frontend (CDN-skævhed midt i et rollout), skal fanen
 * ikke blive ved med at lave fulde dokument-loads resten af sessionen. Tælleren
 * dør med dokumentet, så den kan ikke efterlade noget bag sig.
 *
 * Resterende race (ærligt): et deploy der sker i selve klikket, eller en
 * navigation startet på andre måder (programmatisk `navigate()`, browserens
 * tilbage-knap), fanges ikke. Der er lazyWithRetry stadig sikkerhedsnettet.
 */
export const MAX_INTERCEPTED_NAVIGATIONS = 3;

export function installPendingNavigationInterceptor({
  doc,
  win,
  getTarget,
  storage,
  isAllowed = isReloadAllowed,
  maxPerDocument = MAX_INTERCEPTED_NAVIGATIONS,
  onIntercept,
} = {}) {
  if (!doc?.addEventListener || !win) return () => {};
  let intercepted = 0;

  const onClick = (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    const target = anchor.getAttribute?.("target");
    if (target && target !== "_self") return;
    if (anchor.hasAttribute?.("download")) return;
    const href = anchor.href;
    const origin = win.location?.origin;
    if (typeof href !== "string" || !origin || !href.startsWith(origin)) return;
    // Ren hash-navigation på samme side er en scroll, ikke en sideskift.
    const current = win.location?.href ?? "";
    if (href.split("#")[0] === current.split("#")[0]) return;

    const pending = getTarget?.();
    if (!pending) return;
    if (!isAllowed()) return;
    if (intercepted >= maxPerDocument) return;
    // Kun LÆST: se hovedkommentaren for hvorfor der hverken brændes loop-guard
    // eller budget her.
    if (!hasRecoveryBudget(storage)) return;
    intercepted += 1;

    event.preventDefault();
    try {
      onIntercept?.(pending, href);
    } catch {
      // telemetri må ikke stoppe navigationen
    }
    win.location.assign?.(href);
  };

  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}

/**
 * Kobler de proaktive triggere på og returnerer en cleanup-funktion.
 *
 * Triggere (alle gennem SAMME `runCheck`, og dermed samme 60 s-throttle):
 *   · `visibilitychange` -> synlig igen efter mere end `backgroundThresholdMs`
 *   · `focus`/`pageshow` på window — desktop-alt-tab ændrer ofte IKKE
 *     `visibilityState`, så uden dem findes tab-fokus-stien reelt ikke på
 *     desktop. `blur` starter baggrunds-uret i netop det tilfælde.
 *   · et periodisk tjek mens fanen er synlig.
 *
 * Dobbelt-tjek er udelukket ved konstruktion: den første handler nulstiller
 * `hiddenAt`, så når `visibilitychange` og `focus` fyrer sammen, ser nummer to
 * en baggrundstid på 0 og går ikke videre.
 */
export function installReleaseWatchHandlers({
  target,
  doc,
  runCheck,
  hasPending,
  now = () => Date.now(),
  timers,
  backgroundThresholdMs = BACKGROUND_THRESHOLD_MS,
  periodicIntervalMs = PERIODIC_CHECK_INTERVAL_MS,
} = {}) {
  if (!target?.addEventListener || !doc?.addEventListener) return () => {};

  const setTimer = timers?.set ?? ((fn, ms) => target.setInterval(fn, ms));
  const clearTimer = timers?.clear ?? ((handle) => target.clearInterval(handle));

  const isVisible = () => !doc.visibilityState || doc.visibilityState === "visible";

  // En fane der åbnes SKJULT (ctrl-klik i baggrunden) har ligget i baggrunden
  // siden mount. Med en fast 0 ville dens første fokus være "0 ms i baggrunden"
  // og tjekket aldrig ske.
  let hiddenAt = isVisible() ? 0 : now();

  const triggerCheck = (trigger) => {
    // Fejl i recovery-stien må aldrig blive til en unhandledrejection —
    // chunkErrors.js' globale handler lytter på netop dem.
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
    triggerCheck("focus");
  };

  const onVisibilityChange = () => {
    if (!isVisible()) {
      markHidden();
      return;
    }
    onReturn();
  };

  const handle = setTimer(() => {
    // Aldrig i baggrunden: en skjult fane skal hverken bruge netværk eller
    // genindlæse sig selv under spilleren.
    if (!isVisible()) return;
    triggerCheck("interval");
  }, periodicIntervalMs);

  // Det TREDJE sikre punkt, målt frem i browsertesten: porten kan åbne mens
  // markøren stadig står i feltet. Rydder spilleren et felt (eller gemmer med
  // tastaturet), slipper blokeringen i samme render hvor inputtet endnu har
  // fokus — og `isSafeToReload` afviser med rette. Uden dette lå markøren så
  // stille indtil næste navigation eller næste interval. Nu er "feltet mistede
  // fokus" også et sikkert punkt. Kun mens der ER en markør, så det koster
  // ingenting i det normale tilfælde.
  const onFocusOut = () => {
    if (!hasPending?.()) return;
    triggerCheck("focusout");
  };
  if (hasPending) doc.addEventListener("focusout", onFocusOut);

  doc.addEventListener("visibilitychange", onVisibilityChange);
  target.addEventListener("focus", onReturn);
  target.addEventListener("pageshow", onReturn);
  target.addEventListener("blur", markHidden);

  return () => {
    if (hasPending) doc.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    target.removeEventListener("focus", onReturn);
    target.removeEventListener("pageshow", onReturn);
    target.removeEventListener("blur", markHidden);
    clearTimer(handle);
  };
}

/**
 * Throttlet frontend-tjek. Ét kald pr. `minIntervalMs`, ét netværkskald ad
 * gangen, og et fejlet tjek brænder vinduet (ellers ville et dårligt netværk
 * give et kald pr. navigation).
 *
 * M2: hele kaldet — svar OG body-læsning — har en AbortController-deadline.
 * Uden den kunne én hængende forbindelse dræbe detektionen resten af dokumentets
 * levetid, fordi alle senere kald fik samme uafsluttede `inFlight`-promise.
 * `inFlight` frigives også når deadlinen rammer, så næste vindue henter igen.
 *
 * @returns {{check: (opts?: {force?: boolean}) => Promise<{status: string, release?: string, frontendId?: string, isNew?: boolean}>}}
 */
export function createReleaseWatcher({
  currentFrontendId,
  fetchFn,
  now = () => Date.now(),
  url = RELEASE_ENDPOINT,
  minIntervalMs = MIN_CHECK_INTERVAL_MS,
  timeoutMs = VERSION_FETCH_TIMEOUT_MS,
  timers,
  AbortCtor = typeof AbortController === "undefined" ? undefined : AbortController,
} = {}) {
  let lastCheckAt = -Infinity;
  let inFlight = null;

  const enabled = isComparableRelease(currentFrontendId) && typeof fetchFn === "function";
  const setTimer = timers?.set ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = timers?.clear ?? ((handle) => clearTimeout(handle));

  async function run() {
    const controller = AbortCtor ? new AbortCtor() : null;
    let handle;
    let timedOut = false;
    if (controller) {
      handle = setTimer(() => {
        timedOut = true;
        try {
          controller.abort();
        } catch {
          // best-effort
        }
      }, timeoutMs);
    }
    let text;
    try {
      const res = await fetchFn(url, {
        cache: "no-store",
        credentials: "same-origin",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res?.ok) return { status: "error" };
      // Body-læsningen er dækket af SAMME deadline: en server der sender
      // headers og så holder forbindelsen åben, hænger ellers her.
      text = await res.text();
    } catch {
      return { status: timedOut ? "timeout" : "error" };
    } finally {
      clearTimer(handle);
    }
    const { release, frontendId } = parseVersionPayload(text);
    // H4: sammenligningen sker på frontendens INDHOLD, ikke på Git-sha'en. Et
    // deployment fra før #5159 har intet indholds-id — så gør vi ingenting.
    if (!isComparableRelease(frontendId)) return { status: "unknown", release, frontendId };
    return {
      status: "ok",
      release,
      frontendId,
      isNew: isNewRelease(currentFrontendId, frontendId),
    };
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
