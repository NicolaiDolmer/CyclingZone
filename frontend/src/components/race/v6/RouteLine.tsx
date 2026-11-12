// #7778 · Rutelinjen over en kørt etapes resultater: terræn, km, højdemeter,
// stigninger og "Skjul rute"/"Vis rute" (valg 6). Valget huskes på brugeren
// (useUiPref); "Gemt" står kort ved knappen, når serveren har det (valg 7).
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { TerrainTypeGlyph } from "../stagePageV2/ui.ts";
import type { UiPrefSaveState } from "../../../lib/userUiPrefs.ts";
import { Button, CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./v6Ui.ts";

export interface RouteLineProps {
  profile: StageProfile;
  /** Ruten kan vises (der findes rutedata); ellers ingen knap. */
  canShow: boolean;
  shown: boolean;
  onToggle: () => void;
  saveState: UiPrefSaveState;
  controlsId: string;
}

export default function RouteLine({ profile, canShow, shown, onToggle, saveState, controlsId }: RouteLineProps) {
  const { t } = useTranslation("races");
  const climbs = sortedClimbs(profile).length;
  const km = formatNumber(Math.round(Number(profile.distance_km) || 0));
  const gain = formatNumber(Math.round(Number(profile.elevation_gain_m) || 0));
  return (
    <section
      aria-label={t("racePageV6.route.aria")}
      className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1"
    >
      <TerrainTypeGlyph profileType={profile.profile_type} size={16} showLabel labelClassName="text-sm font-semibold text-cz-1" className="gap-1.5" />
      <span className="font-data text-sm tabular-nums text-cz-2">{t("racePageV6.route.km", { km })}</span>
      <span className="font-data text-sm tabular-nums text-cz-2">{t("racePageV6.route.gain", { gain })}</span>
      <span className="font-data text-sm tabular-nums text-cz-2">{t("racePageV6.route.climbs", { count: climbs })}</span>
      {canShow && (
        <span className="ms-auto flex items-center gap-2">
          <span aria-live="polite" className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
            {saveState === "saved" && (
              <span className="inline-flex items-center gap-1"><CheckIcon size={12} aria-hidden="true" />{t("racePageV6.route.saved")}</span>
            )}
            {saveState === "local" && t("racePageV6.route.savedHere")}
            {saveState === "failed" && t("racePageV6.route.notSaved")}
          </span>
          <Button variant="ghost" size="sm" onClick={onToggle} className="gap-1" aria-expanded={shown} aria-controls={controlsId}>
            {shown ? t("racePageV6.route.hide") : t("racePageV6.route.show")}
            {shown ? <ChevronUpIcon size={14} aria-hidden="true" /> : <ChevronDownIcon size={14} aria-hidden="true" />}
          </Button>
        </span>
      )}
    </section>
  );
}
