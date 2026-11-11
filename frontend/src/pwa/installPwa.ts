// #6584 · Indgangen fra main.jsx. Én funktion, kaldet synkront ved boot:
//
//   1. Lytter efter beforeinstallprompt/appinstalled MED DET SAMME (eventet
//      fyrer tidligt, og en lazy lytter ville misse det).
//   2. Registrerer /sw.js efter load + idle (serviceWorker.ts).
//   3. Noterer dagens besoeg for en logget-ind spiller og vurderer, efter
//      OFFER_DELAY_MS synlig tid, om installationen skal tilbydes
//      (installTiming.ts). Kun ved et ja hentes UI'et (lazy chunk).
//
// Ikon-badget er IKKE her: det kræver ulæst-tallet og bor derfor i Layout via
// useAppBadge (appBadge.ts), samme kilde som menuens badge.
//
// Alt er fail-closed: en fejl her maa aldrig kunne stoppe appens boot.
import {
  decideInstallOffer,
  readInstallState,
  recordDismissal,
  recordInstalled,
  recordVisit,
  writeInstallState,
  type InstallState,
} from "./installTiming.ts";
import {
  captureInstallPrompt,
  detectInstallPlatform,
  hasDeferredPrompt,
  isStandalone,
  subscribeInstallPrompt,
} from "./installPrompt.ts";
import { registerServiceWorker } from "./serviceWorker.ts";

// Spilleren skal have vaeret paa siden et ojeblik, saa tilbuddet aldrig er det
// foerste der sker naar appen aabner.
export const OFFER_DELAY_MS = 20_000;

/** Session presence only gates installation UX, never authorization. */
export { hasAuthCookie as hasSessionCookie } from '../lib/authLanding.ts';
import { hasAuthCookie, authStorageKey } from '../lib/authLanding.ts';

function safeLocalStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

let installed = false;

export function installPwa(win: Window = window): void {
  if (installed) return;
  installed = true;
  try {
    const storage = safeLocalStorage(win);
    const update = (fn: (state: InstallState) => InstallState) => {
      const current = readInstallState(storage);
      if (current) writeInstallState(storage, fn(current));
    };

    captureInstallPrompt(win, () => update(recordInstalled));
    registerServiceWorker(win);

    if (hasAuthCookie(win.document.cookie, authStorageKey(import.meta.env.VITE_SUPABASE_URL))) update((s) => recordVisit(s, Date.now()));

    let delayPassed = false;
    let mounted = false;
    const tryOffer = () => {
      if (mounted || !delayPassed || win.document.visibilityState !== "visible") return;
      const state = readInstallState(storage);
      if (!state) return;
      const platform = detectInstallPlatform({
        userAgent: win.navigator.userAgent,
        maxTouchPoints: win.navigator.maxTouchPoints ?? 0,
        hasDeferredPrompt: hasDeferredPrompt(),
      });
      const decision = decideInstallOffer(state, {
        now: Date.now(),
        platform,
        standalone: isStandalone(win),
        hasSession: hasAuthCookie(win.document.cookie, authStorageKey(import.meta.env.VITE_SUPABASE_URL)),
        pathname: win.location.pathname,
      });
      if (decision !== "offer" || platform === "none") return;
      mounted = true;
      import("./InstallPrompt.tsx")
        .then(({ mountInstallPrompt }) =>
          mountInstallPrompt(platform, (outcome) => {
            if (outcome === "accepted") update(recordInstalled);
            else if (outcome === "dismissed") update((s) => recordDismissal(s, Date.now()));
          }),
        )
        .catch(() => {
          // Chunk kunne ikke hentes (fx lige efter et deploy): proev ved naeste besoeg.
        });
    };

    win.setTimeout(() => {
      delayPassed = true;
      tryOffer();
    }, OFFER_DELAY_MS);
    subscribeInstallPrompt(tryOffer);
    win.document.addEventListener("visibilitychange", tryOffer);
  } catch {
    // PWA-laget er en bonus; appen skal boote uanset hvad.
  }
}
