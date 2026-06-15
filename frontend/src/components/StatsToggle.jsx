import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { STAT_KEYS, STAT_LABELS_MAP } from "./RiderFilters";

export default function StatsToggle({ visibleStats, onToggleStat, onShowAll, onHideAll }) {
  // Delt på tværs af sider (auktioner + rytterdatabase) → common-namespace.
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const count = visibleStats.size;
  const total = STAT_KEYS.length;
  const allVisible = count === total;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border whitespace-nowrap
          ${count > 0
            ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
            : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}
      >
        {t("controls.statsToggleButton")} {count > 0 && <span className="text-[11px] font-mono ms-1">({count}/{total})</span>}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-30 w-72 max-w-[calc(100vw-2rem)] bg-cz-card border border-cz-border rounded-cz shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-cz-2 text-xs uppercase tracking-wider font-semibold">{t("controls.statsToggleHeading")}</p>
            <button
              onClick={allVisible ? onHideAll : onShowAll}
              className="text-xs text-cz-accent-t hover:text-cz-1 transition-colors"
            >
              {allVisible ? t("controls.statsToggleHideAll") : t("controls.statsToggleShowAll")}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {STAT_KEYS.map(key => {
              const active = visibleStats.has(key);
              return (
                <button
                  key={key}
                  onClick={() => onToggleStat(key)}
                  className={`px-2 py-1.5 rounded text-xs font-mono font-medium transition-all border
                    ${active
                      ? "bg-cz-accent/15 text-cz-accent-t border-cz-accent/40"
                      : "bg-cz-subtle text-cz-3 border-cz-border hover:text-cz-1"}`}
                >
                  {STAT_LABELS_MAP[key]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
