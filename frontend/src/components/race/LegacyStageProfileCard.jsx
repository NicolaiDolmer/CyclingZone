import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey, finaleLabelKey } from "../../lib/stageProfileConfig.js";

// #1484 — stiliseret terræn-indikator pr. etape. ÆRLIG: kategori-piktogram fra
// race_stage_profiles.profile_type, IKKE en målt højdeprofil (#1021). Degraderer
// til intet hvis profil mangler eller terrænet er ukendt — ingen tom/falsk visning.
//
// Sub-4 (#2448): flyttet ORDRET ud af RaceDetailPage.jsx til sin egen fil — dette
// er degraderings-stien for etaper UDEN rutedata (S1/PCM-importerede løb med
// distance_km=null). StageProfileSlot i RaceDetailPage.jsx afgør hvornår denne
// bruges i stedet for det nye StageProfileCard (Sub-4-grafen).
export default function LegacyStageProfileCard({ profile, stageLabel }) {
  const { t } = useTranslation("races");
  const labelKey = profile && profileLabelKey(profile.profile_type);
  if (!labelKey) return null;

  const finaleKey = finaleLabelKey(profile.finale_type);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4 flex items-center gap-4">
      <StageProfileSilhouette profileType={profile.profile_type} />
      <div className="min-w-0">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold">
          {stageLabel || t("detail.stageProfile.label")}
        </p>
        <p className="text-cz-1 text-sm font-semibold leading-tight">
          {t(`detail.${labelKey}`)}
          {finaleKey && (
            <span className="text-cz-3 font-normal"> · {t(`detail.${finaleKey}`)}</span>
          )}
        </p>
        <p className="text-cz-3 text-[11px] mt-0.5">{t("detail.stageProfile.note")}</p>
      </div>
    </div>
  );
}

// Lille deterministisk silhuet (sparkline) — currentColor + cz-tokens, ingen slop.
function StageProfileSilhouette({ profileType }) {
  const { points, baseY, width, height } = profileShape(profileType);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-14 h-7 shrink-0 text-cz-accent-t"
      role="presentation"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {/* Havniveau-hårlinje */}
      <line x1="0" y1={baseY} x2={width} y2={baseY}
        stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.75" />
      {/* Terræn-silhuet */}
      <polyline points={points}
        fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
