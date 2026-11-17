// #7778 · Rutekortet i højre kolonne (layout B): terræn, km, højdemeter og
// stigninger, og ruten. "Skjul rute" skjuler kun tegningen (valg 6); valget
// huskes på brugeren, og "Gemt" står kort ved knappen, når serveren har det
// (valg 7). På mobil står kortet over listen (valg 19).
// #8253: tegningen er v6's ene fælles rute (V6Route: den farvede profil fra
// Etape-fanen med bjergpriser, spurter og mål), i den bredde kolonnen faktisk
// har, så tekst aldrig skaleres.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import type { UiPrefSaveState } from "../../../lib/userUiPrefs.ts";
import { sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { Section, TerrainTypeGlyph } from "../stagePageV2/ui.ts";
import V6Route from "./V6Route.tsx";
import { Button, CheckIcon, ChevronDownIcon, ChevronUpIcon } from "./v6Ui.ts";

export interface V6RouteProfileProps {
  id: string;
  profile: StageProfile;
  /** Ubrugt siden #8253 (den fælles rute viser altid bjergpriser og spurter); beholdt for kalderen. */
  hasClassifications?: boolean;
  /** Der findes rutedata at tegne; ellers ingen tegning og ingen knap. */
  canShow: boolean;
  shown: boolean;
  onToggle: () => void;
  saveState: UiPrefSaveState;
}

export default function V6RouteProfile({ id, profile, canShow, shown, onToggle, saveState }: V6RouteProfileProps) {
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
          {canShow && shown && <div className="mt-3"><V6Route profile={profile} /></div>}
        </div>
      </Section>
    </div>
  );
}
