// #2009 + #7858 · Person-ikonet foran rytternavnet, rytterkortet og hoejreklik-menuen.
//
// Bygget ÉN gang og koblet paa RiderLink, saa det slaar igennem overalt hvor
// spillet viser et rytternavn (resultater, startlister, marked, trup, taktik).
// RiderLink kalder useRiderNameOverlay(id) og faar tre ting tilbage:
//   - icon:     et lille stroke-person-ikon (aldrig emoji) der staar til venstre for navnet.
//   - linkProps: hoejreklik/langt tryk/Shift+F10 paa navnet, og tastatur-fokus.
//   - overlays: kortet og menuen (portal), kun naar de er aabne.
//
// Adfaerd (ejer 7/11):
//   - Hover paa ikonet aabner kortet. Klik paa navnet aabner profilen som i dag.
//   - Klik paa ikonet fastlaaser kortet (det bliver staaende til Esc/luk/klik udenfor).
//   - Mobil: tryk paa ikonet aabner kortet som bundark; langt tryk paa navnet aabner menuen.
//   - Hoejreklik paa navnet eller paa raekken aabner menuen (kun valg der giver mening).
//
// Bag kontakten rider_hover_card (off | beta | on). Slukket = icon/overlays er
// null og linkProps er tom, saa RiderLink renderer praecis som foer.
//
// Kortet og menuen hentes foerst (lazy) naar en spiller aabner dem: RiderLink
// sidder paa naesten alle sider, og de fleste ser aldrig et kort.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, TouchEvent as ReactTouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { UserIcon } from "../ui/icons/index.jsx";
import { canHover } from "../../lib/riderHoverCardModel.ts";
import { isContextMenuKey } from "../../lib/riderContextMenuModel.ts";

export const RIDER_HOVER_CARD_FLAG_KEY = "rider_hover_card";

const RiderCardOverlay = lazy(() => import("../ui/RiderHoverCard.tsx").then((m) => ({ default: m.RiderCardOverlay })));
const RiderContextMenu = lazy(() => import("./RiderContextMenu.tsx"));

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 150;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const ROW_MENU_EVENT = "cz:rider-menu";

// ── Kontakten: ét abonnement for hele appen, ikke ét pr. navn ────────────────
// Klienten og flag-kaldet hentes dynamisk: RiderLink importeres af mange rene
// node-tests, og de skal ikke traekke supabase-klienten med ind.
type AuthClient = {
  getSession(): Promise<{ data: { session: { user?: { id?: string } } | null } }>;
  onAuthStateChange(cb: () => void): { data: { subscription: { unsubscribe(): void } } };
};
let authSubscribed = false;

async function flagDeps(): Promise<{ auth: AuthClient; fetchFlags: () => Promise<Record<string, boolean>> }> {
  const [{ supabase }, { fetchPlayerFeatureFlags }] = await Promise.all([
    import("../../lib/supabase.ts"),
    import("../../lib/playerFeatureFlags.js"),
  ]);
  return { auth: (supabase as unknown as { auth: AuthClient }).auth, fetchFlags: fetchPlayerFeatureFlags };
}

let enabledSnapshot = false;
let started = false;
let generation = 0;
const listeners = new Set<() => void>();

function setEnabled(next: boolean) {
  if (enabledSnapshot === next) return;
  enabledSnapshot = next;
  if (next) installRowMenuListener();
  for (const fn of listeners) fn();
}

async function refreshFlag() {
  const gen = ++generation;
  let deps: Awaited<ReturnType<typeof flagDeps>>;
  try {
    deps = await flagDeps();
  } catch {
    // catch-ok: uden klient er kontakten slukket (fail-safe som serverens flag).
    if (gen === generation) setEnabled(false);
    return;
  }
  if (!authSubscribed) {
    authSubscribed = true;
    // Ny session (ind-/udlogning): spoerg igen for den nye bruger (Codex P2 paa #7849).
    deps.auth.onAuthStateChange(() => { void refreshFlag(); });
  }
  let userId: string | null = null;
  try {
    const { data } = await deps.auth.getSession();
    userId = data?.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  // Kontakten er en beta-kontakt: uden login er den altid slukket.
  if (!userId) { if (gen === generation) setEnabled(false); return; }
  const flags = await deps.fetchFlags().catch(() => ({} as Record<string, boolean>));
  if (gen === generation) setEnabled(flags?.[RIDER_HOVER_CARD_FLAG_KEY] === true);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!started && typeof window !== "undefined") {
    started = true;
    void refreshFlag();
  }
  return () => { listeners.delete(cb); };
}

