import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey, finaleLabelKey } from "../../lib/stageProfileConfig.js";
import { hasRouteData } from "../../lib/stageRouteProfile.js";
import StageProfileGraph from "./StageProfileGraph.jsx";
import TerrainDNABar from "./TerrainDNABar.jsx";

// Valgt-etape-panel: stor silhuet/graf + finale-markør + terræn-navn + terrain-DNA.
// profile mangler/ukendt terræn → null (graceful, som StageProfileCard).
export default function StageDetailPanel({ profile, stageLabel }) {
  const { t } = useTranslation("races");
  const labelKey = profile && profileLabelKey(profile.profile_type);
  if (!labelKey) return null;
  const finaleKey = finaleLabelKey(profile.finale_type);
  const { points } = profileShape(profile.profile_type);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      {hasRouteData(profile) ? (
        // Sub-4 (#2448): ægte rute i stedet for kategori-piktogrammet + finale-
        // pilen — graf-tieret "compact" tegner selv målflag og waypoint-markører.
        <StageProfileGraph profile={profile} tier="compact" width={430} height={150} uid={`sdp-${profile.stage_number ?? 1}`} />
      ) : (
        <div className="relative">
          <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="w-full h-24 block text-cz-1" aria-hidden="true">
            <polyline points={`${points} 100,24 0,24`} fill="currentColor" fillOpacity="0.06" stroke="none" />
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {/* Finale-markør ved målet (højre ende). */}
          <span
            className="absolute -top-0.5 right-0 text-cz-accent-t"
            aria-hidden="true"
            title={finaleKey ? t(`detail.${finaleKey}`) : ""}
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 1 V13" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.6 1.5 L11 3.2 L7 5 L11 6.8 L3.6 5" fill="currentColor" fillOpacity="0.85" />
            </svg>
          </span>
        </div>
      )}
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        <p className="text-cz-1 text-sm font-semibold">
          {stageLabel && <span className="text-cz-3 font-normal me-1.5">{stageLabel} ·</span>}
          {t(`detail.${labelKey}`)}
        </p>
        {finaleKey && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30">
            {t(`detail.${finaleKey}`)}
          </span>
        )}
      </div>
      <div className="mt-3">
        <TerrainDNABar demandVector={profile.demand_vector} />
      </div>
      <p className="text-cz-3 text-[11px] mt-2">{t("detail.stageProfile.note")}</p>
    </div>
  );
}
