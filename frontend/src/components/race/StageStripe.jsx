import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey } from "../../lib/stageProfileConfig.js";
import { hasRouteData } from "../../lib/stageRouteProfile.js";
import StageProfileGraph from "./StageProfileGraph.jsx";

// #1484-piktogrammet — bevares for etaper UDEN rutedata (S1/PCM-løb).
function LegacyMiniSilhouette({ profileType }) {
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
  // #4107 (ejer-låst 23/8): INGEN fælles y-loft mere — hver etape skalerer nu
  // til sin EGEN faste type-skala (stageRouteProfile.elevationScaleFor), det
  // er netop pointen ("en kort kat.2 ser kort ud, en HC ser lang ud" — også
  // side om side i striben her).
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
          <span className={`text-2xs font-semibold uppercase tracking-wide ${activeStage === "overall" ? "text-cz-accent-t" : "text-cz-2"}`}>
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
              {/* #4628: fast lav hoejde (h-7 = 28 px) i stedet for `h-auto`.
                  Miniaturen skalerede foer med bredden, saa en stribe med faa
                  etaper blev til fire ~90 px hoeje billeder foer sidens indhold
                  (audit 2026-09 raekke #4, "fire thumbnails"). */}
              {hasRouteData(s)
                ? <StageProfileGraph profile={s} tier="mini" width={100} height={26} uid={`ms-${n}`} heightClass="h-7" />
                : <LegacyMiniSilhouette profileType={s.profile_type} />}
              <span className="block text-3xs font-mono mt-0.5">{n}</span>
              {times?.[n]?.timeLabel && (
                <span className="block text-3xs font-mono text-cz-3 leading-none">{times[n].timeLabel}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
