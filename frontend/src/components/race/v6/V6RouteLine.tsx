// #7861 · Rutelinjen øverst på Etape-fanen for en kørt etape (wireframe v6c,
// ejervalg 16/11): Segmented "Historie · film og referat | Resultater · hele listen" (på
// mobil i hele bredden, som wireframet) og etapens rutefakta.
// Fakta står kun i Historie: i Resultater står de allerede i rutekortet ved
// listen, så de aldrig står to steder (#7778 layout B).
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { Segmented, TerrainTypeGlyph } from "../stagePageV2/ui.ts";

export type V6StageMode = "story" | "results";

export interface V6RouteLineProps {
  mode: V6StageMode;
  onChange: (mode: V6StageMode) => void;
  profile: StageProfile | null;
}

export default function V6RouteLine({ mode, onChange, profile }: V6RouteLineProps) {
  const { t } = useTranslation("races");
  const showFacts = mode === "story" && profile != null;
  return (
    <section
      data-race-section="route_line"
      aria-label={t("racePageV6.route.aria")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <Segmented
        label={t("racePageV6.mode.aria")}
        value={mode}
        onChange={(v) => onChange(v === "story" ? "story" : "results")}
        options={[
          { value: "story", label: t("racePageV6.mode.story") },
          { value: "results", label: t("racePageV6.mode.results") },
        ]}
        className="w-full sm:w-auto [&>button]:min-h-11 [&>button]:flex-1 sm:[&>button]:flex-none [&>button]:text-sm"
      />
      {showFacts && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs tabular-nums text-cz-2">
          <TerrainTypeGlyph profileType={profile.profile_type} size={14} showLabel labelClassName="font-semibold text-cz-1" className="gap-1" />
          <span>{t("racePageV6.route.km", { km: formatNumber(Math.round(Number(profile.distance_km) || 0)) })}</span>
          <span>{t("racePageV6.route.elevation", { gain: formatNumber(Math.round(Number(profile.elevation_gain_m) || 0)) })}</span>
          <span>{t("racePageV6.route.climbs", { count: sortedClimbs(profile).length })}</span>
        </p>
      )}
    </section>
  );
}
