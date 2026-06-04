import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export const MAX_COMPARE = 3;

export function CompareToggle({ active, onToggle, disabled = false, className = "" }) {
  const { t } = useTranslation("common");
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      disabled={disabled && !active}
      title={active ? t("controls.compareRemove") : disabled ? t("controls.compareMax", { max: MAX_COMPARE }) : t("controls.compareSelect")}
      className={`text-base leading-none transition-all flex-shrink-0 px-1.5 py-0.5 rounded
        ${active ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40" : "text-cz-3 hover:text-cz-2 border border-transparent hover:border-cz-border"}
        ${disabled && !active ? "opacity-30 cursor-not-allowed" : ""}
        ${className}`}
    >
      ⇄
    </button>
  );
}

export function CompareBar({ ids, onClear }) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  if (ids.length === 0) return null;
  const canCompare = ids.length >= 2;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-cz-card border border-cz-accent/30
      rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3">
      <span className="text-cz-2 text-sm">
        <span className="text-cz-accent-t font-bold">{ids.length}</span>/{MAX_COMPARE} {t("controls.compareSelectedLabel")}
        {!canCompare && <span className="text-cz-3 text-xs ms-2">{t("controls.compareMinHint")}</span>}
      </span>
      <button onClick={() => navigate(`/compare?ids=${ids.join(",")}`)}
        disabled={!canCompare}
        className="px-3 py-1.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm
          hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
        {t("controls.compareButton")}
      </button>
      <button onClick={onClear}
        className="text-cz-3 hover:text-cz-2 text-xs px-2">{t("controls.clear")}</button>
    </div>
  );
}

