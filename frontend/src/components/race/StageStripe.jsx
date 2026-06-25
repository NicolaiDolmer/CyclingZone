import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey } from "../../lib/stageProfileConfig.js";

function MiniSilhouette({ profileType }) {
  const { points } = profileShape(profileType);
  return (
    <svg viewBox="0 0 100 24" className="w-full h-4 block" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// Klikbar etape-stribe — ét navigations-mønster på kommende OG kørte løb.
// stages.length < 2 og ingen overall → null (one-day: parent viser panelet direkte).
export default function StageStripe({ stages = [], activeStage, onSelect, times = null, showOverall = false }) {
  const { t } = useTranslation("races");
  if (stages.length < 2 && !showOverall) return null;

  return (
    <div className="flex gap-1.5">
      {showOverall && (
        <button
          type="button"
          onClick={() => onSelect("overall")}
          title={t("detail.tabOverall")}
          aria-label={t("detail.tabOverall")}
          aria-pressed={activeStage === "overall"}
          className={`flex-1 min-w-0 rounded-cz px-1.5 py-1.5 text-center border transition-colors
            ${activeStage === "overall" ? "border-cz-accent bg-cz-accent/[0.06]" : "border-cz-border bg-cz-card hover:bg-cz-subtle"}`}
        >
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${activeStage === "overall" ? "text-cz-accent-t" : "text-cz-2"}`}>
            {t("detail.tabOverall")}
          </span>
        </button>
      )}
      {stages.map((s) => {
        const n = s.stage_number ?? 1;
        const active = activeStage === n;
        const label = profileLabelKey(s.profile_type);
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(n)}
            title={label ? t(`detail.${label}`) : undefined}
            aria-label={t("detail.tabStage", { number: n })}
            aria-pressed={active}
            className={`flex-1 min-w-0 rounded-cz px-1.5 pt-1.5 pb-1 text-center border transition-colors
              ${active ? "border-cz-accent bg-cz-accent/[0.06]" : "border-cz-border bg-cz-card hover:bg-cz-subtle"}`}
          >
            <span className={active ? "text-cz-accent-t" : "text-cz-2"}>
              <MiniSilhouette profileType={s.profile_type} />
              <span className="block text-[10px] font-mono mt-0.5">{n}</span>
              {times?.[n]?.timeLabel && (
                <span className="block text-[9px] font-mono text-cz-3 leading-none">{times[n].timeLabel}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
