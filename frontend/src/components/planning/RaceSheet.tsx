// #7535 runde 3 · Mobil-arket (spec "Mobile"): paa en smal skaerm er loebslisten foerste skaerm, og et
// tryk paa et loeb aabner loebet som et bundark, der daekker ca. 90 % af skaermen. Arkets hoved har
// pile til forrige og naeste loeb; et vandret stryg paa hovedet goer det samme, og et stryg nedad
// lukker arket. Loebets navn staar i fuld laengde i hovedet (det brydes, det afkortes aldrig).
//
// Arket er en dialog (fokus fanges, Escape lukker) i appens egen modal-hoejde; siden bagved ruller ikke.
import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, ChevronLeftIcon, ChevronRightIcon, XIcon, useModalA11y, Portal } from "./primitives.ts";

const SWIPE = 60; // pixels: et bevidst stryg, ikke et tryk der rykker sig lidt

export default function RaceSheet({
  title,
  position,
  onPrev,
  onNext,
  onClose,
  children,
}: {
  title: string;
  /** "3 / 9": loebets plads i listen. */
  position: string | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("planning");
  const dialogRef = useModalA11y(onClose, true);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
    else if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onNext?.();
      else onPrev?.();
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-modal" data-testid="planning-race-sheet">
        <button type="button" aria-label={t("sheet.close")} className="absolute inset-0 h-full w-full bg-black/40" onClick={onClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="absolute inset-x-0 bottom-0 flex h-[90dvh] flex-col rounded-t-cz border-t border-cz-border bg-cz-body"
        >
          <header className="shrink-0 border-b border-cz-border bg-cz-card px-2 pb-2 pt-1.5" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div aria-hidden="true" className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-cz-3/40" />
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPrev?.()}
                disabled={!onPrev}
                aria-label={t("sheet.prev")}
                iconLeft={<ChevronLeftIcon size={16} aria-hidden="true" />}
              />
              <div className="min-w-0 flex-1 text-center">
                <h2 className="break-words text-[15px] font-semibold leading-snug text-cz-1" data-testid="planning-sheet-title">
                  {title}
                </h2>
                {position && <p className="font-data text-2xs tabular-nums text-cz-3">{position}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNext?.()}
                disabled={!onNext}
                aria-label={t("sheet.next")}
                iconLeft={<ChevronRightIcon size={16} aria-hidden="true" />}
              />
              <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("sheet.close")} iconLeft={<XIcon size={16} aria-hidden="true" />} />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
        </div>
      </div>
    </Portal>
  );
}
