// #6584 · Badge paa app-ikonet med antal ulaeste notifikationer (Badging API).
//
// Kilden er den SAMME taeller som navigationens Notifikationer-badge (Layout's
// `unread`, holdt korrekt paa tvaers af faner af notifications/unreadSync.js).
// Ingen ny forespoergsel, ingen ny sandhed: ikonet viser praecis det tal
// spilleren ser i menuen.
//
// Browsere uden API'et (Firefox, aeldre Safari) og ikke-installerede faner
// ignorerer kaldet; afviste promises sluges, fordi et manglende badge aldrig
// maa blive til en fejl i appen.
import { useEffect } from "react";

interface BadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

function defaultNavigator(): BadgeNavigator | null {
  return typeof navigator === "undefined" ? null : (navigator as unknown as BadgeNavigator);
}

/** Normaliserer til et heltal >= 0; alt ugyldigt bliver 0 (= ryd badget). */
export function normalizeBadgeCount(count: unknown): number {
  const n = typeof count === "number" ? count : Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Saetter (count > 0) eller rydder (count = 0) app-badget.
 * @returns "set" | "cleared" | "unsupported" (ingen fejl kastes nogensinde)
 */
export function syncAppBadge(count: unknown, nav: BadgeNavigator | null = defaultNavigator()): "set" | "cleared" | "unsupported" {
  if (!nav || typeof nav.setAppBadge !== "function" || typeof nav.clearAppBadge !== "function") return "unsupported";
  const n = normalizeBadgeCount(count);
  try {
    const op = n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge();
    if (op && typeof op.catch === "function") op.catch(() => {});
  } catch {
    return "unsupported";
  }
  return n > 0 ? "set" : "cleared";
}

/** Holder ikon-badget lig `count` og rydder det naar komponenten forsvinder (log ud). */
export function useAppBadge(count: number): void {
  useEffect(() => {
    syncAppBadge(count);
  }, [count]);
  useEffect(() => () => {
    syncAppBadge(0);
  }, []);
}
