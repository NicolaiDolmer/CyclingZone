// RiderSwitcherBar — cykler rosteret for det VISTE hold (eget eller rival/AI)
// på den redesignede rytterprofil (#2000). Prev/next + keyboard ←/→.
//
// Prop-drevet: parent henter rosteret (rækkefølge = holdets trup) og giver
// nabo-rytterne + index/total. Sticky øverst (over tab-baren). Token-only.
// prefers-reduced-motion respekteres af de globale transition-tokens.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

// Kort navn: "F. Efternavn" (matcher prototypens ‹ L. Mørk / S. Beck ›).
function shortName(rider) {
  if (!rider) return "";
  const initial = rider.firstname ? `${rider.firstname[0]}. ` : "";
  return `${initial}${rider.lastname ?? ""}`.trim();
}

export default function RiderSwitcherBar({ prevRider, nextRider, teamName, index, total, onNavigate }) {
  const { t } = useTranslation("rider");

  // Keyboard ←/→ — kun når fokus ikke er i et input/textarea/select (så pile-
  // taster i et bud-/pris-felt ikke kaprer navigationen).
  useEffect(() => {
    function onKey(e) {
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "ArrowLeft" && prevRider) { e.preventDefault(); onNavigate?.(prevRider.id); }
      if (e.key === "ArrowRight" && nextRider) { e.preventDefault(); onNavigate?.(nextRider.id); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevRider, nextRider, onNavigate]);

  return (
    <div className="sticky top-0 z-sticky -mx-4 sm:mx-0 px-4 sm:px-3 py-2 bg-cz-elevated border-b border-cz-border flex items-center gap-3 mb-4 sm:rounded-cz">
      {/* Forrige */}
      <button
        onClick={() => prevRider && onNavigate?.(prevRider.id)}
        disabled={!prevRider}
        className="min-h-[44px] flex items-center gap-1.5 text-sm text-cz-2 hover:text-cz-1 disabled:opacity-30 disabled:cursor-default transition-colors min-w-0"
      >
        <span aria-hidden="true" className="text-cz-3">‹</span>
        <span className="truncate max-w-[7rem] sm:max-w-[10rem]">{shortName(prevRider)}</span>
      </button>

      {/* Midte: hold + index + hint */}
      <div className="flex-1 flex items-center justify-center gap-2.5 min-w-0">
        <span className="font-display uppercase tracking-[0.04em] text-cz-1 text-sm truncate">{teamName}</span>
        {index != null && total != null && (
          <span className="font-mono tabular-nums text-[11px] text-cz-2 bg-cz-body border border-cz-border px-2 py-0.5 rounded-cz-pill flex-shrink-0">
            {index} / {total}
          </span>
        )}
        <span className="hidden md:inline text-cz-3 text-[10px] uppercase tracking-[0.12em] font-semibold flex-shrink-0">
          {t("profile.switcher.hint")}
        </span>
      </div>

      {/* Næste */}
      <button
        onClick={() => nextRider && onNavigate?.(nextRider.id)}
        disabled={!nextRider}
        className="min-h-[44px] flex items-center gap-1.5 text-sm text-cz-2 hover:text-cz-1 disabled:opacity-30 disabled:cursor-default transition-colors min-w-0 justify-end"
      >
        <span className="truncate max-w-[7rem] sm:max-w-[10rem]">{shortName(nextRider)}</span>
        <span aria-hidden="true" className="text-cz-3">›</span>
      </button>
    </div>
  );
}
