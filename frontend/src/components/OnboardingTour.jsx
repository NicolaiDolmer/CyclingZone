import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { readTour, advanceTour, endTour } from "../lib/onboardingTour";
import { findVisibleTarget } from "../lib/onboardingTourTarget.js";
import { computeTooltipPlacement } from "../lib/onboardingTourPlacement.js";

// #3008: MobileQuickNav (fixed bund-nav, kun < md) er 56px høj — tooltip'en må
// ikke lægge sig bag den på mobil. Samme breakpoint som Tailwinds md:hidden.
const MOBILE_BOTTOM_NAV_HEIGHT = 56;
const MOBILE_BREAKPOINT = 768;
// Gæt brugt kun til placerings-beslutningen (over/under) FØR tooltip'en er målt
// første gang for et nyt trin — erstattes synkront af den faktiske højde (se
// useLayoutEffect-målingen nedenfor) inden browseren når at male noget.
const FALLBACK_HEIGHT_ESTIMATE = 160;

// Onboarding v2 Slice 1b — peg-pil-tooltip overlay.
// Mounted på de sider hvor tour-trin findes (RidersPage, AuctionsPage).
// Aktiveres når localStorage cz-onboarding-tour-step matcher pageKey.
//
// Props:
//   pageKey: "riders" | "auctions"
//   steps: [{ target: cssSelector, title, body }]

