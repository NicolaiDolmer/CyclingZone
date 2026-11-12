// #7778 · Løbssiden v6, trin 1 (bag kontakten race_page_v6).
//
// Nyt i trin 1 er kun Resultater for en kørt etape (beslutningslisten på #7778):
//   valg 5: en kørt etape åbner på Resultater.
//   layout B: resultatlisten til venstre, ruteprofilen (fast højde) og "Din dag"
//     til højre; på mobil står profilen over listen (valg 19).
//   valg 6: "Skjul rute" huskes på brugeren (useUiPref, serveren er sandheden).
// De andre faner (Etape/historien, Stillinger, Taktik, Hold) viser deres
// nuværende indhold uændret: de rendres af StagePageV2 uden dens egen navigation.
import { useId, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import StagePageV2, { type StagePageV2Props } from "../stagePageV2/StagePageV2.tsx";
import StageStripV2, { type StripStage } from "../stagePageV2/StageStripV2.tsx";
import { myBestByStage, scheduleFor, stagePhase, type StagePageV2Tab } from "../stagePageV2/stagePageV2Model.ts";
import { Tab, TabList, Tabs } from "../stagePageV2/ui.ts";
import { hasRouteData } from "../../../lib/stageRouteProfile.js";
import { useRaceViewTelemetry } from "../../../lib/useRaceViewTelemetry.ts";
import { useUiPref } from "../../../lib/userUiPrefs.ts";
import { STAGE_SCOPED_TABS, v6Tabs, type RacePageV6Tab } from "./racePageV6Model.ts";
import RouteLine from "./RouteLine.tsx";
import V6RouteProfile from "./V6RouteProfile.tsx";
import V6YourDay from "./V6YourDay.tsx";
import { Button, EmptyState, FlagIcon } from "./v6Ui.ts";

export interface RacePageV6ResultsSlots {
  /** Ruteprofilen, eller null når den er skjult eller mangler rutedata. */
  profileSlot: ReactNode;
  /** "Din dag" under profilen. */
  sideSlot: ReactNode;
}

export interface RacePageV6Props extends Omit<StagePageV2Props, "activeTab" | "onChangeTab"> {
  activeTab: RacePageV6Tab;
  onChangeTab: (tab: RacePageV6Tab) => void;
  /** Etapens resultatliste med v6-slots (RaceDetailPage ejer tabellen og dens data). */
  renderResults: (stageNumber: number, slots: RacePageV6ResultsSlots) => ReactNode;
}

export default function RacePageV6(props: RacePageV6Props) {
  const {
    isStageRace, totalStages, stagesCompleted, selectedStage, todayStage, onSelectStage,
    activeTab, onChangeTab, profileByStage, schedule, timeLabelFor, results, stagePointRows, stageLoaded,
    myTeamId, stageRoles, dnfRows = [], standingsSlot, raceId = null, renderResults,
  } = props;
  const { t } = useTranslation("races");
  const profileId = useId();
  const [routeHidden, setRouteHidden, routeSaveState] = useUiPref("race_route_hidden", false);

  const riders = useMemo(() => (stageRoles ? stageRoles.riders ?? [] : []), [stageRoles]);
  const nameById = useMemo(() => new Map(riders.map((r) => [String(r.rider_id), r.name ?? ""])), [riders]);
  const bestByStage = useMemo(() => myBestByStage(stagePointRows, myTeamId, nameById), [stagePointRows, myTeamId, nameById]);
  const stripStages: StripStage[] = useMemo(() => {
    const out: StripStage[] = [];
    for (let n = 1; n <= totalStages; n++) {
      const at = scheduleFor(schedule, n);
      out.push({ number: n, profile: profileByStage[n] ?? null, timeLabel: at ? timeLabelFor(at) : null, myBest: bestByStage[n] ?? null });
    }
    return out;
  }, [totalStages, schedule, profileByStage, timeLabelFor, bestByStage]);

  const phase = stagePhase(selectedStage, stagesCompleted);
  // StagePageV2 maaler sine egne faner; Resultater er v6's egen og maales her.
  useRaceViewTelemetry({ raceId: activeTab === "results" ? raceId : null, tab: activeTab, stage: selectedStage, phase });

  const tabs = v6Tabs(isStageRace);
  const showStrip = isStageRace && STAGE_SCOPED_TABS.includes(activeTab);
  const profile = profileByStage[selectedStage] ?? null;
  const canShowRoute = profile != null && hasRouteData(profile);
  const routeShown = canShowRoute && !routeHidden;

  let body: ReactNode;
  if (activeTab !== "results") {
    body = (
      <StagePageV2
        {...props}
        activeTab={activeTab as StagePageV2Tab}
        onChangeTab={(tab) => onChangeTab(tab)}
        hideNav
        hideTacticsAction
      />
    );
  } else if (!isStageRace) {
    // Endagsloebets resultat er det nuvaerende (maaltavle + historie), uaendret.
    body = <div data-race-section="standings">{standingsSlot}</div>;
  } else if (phase === "before") {
    body = (
      <EmptyState
        icon={<FlagIcon size={26} aria-hidden="true" />}
        title={t("racePageV6.results.notRiddenTitle", { number: selectedStage })}
        description={t("racePageV6.results.notRiddenHint")}
        action={<Button variant="secondary" size="sm" onClick={() => onChangeTab("stage")}>{t("racePageV6.results.openStage")}</Button>}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {profile && (
          <RouteLine
            profile={profile}
            canShow={canShowRoute}
            shown={routeShown}
            onToggle={() => setRouteHidden(!routeHidden)}
            saveState={routeSaveState}
            controlsId={profileId}
          />
        )}
        {renderResults(selectedStage, {
          profileSlot: routeShown && profile ? <V6RouteProfile id={profileId} profile={profile} hasClassifications={isStageRace} /> : null,
          sideSlot: <V6YourDay results={results} stageNumber={selectedStage} myTeamId={myTeamId} dnfRows={dnfRows} loaded={stageLoaded} />,
        })}
      </div>
    );
  }

  return (
    <div data-race-page data-race-page-version="v6" className="flex flex-col gap-[14px]">
      <div className="sticky top-0 z-20 -my-2 flex flex-col gap-3 bg-cz-body py-2">
        <Tabs value={activeTab} onChange={(v) => onChangeTab(v as RacePageV6Tab)}>
          <TabList label={t("stagePageV2.tabsAria")}>
            {tabs.map((key) => (
              // En koert etapes "Etape"-fane er historien om etapen; foer etapen er den forhaandsvisningen.
              <Tab key={key} value={key}>{t(`racePageV6.tab.${key === "stage" && phase === "after" ? "story" : key}`)}</Tab>
            ))}
          </TabList>
        </Tabs>
        {showStrip && (
          <StageStripV2 stages={stripStages} selected={selectedStage} today={todayStage} ridden={stagesCompleted} onSelect={onSelectStage} />
        )}
      </div>
      {body}
    </div>
  );
}
