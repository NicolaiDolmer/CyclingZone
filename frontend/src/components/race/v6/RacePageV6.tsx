// #7778 · Løbssiden v6, trin 1 (bag kontakten race_page_v6).
//
// Nyt i trin 1 er kun Resultater for en kørt etape (beslutningslisten på #7778):
//   valg 5: en kørt etape åbner på Resultater.
//   layout B: resultatlisten til venstre, ruteprofilen (fast højde) og "Din dag"
//     til højre; på mobil står profilen over listen (valg 19).
//   valg 6: "Skjul rute" huskes på brugeren (useUiPref, serveren er sandheden).
// De andre faner (Etape/historien, Stillinger, Taktik, Hold) viser deres
// nuværende indhold uændret: de rendres af StagePageV2 uden dens egen navigation.
//
// #7865 (trin 2a, valg 11): Taktik på en kørt etape viser planen mod det der skete
// (V6TacticsAfter); ordre-oversigten under historien udgår derfor i v6. Taktik har
// sin egen etapestribe: fanen åbner på etapen guld-knappen nævner (så knappen altid
// lander i editoren), ellers på den valgte etape; en kørt etape i striben viser
// planen mod det der skete, en kommende åbner editoren på netop den etape. Striben
// og guld-knappen går samme vej (siden ejer etapen), så den sidste handling vinder.
// En kørt etapes resultater hentes ved valget, med indlæsning og fejl som Resultater.
import { useEffect, useId, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import StagePageV2, { type StagePageV2Props } from "../stagePageV2/StagePageV2.tsx";
import StageStripV2, { type StripStage } from "../stagePageV2/StageStripV2.tsx";
import { myBestByStage, scheduleFor, stagePhase, type StagePageV2Tab } from "../stagePageV2/stagePageV2Model.ts";
import { Tab, TabList, Tabs } from "../stagePageV2/ui.ts";
import { hasRouteData } from "../../../lib/stageRouteProfile.js";
import { useRaceViewTelemetry } from "../../../lib/useRaceViewTelemetry.ts";
import { useUiPref } from "../../../lib/userUiPrefs.ts";
import {
  STAGE_SCOPED_TABS, tacticsCta, v6Tabs, v6TacticsResults, v6TacticsStage, type RacePageV6Tab, type StageResultsState,
} from "./racePageV6Model.ts";
import V6RouteProfile from "./V6RouteProfile.tsx";
import V6TacticsAfter from "./V6TacticsAfter.tsx";
import V6YourDay from "./V6YourDay.tsx";
import { Button, EmptyState, FlagIcon } from "./v6Ui.ts";

export interface RacePageV6ResultsSlots {
  /** Rutekortet (profilen kan være skjult), eller null når etapen ingen profil har. */
  profileSlot: ReactNode;
  /** "Din dag" under profilen. */
  sideSlot: ReactNode;
}

export interface RacePageV6Props extends Omit<StagePageV2Props, "activeTab" | "onChangeTab"> {
  activeTab: RacePageV6Tab;
  onChangeTab: (tab: RacePageV6Tab) => void;
  /** Etapens resultatliste med v6-slots (RaceDetailPage ejer tabellen og dens data). */
  renderResults: (stageNumber: number, slots: RacePageV6ResultsSlots) => ReactNode;
  /** Taktik-fanens seneste eksplicitte etape (stribe eller guld-knap); null = fanen åbnet direkte. */
  tacticsStageRequest?: number | null;
  /** Start hentningen af en etapes resultater (siden henter pr. etape). */
  loadStage?: (stageNumber: number) => void;
  /** En etapes hentetilstand. */
  stageStateFor?: (stageNumber: number) => StageResultsState;
  /** Fejl-tilstanden med "Prøv igen" for en etape, der ikke kunne hentes. */
  stageErrorFor?: (stageNumber: number) => ReactNode;
}

export default function RacePageV6(props: RacePageV6Props) {
  const {
    isStageRace, totalStages, stagesCompleted, selectedStage, todayStage, onSelectStage,
    activeTab, onChangeTab, profileByStage, schedule, timeLabelFor, results, stagePointRows, stageLoaded,
    myTeamId, stageRoles, dnfRows = [], standingsSlot, raceId = null, renderResults,
    raceFinished, nowMs, onOpenTactics, tacticsStageRequest = null, loadStage, stageStateFor, stageErrorFor,
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

  // #7865: Taktik-fanens etape. Siden ejer den seneste eksplicitte navigation (striben
  // og hovedets guld-knap går samme vej) og glemmer den, når fanen forlades.
  const overrides = stageRoles ? stageRoles.overrides ?? [] : [];
  const openTactics = tacticsCta({ selectedStage, stagesCompleted, totalStages, raceFinished, schedule, riders, overrides, nowMs });
  const tacticsStage = v6TacticsStage({ requested: tacticsStageRequest, ctaStage: openTactics?.stage, selectedStage });
  // En kørt etape: planen mod det der skete, når etapens resultater er hentet.
  const tacticsResults = v6TacticsResults({ activeTab, stage: tacticsStage, stagesCompleted, stateFor: stageStateFor });
  useEffect(() => {
    if (tacticsResults !== null) loadStage?.(tacticsStage);
  }, [tacticsResults, tacticsStage, loadStage]);
  const selectTacticsStage = (n: number) => onOpenTactics(n);

  const tabs = v6Tabs(isStageRace);
  const showStrip = isStageRace && STAGE_SCOPED_TABS.includes(activeTab);
  const profile = profileByStage[selectedStage] ?? null;
  const canShowRoute = profile != null && hasRouteData(profile);
  const routeShown = canShowRoute && !routeHidden;

  let body: ReactNode;
  if (tacticsResults !== null) {
    body = (
      <V6TacticsAfter
        key={tacticsStage}
        raceId={raceId}
        stageNumber={tacticsStage}
        isStageRace={isStageRace}
        results={results}
        myTeamId={myTeamId}
        stageRoles={stageRoles}
        profile={profileByStage[tacticsStage] ?? null}
        resultsState={tacticsResults}
        resultsErrorSlot={tacticsResults === "failed" ? stageErrorFor?.(tacticsStage) ?? null : null}
      />
    );
  } else if (activeTab !== "results") {
    body = (
      <StagePageV2
        {...props}
        activeTab={activeTab as StagePageV2Tab}
        onChangeTab={(tab) => onChangeTab(tab)}
        hideNav
        hideTacticsAction
        hideOrdersRecap
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
    body = renderResults(selectedStage, {
      profileSlot: profile ? (
        <V6RouteProfile
          id={profileId}
          profile={profile}
          hasClassifications={isStageRace}
          canShow={canShowRoute}
          shown={routeShown}
          onToggle={() => setRouteHidden(!routeHidden)}
          saveState={routeSaveState}
        />
      ) : null,
      sideSlot: <V6YourDay results={results} stageNumber={selectedStage} myTeamId={myTeamId} dnfRows={dnfRows} loaded={stageLoaded} />,
    });
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
        {isStageRace && activeTab === "tactics" && (
          <StageStripV2 stages={stripStages} selected={tacticsStage} today={todayStage} ridden={stagesCompleted} onSelect={selectTacticsStage} />
        )}
      </div>
      {body}
    </div>
  );
}