export default function OnboardingTour({ pageKey, steps }) {
  const { t } = useTranslation("auth");
  const [tour, setTour] = useState(() => readTour());
  const [rect, setRect] = useState(null);
  // #3008: målt tooltip-højde (synkron layout-læsning, se useLayoutEffect
  // nedenfor), erstatter et fast gæt der på 360px ikke stemte overens med den
  // faktiske, tekst-ombrudte højde.
  const [measuredHeight, setMeasuredHeight] = useState(null);

  const isActive = !!tour && tour.page === pageKey && tour.step >= 0 && tour.step < steps.length;
  const current = isActive ? steps[tour.step] : null;

  // Nulstil målingen når selve trinnet skifter (ny tekst → ny højde). Nøglen
  // er tour.step/tour.page, IKKE `current`-objektet — det er en ny reference
  // på hvert forældre-render for sider der ikke useMemo'er deres steps-array
  // (RidersPage/BoardPage), hvilket ellers ville nulstille målingen konstant.
  useEffect(() => {
    setMeasuredHeight(null);
  }, [tour?.step, tour?.page]);

  // #3008: mål tooltip'ens FAKTISKE renderede højde synkront efter hver commit
  // (useLayoutEffect kører FØR browseren maler noget), i stedet for at gætte.
  // getBoundingClientRect() er en synkron layout-læsning — virker uafhængigt
  // af om ResizeObserver/rAF bliver udskudt af browseren (fx baggrunds-faner).
  // Første render af et nyt trin bruger FALLBACK_HEIGHT_ESTIMATE til placerings-
  // beslutningen; denne effekt korrigerer straks til den rigtige højde, og
  // React når at committe den korrigerede position FØR første maling — ingen
  // synligt "hop". Kører ved hvert render mens tooltip'en er synlig (rect,
  // trin-tekst eller viewport kan alle ændre den reelle højde); no-op når
  // målingen allerede matcher (samme værdi ⇒ ingen ny render).
  const tooltipRef = useRef(null);
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const measured = el.getBoundingClientRect().height;
    if (measured && measured !== measuredHeight) {
      setMeasuredHeight(measured);
    }
    // Deps er bevidst bredere end det effekten selv læser: `rect` opdateres
    // hvert 250ms (target kan flytte sig/rewrappe pga. resize) og `current?.target`
    // ved trinskift, så en reel indholds-/layout-ændring altid udløser et nyt
    // måleforsøg — ikke kun når measuredHeight (den eneste variabel effekten
    // rent faktisk læser) selv ændrer sig.
  }, [rect, current?.target, measuredHeight]);

  const updateRect = useCallback(() => {
    if (!current) {
      setRect(null);
      return;
    }
    const target = findVisibleTarget(current.target);
    if (target) {
      setRect(target.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [current]);

  useEffect(() => {
    if (!current) {
      setRect(null);
      return;
    }
    // Scroll target ind i synet ved opstart af nyt step
    const target = findVisibleTarget(current.target);
    if (target?.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    updateRect();
    const id = setInterval(updateRect, 250);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, { passive: true });
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect);
    };
  }, [current, updateRect]);

  function handleNext() {
    const next = advanceTour();
    if (!next || next.step >= steps.length) {
      endTour();
      setTour(null);
    } else {
      setTour(next);
    }
  }

  function handleSkip() {
    endTour();
    setTour(null);
  }

  if (!isActive) return null;

  // Fallback: tour aktiv, men target ikke fundet (fx 0 aktive auktioner) — vis kun escape-knap
  if (!rect) {
    return (
      <div className="fixed bottom-4 right-4 z-overlay bg-cz-card border border-cz-accent/40 rounded-cz shadow-xl p-3 max-w-xs">
        <p className="text-cz-2 text-xs mb-2">
          {t("onboardingTour.fallback")}
        </p>
        <button
          onClick={handleSkip}
          className="text-cz-accent-t text-xs hover:underline font-medium"
        >
          {t("onboardingTour.end")}
        </button>
      </div>
    );
  }

  // Smart placering: under target hvis der er plads, ellers over. #3008: brug
  // den MÅLTE tooltip-højde når den findes (sat via useLayoutEffect ovenfor)
  // — kun allerførste render af et nyt trin (før layout-effekten har kørt)
  // falder tilbage til gættet. computeTooltipPlacement klemmer altid
  // resultatet ind i viewport minus mobilens bund-nav.
  const tooltipWidth = 300;
  const height = measuredHeight ?? FALLBACK_HEIGHT_ESTIMATE;
  const margin = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const bottomReserve = viewportW < MOBILE_BREAKPOINT ? MOBILE_BOTTOM_NAV_HEIGHT : 0;
  const { placeBelow, tooltipTop, tooltipLeft, arrowOffset } = computeTooltipPlacement({
    rect, height, viewportW, viewportH, tooltipWidth, margin, bottomReserve,
  });

  const isLast = tour.step + 1 >= steps.length;

  return (
    <>
      {/* Highlight-ring omkring target */}
      <div
        aria-hidden="true"
        className="fixed pointer-events-none z-overlay rounded-cz ring-2 ring-cz-accent transition-all"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }}
      />

      {/* Peg-pil — CSS-trekant pointing toward target */}
      <span
        aria-hidden="true"
        className="fixed z-overlay pointer-events-none"
        style={{
          left: tooltipLeft + arrowOffset - 8,
          top: placeBelow ? tooltipTop - 8 : tooltipTop + height,
          width: 0,
          height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          [placeBelow ? "borderBottom" : "borderTop"]: "8px solid rgb(var(--accent))",
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-label={t("onboardingTour.ariaLabel")}
        className="fixed z-overlay bg-cz-card border border-cz-accent/40 rounded-cz shadow-xl p-4 pointer-events-auto"
        style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-cz-1 text-sm font-semibold flex items-center gap-1.5">
            <span className="text-cz-accent-t">▸</span>
            {current.title}
          </p>
          <span className="text-cz-3 text-3xs font-mono flex-shrink-0">
            {tour.step + 1}/{steps.length}
          </span>
        </div>
        <p className="text-cz-2 text-xs leading-relaxed mb-3">{current.body}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleSkip}
            className="text-cz-3 hover:text-cz-1 text-xs px-2 py-1 transition-colors"
          >
            {t("onboardingTour.skip")}
          </button>
          <button
            onClick={handleNext}
            className="bg-cz-accent text-cz-on-accent px-3 py-1.5 rounded-cz text-xs font-bold hover:brightness-110 transition-all"
          >
            {isLast ? t("onboardingTour.done") : t("onboardingTour.next")}
          </button>
        </div>
      </div>
    </>
  );
}
