// #7778 · Rutekortet i højre kolonne (layout B): terræn, km, højdemeter og
// stigninger, og ruteprofilen med fast højde (valg 3). "Skjul rute" skjuler kun
// tegningen (valg 6); valget huskes på brugeren, og "Gemt" står kort ved knappen,
// når serveren har det (valg 7). På mobil står kortet over listen (valg 19).
// Tegningen er spillets egen (StageProfileGraph, P19), tegnet i den bredde
// kolonnen faktisk har, så tekst og stigninger aldrig skaleres.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import type { UiPrefSaveState } from "../../../lib/userUiPrefs.ts";
import { useMeasuredWidth } from "../stagePageV2/StageProfileV2.tsx";
import { sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { Section, TerrainTypeGlyph } from "../stagePageV2/ui.ts";
import { Button, CheckIcon, ChevronDownIcon, ChevronUpIcon, StageProfileGraph } from "./v6Ui.ts";

/** Fast højde, så listen ved siden af ikke hopper, når profilen tegnes. */
export const V6_PROFILE_HEIGHT = 150;

export interface V6RouteProfileProps {
  id: string;
  profile: StageProfile;
  hasClassifications: boolean;
  /** Der findes rutedata at tegne; ellers ingen tegning og ingen knap. */
  canShow: boolean;
  shown: boolean;
  onToggle: () => void;
  saveState: UiPrefSaveState;
}

function Drawing({ profile, hasClassifications }: { profile: StageProfile; hasClassifications: boolean }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="mt-3 h-[150px] min-w-0">
      {width > 0 && (
        <StageProfileGraph
          profile={profile}
          tier="compact"
          width={Math.round(width)}
          height={V6_PROFILE_HEIGHT}
          heightClass="h-[150px]"
          uid={`v6-${profile.stage_number ?? 1}`}
          hasClassifications={hasClassifications}
        />
      )}
    </div>
  );
}

export default function V6RouteProfile({ id, profile, hasClassifications, canShow, shown, onToggle, saveState }: V6RouteProfileProps) {
  const { t } = useTranslation("races");
  const climbs = sortedClimbs(profile).length;
  const km = formatNumber(Math.round(Number(profile.distance_km) || 0));
  const gain = formatNumber(Math.round(Number(profile.elevation_gain_m) || 0));
  return (
    <div data-race-section="route">
      <Section aria-label={t("racePageV6.route.aria")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="m-0 flex-1 text-[15px] font-semibold text-cz-1">{t("racePageV6.route.profileTitle")}</h2>
          {canShow && (
            <>
              <span aria-live="polite" className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                {saveState === "saved" && (
                  <span className="inline-flex items-center gap-1"><CheckIcon size={12} aria-hidden="true" />{t("racePageV6.route.saved")}</span>
                )}
                {saveState === "local" && t("racePageV6.route.savedHere")}
                {saveState === "failed" && t("racePageV6.route.notSaved")}
              </span>
              <Button variant="ghost" size="sm" onClick={onToggle} className="-me-2 gap-1" aria-expanded={shown} aria-controls={id}>
                {shown ? t("racePageV6.route.hide") : t("racePageV6.route.show")}
                {shown ? <ChevronUpIcon size={14} aria-hidden="true" /> : <ChevronDownIcon size={14} aria-hidden="true" />}
              </Button>
            </>
          )}
        </div>
        <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs tabular-nums text-cz-2">
          <TerrainTypeGlyph profileType={profile.profile_type} size={14} showLabel labelClassName="font-semibold text-cz-1" className="gap-1" />
          <span>{t("racePageV6.route.km", { km })}</span>
          <span>{t("racePageV6.route.gain", { gain })}</span>
          <span>{t("racePageV6.route.climbs", { count: climbs })}</span>
        </p>
        <div id={id}>
          {canShow && shown && <Drawing profile={profile} hasClassifications={hasClassifications} />}
        </div>
      </Section>
    </div>
  );
}
