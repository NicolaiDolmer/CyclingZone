import { useEffect } from "react";
import { useTranslation } from "react-i18next";

// #2849 bølge 5c (T3-revision, ejer 24/7): hero'en er et kort igen, så
// switcheren skal matche RiderSwitcherBar's indrykkede sticky-kort-look —
// sticky, afrundet på sm+, edge-to-edge stribe på mobil, ingen keyline
// (guldlinjen bor på hero-kortet). Placeres OVER hero-kortet.
export default function StaffSwitcherBar({ current, roster, onNavigate }) {
  const { t } = useTranslation("staff");
  const idx = roster.findIndex((r) => r.id === current);
  const prev = idx > 0 ? roster[idx - 1] : null;
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : null;

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "ArrowLeft" && prev) { e.preventDefault(); onNavigate(prev.id); }
      if (e.key === "ArrowRight" && next) { e.preventDefault(); onNavigate(next.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onNavigate]);

  if (roster.length <= 1) return null;

  return (
    <div className="sticky top-0 z-sticky -mx-4 sm:mx-0 bg-cz-elevated border-b border-cz-border sm:border sm:rounded-cz mb-4">
      <div className="px-4 sm:px-3 py-2 flex items-center gap-3">
        {/* Forrige */}
        <button
          type="button"
          onClick={() => prev && onNavigate(prev.id)}
          disabled={!prev}
          className="min-h-[44px] flex items-center gap-1.5 text-sm text-cz-2 hover:text-cz-1 disabled:opacity-30 disabled:cursor-default transition-colors min-w-0"
        >
          <span aria-hidden="true" className="text-cz-3">‹</span>
          <span className="truncate max-w-[7rem] sm:max-w-[10rem]">{prev ? t(`roles.${prev.role}`) : ""}</span>
        </button>

        {/* Midte: index + total */}
        <div className="flex-1 flex items-center justify-center gap-2.5 min-w-0">
          <span className="font-mono tabular-nums text-2xs text-cz-2 bg-cz-body border border-cz-border px-2 py-0.5 rounded-cz-pill flex-shrink-0">
            {t("switcher.count", { index: idx + 1, total: roster.length })}
          </span>
        </div>

        {/* Næste */}
        <button
          type="button"
          onClick={() => next && onNavigate(next.id)}
          disabled={!next}
          className="min-h-[44px] flex items-center gap-1.5 text-sm text-cz-2 hover:text-cz-1 disabled:opacity-30 disabled:cursor-default transition-colors min-w-0 justify-end"
        >
          <span className="truncate max-w-[7rem] sm:max-w-[10rem]">{next ? t(`roles.${next.role}`) : ""}</span>
          <span aria-hidden="true" className="text-cz-3">›</span>
        </button>
      </div>
    </div>
  );
}
