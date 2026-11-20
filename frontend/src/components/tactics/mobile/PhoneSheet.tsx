// #8386 · Arket fra bunden på telefonen (ejer 17/11): holdets plan, "Chase the break?" og
// rytterens ark. Samme opbygning som planlægningens løbsark (#7535 RaceSheet): en dialog i
// appens modal-højde, fokus fanges, Escape og et stryg nedad lukker. Rytterens ark har pile
// til forrige/næste rytter (et vandret stryg på hovedet gør det samme), så arket aldrig
// skal lukkes for at nå den næste.
import { useRef, type ReactNode, type TouchEvent } from "react";
import { Portal as PortalJs, XIcon as XIconJs, ChevronLeftIcon as ChevronLeftIconJs, ChevronRightIcon as ChevronRightIconJs } from "../../ui/index.js";
import { useModalA11y as useModalA11yJs } from "../../../hooks/useModalA11y.js";

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean | "true" };
const Portal = PortalJs as unknown as (props: { children: ReactNode }) => ReactNode;
const XIcon = XIconJs as unknown as (props: IconProps) => ReactNode;
const ChevronLeftIcon = ChevronLeftIconJs as unknown as (props: IconProps) => ReactNode;
const ChevronRightIcon = ChevronRightIconJs as unknown as (props: IconProps) => ReactNode;
const useModalA11y = useModalA11yJs as unknown as (onClose: (() => void) | null, active?: boolean) => { current: HTMLDivElement | null };

const SWIPE = 60; // pixels: et bevidst stryg, ikke et tryk der rykker sig lidt

const ICON_BUTTON = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-1 hover:bg-cz-subtle disabled:cursor-not-allowed disabled:opacity-40";

export interface PhoneSheetProps {
  /** Dialogens tilgængelige navn. */
  label: string;
  /** Hovedets indhold (titel, "Rider 3 of 8"). */
  heading: ReactNode;
  onClose: () => void;
  closeLabel: string;
  /** Forrige/næste (rytterens ark); udelades for holdets ark. */
  nav?: { onPrev: (() => void) | null; onNext: (() => void) | null; prevLabel: string; nextLabel: string } | null;
  /** Fast linje i arkets bund (gem). */
  footer?: ReactNode;
  testId?: string;
  children: ReactNode;
}

export default function PhoneSheet({ label, heading, onClose, closeLabel, nav = null, footer = null, testId, children }: PhoneSheetProps) {
  const dialogRef = useModalA11y(onClose, true);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const p = e.changedTouches[0];
    if (!start || !p) return;
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (dy > SWIPE && Math.abs(dy) > Math.abs(dx)) onClose();
    else if (nav && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? nav.onNext : nav.onPrev)?.();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-modal" data-testid={testId}>
        <button type="button" aria-label={closeLabel} tabIndex={-1} className="absolute inset-0 h-full w-full bg-black/40" onClick={onClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-cz border-t border-cz-border bg-cz-card"
        >
          <header className="shrink-0 border-b border-cz-border px-3 pb-2.5 pt-1.5" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-cz-3/40" />
            <div className="flex items-center gap-2">
              {nav && (
                <button type="button" className={ICON_BUTTON} aria-label={nav.prevLabel} disabled={!nav.onPrev} onClick={() => nav.onPrev?.()}>
                  <ChevronLeftIcon size={16} aria-hidden="true" />
                </button>
              )}
              <div className="min-w-0 flex-1 text-center">{heading}</div>
              {nav && (
                <button type="button" className={ICON_BUTTON} aria-label={nav.nextLabel} disabled={!nav.onNext} onClick={() => nav.onNext?.()}>
                  <ChevronRightIcon size={16} aria-hidden="true" />
                </button>
              )}
              <button type="button" className={`${ICON_BUTTON} border-transparent bg-transparent`} aria-label={closeLabel} onClick={onClose}>
                <XIcon size={16} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">{children}</div>
          {footer && <div className="shrink-0 border-t border-cz-border px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