/** Er rytterkort og hoejreklik-menu taendt for den indloggede spiller? */
export function useRiderOverlaysEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabledSnapshot, () => false);
}

// ── Hoejreklik paa en hel raekke: ét lytter-punkt for hele siden ─────────────
// Raekken ved ikke hvilken rytter den viser, men navnet i den gør. Er der netop
// én rytter i raekken, sendes hoejreklikket videre til hans navn. Hoejreklik paa
// et andet link eller en knap i raekken beholder browserens egen menu.
let rowListenerInstalled = false;

export function riderLinkForRowMenu(target: Element | null): HTMLElement | null {
  if (!target) return null;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return null;
  const control = target.closest("a[href], button");
  if (control && !control.hasAttribute("data-rider-link")) return null;
  const row = target.closest("tr, [role='row'], [data-rider-row]");
  if (!row) return null;
  const links = Array.from(row.querySelectorAll<HTMLElement>("a[data-rider-link]"));
  const ids = new Set(links.map((a) => a.getAttribute("data-rider-link")));
  return ids.size === 1 ? links[0] : null;
}

function installRowMenuListener() {
  if (rowListenerInstalled || typeof document === "undefined") return;
  rowListenerInstalled = true;
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented || !enabledSnapshot) return;
    const link = riderLinkForRowMenu(e.target instanceof Element ? e.target : null);
    if (!link) return;
    e.preventDefault();
    link.dispatchEvent(new CustomEvent(ROW_MENU_EVENT, { detail: { x: e.clientX, y: e.clientY } }));
  });
}

// ── Det enkelte navn ─────────────────────────────────────────────────────────
type CardMode = "closed" | "hover" | "pinned" | "sheet";
type MenuState = { x: number; y: number; n: number } | null;
let menuSeq = 0;

function hoverDevice(): boolean {
  return canHover(typeof window === "undefined" ? null : window.matchMedia?.bind(window));
}

export type RiderNameOverlay = {
  enabled: boolean;
  icon: ReactNode;
  linkProps: Record<string, unknown>;
  overlays: ReactNode;
};

/**
 * @param riderId  rytterens id (null/undefined = intet kort, intet ikon)
 * @param name     navnet til menuens tilgaengelige titel (valgfri)
 */
