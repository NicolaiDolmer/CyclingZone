// #6584 · Fanger browserens installations-mulighed, saa VI bestemmer tidspunktet.
//
// Chromium fyrer `beforeinstallprompt` tidligt. Vi kalder preventDefault (ingen
// mini-infobar ved foerste besoeg) og gemmer eventet, saa installTiming.ts kan
// tilbyde installationen paa et godt tidspunkt. iOS har intet event; dér er
// "installation" Del > Foej til hjemmeskaerm, og tilbuddet bliver en kort
// vejledning i stedet for en knap.
//
// Lytterne skal sidde FOER eventet fyrer, derfor installeres de synkront fra
// main.jsx (installPwa.ts) og ikke fra en lazy komponent.

import type { InstallPlatform } from "./installTiming.ts";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let onInstalledCallback: (() => void) | null = null;

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // En fejl i én lytter maa ikke stoppe de andre.
    }
  }
}

export function captureInstallPrompt(win: Window, onInstalled: () => void): void {
  onInstalledCallback = onInstalled;
  win.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  win.addEventListener("appinstalled", () => {
    deferred = null;
    onInstalledCallback?.();
    emit();
  });
}

export function hasDeferredPrompt(): boolean {
  return deferred !== null;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Viser browserens egen installations-dialog. Eventet kan kun bruges én gang. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  }
}

export interface PlatformEnv {
  userAgent: string;
  maxTouchPoints: number;
  hasDeferredPrompt: boolean;
}

/** iPhone/iPad (iPadOS melder sig som Mac, men med touch). */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function detectInstallPlatform(env: PlatformEnv): InstallPlatform {
  if (env.hasDeferredPrompt) return "prompt";
  if (isIosDevice(env.userAgent, env.maxTouchPoints)) return "ios";
  return "none";
}

/** Koerer vi allerede som installeret app? */
export function isStandalone(win: Window): boolean {
  try {
    if (win.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (win.matchMedia?.("(display-mode: minimal-ui)").matches) return true;
  } catch {
    // matchMedia utilgaengelig: falder tilbage til iOS-flaget nedenfor.
  }
  return (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** KUN til tests. */
export function __resetInstallPromptForTests(): void {
  deferred = null;
  listeners.clear();
  onInstalledCallback = null;
}
