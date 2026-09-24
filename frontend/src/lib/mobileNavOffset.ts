// #5561: bundbjælkerne (samtykke, release, NPS) må aldrig ligge OVEN PÅ
// bundmenuen på mobil.
//
// Alle tre tegner som `fixed inset-x-0 bottom-...` i z-toast, og bundmenuen
// (MobileQuickNav) ligger i z-nav under dem. Uden et offset dækkede baren
// menuen, så Dashboard / Inbox / Market / Riders / My team ikke kunne trykkes,
// før baren var lukket eller besvaret.
//
// Menuen måler sin egen højde og skriver den som en CSS-variabel på <html>;
// bjælkerne bruger `bottom-[var(--cz-mobile-nav-offset,0px)]`. Højden MÅLES i
// stedet for at gentage 56 px: får menuen senere safe-area-padding, følger
// bjælkerne med. På desktop er menuen `md:hidden` (display:none), højden er 0,
// og bjælkerne står i bunden som før. Uden menu (landing, login, SSR) er
// variablen ikke sat, og fallbacken 0px gælder.

import { useLayoutEffect, type RefObject } from "react";

export const MOBILE_NAV_OFFSET_VAR = "--cz-mobile-nav-offset";

interface StyleTarget {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
  };
}

/** Højden som CSS-længde; negative, NaN og manglende tal bliver 0px. */
export function formatNavOffset(height: number | null | undefined): string {
  const safe = typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
  return `${Math.round(safe)}px`;
}

/** Skriv offsettet på roden (typisk document.documentElement). */
export function publishMobileNavOffset(root: StyleTarget, height: number | null | undefined): void {
  root.style.setProperty(MOBILE_NAV_OFFSET_VAR, formatNavOffset(height));
}

/** Fjern offsettet igen, fx når menuen afmonteres. */
export function clearMobileNavOffset(root: StyleTarget): void {
  root.style.removeProperty(MOBILE_NAV_OFFSET_VAR);
}

/**
 * Hold `--cz-mobile-nav-offset` lig med bundmenuens aktuelle højde. En
 * ResizeObserver fanger skift mellem mobil og desktop (display:none giver 0)
 * og en eventuel højdeændring; uden ResizeObserver måles der én gang.
 */
export function useMobileNavOffset(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const measure = () => publishMobileNavOffset(root, el.getBoundingClientRect().height);
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      clearMobileNavOffset(root);
    };
  }, [ref]);
}