export function useRiderNameOverlay(riderId: string | number | null | undefined, name?: string | null): RiderNameOverlay {
  const enabled = useRiderOverlaysEnabled();
  const id = riderId === null || riderId === undefined || riderId === "" ? null : String(riderId);
  const active = enabled && id !== null;

  const [mode, setMode] = useState<CardMode>("closed");
  const [menu, setMenu] = useState<MenuState>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressFired = useRef(false);

  const clearTimers = useCallback(() => {
    for (const ref of [openTimer, closeTimer, pressTimer]) {
      if (ref.current) clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const closeCard = useCallback(() => { clearTimers(); setMode("closed"); }, [clearTimers]);
  const keepOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMode((m) => (m === "hover" ? "closed" : m)), CLOSE_DELAY_MS);
  }, []);
  const openMenu = useCallback((x: number, y: number) => {
    clearTimers();
    setMode("closed");
    // Nyt nummer pr. aabning: menuen starter forfra, ogsaa efter et lukket skrivefelt (Codex-fund).
    setMenu({ x, y, n: ++menuSeq });
  }, [clearTimers]);

  // Hoejreklik paa raekken (sendt videre af lytteren ovenfor).
  useEffect(() => {
    const node = linkRef.current;
    if (!active || !node) return undefined;
    const onRowMenu = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      openMenu(detail?.x ?? 0, detail?.y ?? 0);
    };
    node.addEventListener(ROW_MENU_EVENT, onRowMenu);
    return () => node.removeEventListener(ROW_MENU_EVENT, onRowMenu);
  }, [active, openMenu]);

  const menuAt = useCallback((e: { clientX?: number; clientY?: number }) => {
    // Tastatur (Shift+F10) giver ingen musekoordinater: brug navnets placering.
    if (e.clientX || e.clientY) return { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    const r = linkRef.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.bottom } : { x: 0, y: 0 };
  }, []);

  const linkProps = useMemo(() => {
    if (!active) return {};
    return {
      ref: linkRef,
      "data-rider-link": id,
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const p = menuAt(e);
        openMenu(p.x, p.y);
      },
      onKeyDown: (e: ReactKeyboardEvent) => {
        if (!isContextMenuKey(e)) return;
        e.preventDefault();
        const p = menuAt({});
        openMenu(p.x, p.y);
      },
      // Langt tryk paa navnet (mobil). Android sender ogsaa contextmenu; begge
      // veje aabner den samme menu, saa det er ligegyldigt hvem der kommer foerst.
      onTouchStart: (e: ReactTouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        pressFired.current = false;
        pressStart.current = { x: t.clientX, y: t.clientY };
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => {
          pressFired.current = true;
          openMenu(t.clientX, t.clientY);
        }, LONG_PRESS_MS);
      },
      onTouchMove: (e: ReactTouchEvent) => {
        const t = e.touches[0];
        const s = pressStart.current;
        if (t && s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > LONG_PRESS_SLOP_PX && pressTimer.current) {
          clearTimeout(pressTimer.current);
          pressTimer.current = null;
        }
      },
      onTouchEnd: () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = null; },
      onTouchCancel: () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = null; },
      // Tastatur: navnet faar fokus (Tab) = kortet vises, som hover paa ikonet;
      // Enter aabner profilen som altid, Shift+F10 menuen (Codex-fund: ikonet
      // er kun til mus og touch). Kun synligt fokus, ikke et museklik.
      onFocus: (e: { currentTarget: Element }) => {
        let visible = false;
        try { visible = e.currentTarget.matches(":focus-visible"); } catch { visible = false; }
        if (!visible) return;
        keepOpen();
        if (openTimer.current) clearTimeout(openTimer.current);
        openTimer.current = setTimeout(() => { openTimer.current = null; setMode((m) => (m === "closed" ? "hover" : m)); }, OPEN_DELAY_MS);
      },
      onBlur: () => scheduleClose(),
      // Et langt tryk maa ikke ogsaa navigere til profilen bagefter.
      onClickCapture: (e: ReactMouseEvent) => {
        if (!pressFired.current) return;
        pressFired.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }, [active, id, menuAt, openMenu, keepOpen, scheduleClose]);

  const icon = active ? (
    <span
      ref={iconRef}
      aria-hidden="true"
      data-rider-card-icon=""
      // Ikonet sidder inde i linket: klik maa hverken navigere eller naa raekken.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimers();
        if (!hoverDevice()) { setMode("sheet"); return; }
        setMode((m) => (m === "pinned" ? "closed" : "pinned"));
      }}
      onMouseEnter={() => {
        if (!hoverDevice()) return;
        keepOpen();
        if (mode !== "closed" || openTimer.current) return;
        openTimer.current = setTimeout(() => { openTimer.current = null; setMode("hover"); }, OPEN_DELAY_MS);
      }}
      onMouseLeave={() => { if (hoverDevice()) scheduleClose(); }}
      // Mobil: et bredere trykfelt end selve ikonet, uden at flytte navnet.
      className="relative -my-1 me-1.5 inline-flex shrink-0 cursor-pointer items-center justify-center py-1 align-[-2px] text-cz-3 transition-colors hover:text-cz-accent-t before:absolute before:-inset-x-1.5 before:-inset-y-1 before:content-[''] pointer-coarse:before:-inset-2.5"
    >
      <UserIcon size={12} strokeWidth={2} />
    </span>
  ) : null;

  const overlays = active && id !== null && (mode !== "closed" || menu) ? (
    <Suspense fallback={null}>
      {mode !== "closed" && iconRef.current && (
        <RiderCardOverlay
          riderId={id}
          anchor={iconRef.current}
          variant={mode === "sheet" ? "sheet" : "popover"}
          pinned={mode === "pinned"}
          onEnter={keepOpen}
          onLeave={() => { if (mode === "hover") scheduleClose(); }}
          onClose={closeCard}
        />
      )}
      {menu && (
        <RiderContextMenu key={menu.n} riderId={id} name={name ?? null} point={menu} onClose={() => setMenu(null)} />
      )}
    </Suspense>
  ) : null;

  return { enabled: active, icon, linkProps, overlays };
}

/** Kun ikonet + kortet, til flader der viser et rytternavn uden RiderLink. */
export default function RiderNameIcon({ riderId, name }: { riderId: string | number | null | undefined; name?: string | null }) {
  const { t } = useTranslation();
  const { icon, overlays, enabled } = useRiderNameOverlay(riderId, name);
  if (!enabled) return null;
  return (
    <span className="inline-flex" title={t("common:riderHoverCard.showCard")}>
      {icon}
      {overlays}
    </span>
  );
}
