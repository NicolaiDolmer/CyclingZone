import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { readTour, advanceTour, endTour } from "../lib/onboardingTour";

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

  const isActive = !!tour && tour.page === pageKey && tour.step >= 0 && tour.step < steps.length;
  const current = isActive ? steps[tour.step] : null;

  const updateRect = useCallback(() => {
    if (!current) {
      setRect(null);
      return;
    }
    const target = document.querySelector(current.target);
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
    const target = document.querySelector(current.target);
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
      <div className="fixed bottom-4 right-4 z-50 bg-cz-card border border-cz-accent/40 rounded-xl shadow-xl p-3 max-w-xs">
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

  // Smart placering: under target hvis der er plads, ellers over
  const tooltipWidth = 300;
  const heightEstimate = 160;
  const margin = 12;
  const viewportH = window.innerHeight;
  const placeBelow = (rect.bottom + heightEstimate + margin) <= viewportH || rect.top < heightEstimate + margin;

  const tooltipTop = placeBelow ? rect.bottom + 12 : Math.max(margin, rect.top - heightEstimate - 12);
  const targetCenterX = rect.left + rect.width / 2;
  const tooltipLeft = Math.max(
    margin,
    Math.min(window.innerWidth - tooltipWidth - margin, targetCenterX - tooltipWidth / 2),
  );
  const arrowOffset = Math.max(20, Math.min(tooltipWidth - 20, targetCenterX - tooltipLeft));

  const isLast = tour.step + 1 >= steps.length;

  return (
    <>
      {/* Highlight-ring omkring target */}
      <div
        aria-hidden="true"
        className="fixed pointer-events-none z-40 rounded-lg ring-2 ring-cz-accent transition-all"
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
        className="fixed z-50 pointer-events-none"
        style={{
          left: tooltipLeft + arrowOffset - 8,
          top: placeBelow ? tooltipTop - 8 : tooltipTop + heightEstimate,
          width: 0,
          height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          [placeBelow ? "borderBottom" : "borderTop"]: "8px solid rgb(var(--accent))",
        }}
      />

      {/* Tooltip */}
      <div
        role="dialog"
        aria-label={t("onboardingTour.ariaLabel")}
        className="fixed z-50 bg-cz-card border border-cz-accent/40 rounded-xl shadow-xl p-4 pointer-events-auto"
        style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-cz-1 text-sm font-semibold flex items-center gap-1.5">
            <span className="text-cz-accent-t">▸</span>
            {current.title}
          </p>
          <span className="text-cz-3 text-[10px] font-mono flex-shrink-0">
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
            className="bg-cz-accent text-cz-on-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:brightness-110 transition-all"
          >
            {isLast ? t("onboardingTour.done") : t("onboardingTour.next")}
          </button>
        </div>
      </div>
    </>
  );
}
