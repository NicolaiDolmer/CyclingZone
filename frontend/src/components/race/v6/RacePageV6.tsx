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
//
// #7865 (ringere punkter): siden har én etapestribe; på Taktik styrer den editoren,
// som under v6 ikke har sin egen vælger. En kørt etape på Taktik viser altid den
// låste oversigt (roller, indsats, holdplan) og planen mod det der skete over den,
// hvor der er en plan og en optegnelse. Ordre-oversigten findes ét sted: Taktik.
// En etape på vejen siger det på Resultater. Panelet under fanerne har kortets
// bredde og placering (review-punkt d, #7865).
//
// #7778 udgave E (valg 20-22, ejer 15/11): løbshovedet og etapestriben er ÉT kort
// (T3-heroens anatomi). Række 1: navn, mærker, "N etaper · sæson N". Række 2:
// talrækken (HeroStats) med frist og sidens ene guld-knap til højre. Række 3:
// etapestriben som kortets bund (V6StageStrip). Fanerne står under kortet
// (underline, aktiv = guld understregning og guld-tekst), og panelet er
// role="tabpanel" med aria-labelledby på den aktive fane.
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import StagePageV2, { type StagePageV2Props } from "../stagePageV2/StagePageV2.tsx";
import { activeRiders, myBestByStage, scheduleFor, stagePhase, type StagePageV2Tab } from "../stagePageV2/stagePageV2Model.ts";
import { Tab, TabList, Tabs } from "../stagePageV2/ui.ts";
import { profileLabelKey } from "../../../lib/stageProfileConfig.js";
import { hasRouteData } from "../../../lib/stageRouteProfile.js";
import { fetchTeamOrders } from "../../../lib/tacticsOrdersAdapter.js";
import { useRaceViewTelemetry } from "../../../lib/useRaceViewTelemetry.ts";
import { useRiderNames } from "../../../lib/useRiderNames.js";
import { useUiPref } from "../../../lib/userUiPrefs.ts";
import {
  tacticsCta, v6NamesFromResults, v6ResultsPhase, v6RouteProfile, v6SavedStages, v6SavedStagesRefreshKey, v6StageTabFor, v6Strip, v6StripCells, v6StripWinners, v6Tabs,
  v6TacticsResults, v6TacticsStage, v6WinnerIdsByStage, v6WinnersByStage,
  type RacePageV6Tab, type StageResultsState, type V6ResultRow,
} from "./racePageV6Model.ts";
import V6StageStrip from "./V6StageStrip.tsx";
import V6RouteProfile from "./V6RouteProfile.tsx";
import V6TacticsAfter from "./V6TacticsAfter.tsx";
import V6YourDay from "./V6YourDay.tsx";
import { V6TacticsSavedContext } from "./v6TacticsSaved.ts";
import { Button, EmptyState, FlagIcon } from "./v6Ui.ts";
import V6RaceHeroCard, { type RacePageV6Hero } from "./V6RaceHeroCard.tsx";
import { useRacePageSpoiler } from "../../spoiler/useRacePageSpoiler.tsx"; // #7859
import { SpoilerStoryContext } from "../../spoiler/spoilerStoryContext.ts"; // #7859

export type { RacePageV6Hero };

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
  /**
   * #7865: Taktik-editoren for en bestemt etape, uden sin egen etapevælger (v6-striben
   * styrer den). En kørt etape viser den låst og skrivebeskyttet. Uden = tacticsSlot.
   */
  renderTactics?: (stageNumber: number) => ReactNode;
  /** Udgave E: løbshovedet (ét kort med etapestriben som bund). */
  hero: RacePageV6Hero;
  /** Udgave E: åbn en etape på en bestemt fane i ét skridt (klik i striben fra Stillinger og Hold). */
  onOpenStage?: (stageNumber: number, tab: RacePageV6Tab) => void;
  /** Udgave E: cellens tidspunkt (kun klokkeslæt i dag, ellers ugedag og klokkeslæt). */
  whenLabelFor?: (date: Date) => string | null;
}

/**
 * #7865 (valg 21): etaper med en gemt plan, fra samme svar som Taktik læser
 * (team-orders). Hentes igen, når Taktik åbnes, når Taktiks etape skifter, når et gem
 * i Taktik lykkes (#7778), og når fanen forlades. Det sidst kendte
 * svar står, mens der hentes; uden svar (fejl, ikke logget ind) er tilstanden ukendt.
 */
function useV6SavedStages(raceId: string | null, enabled: boolean, refreshKey: string): Set<number> | null {
  const [saved, setSaved] = useState<{ raceId: string; stages: Set<number> } | null>(null);
  useEffect(() => {
    if (!enabled || !raceId) return undefined;
    let alive = true;
    fetchTeamOrders({ raceId })
      .then((ctx) => {
        const stages = v6SavedStages(ctx);
        if (alive && stages) setSaved({ raceId, stages });
      })
      .catch(() => { /* catch-ok: ukendt tilstand = intet ord i cellen, aldrig et gæt */ });
    return () => { alive = false; };
  }, [raceId, enabled, refreshKey]);
  return enabled && saved && saved.raceId === raceId ? saved.stages : null;
}

export default function RacePageV6(props: RacePageV6Props) {
  const {
    isStageRace, totalStages, stagesCompleted, selectedStage, onSelectStage,
    activeTab: requestedTab, onChangeTab, profileByStage, schedule, timeLabelFor, results, stagePointRows, stageLoaded,
    myTeamId, stageRoles, dnfRows = [], standingsSlot, raceId = null, renderResults,
    raceFinished, nowMs, onOpenTactics, tacticsStageRequest = null, loadStage, stageStateFor, stageErrorFor,
    renderTactics, tacticsSlot, hero, onOpenStage, whenLabelFor,
  } = props;
  // #7859: spoiler-skjoldet (slukket kontakt = alt som i dag). En skjult etape åbner i Story.
  const spoiler = useRacePageSpoiler({ raceId, selectedStage, stagesCompleted, onShowResults: useCallback(() => onChangeTab("results"), [onChangeTab]) });
  const activeTab = spoiler.shownTab(requestedTab);
  const { t } = useTranslation("races");
  const profileId = useId();
  const [routeHidden, setRouteHidden, routeSaveState] = useUiPref("race_route_hidden", false);

  const riders = useMemo(() => (stageRoles ? stageRoles.riders ?? [] : []), [stageRoles]);
  const overrides = useMemo(() => (stageRoles ? stageRoles.overrides ?? [] : []), [stageRoles]);
  const nameById = useMemo(() => new Map(riders.map((r) => [String(r.rider_id), r.name ?? ""])), [riders]);
  const bestByStage = useMemo(() => myBestByStage(stagePointRows, myTeamId, nameById), [stagePointRows, myTeamId, nameById]);
  const phase = stagePhase(selectedStage, stagesCompleted);
  // StagePageV2 maaler sine egne faner; Resultater er v6's egen og maales her.
  useRaceViewTelemetry({ raceId: activeTab === "results" ? raceId : null, tab: activeTab, stage: selectedStage, phase });

  // #7865: Taktik-fanens etape. Siden ejer den seneste eksplicitte navigation (striben
  // og hovedets guld-knap går samme vej) og glemmer den, når fanen forlades.
  const openTactics = tacticsCta({ stagesCompleted, totalStages, raceFinished, schedule, riders, overrides, nowMs });
  const tacticsStage = v6TacticsStage({ requested: tacticsStageRequest, ctaStage: openTactics?.stage, selectedStage });
  // En kørt etape: planen mod det der skete, når etapens resultater er hentet.
  const tacticsResults = v6TacticsResults({ activeTab, stage: tacticsStage, stagesCompleted, stateFor: stageStateFor });
  useEffect(() => {
    if (tacticsResults !== null) loadStage?.(tacticsStage);
  }, [tacticsResults, tacticsStage, loadStage]);
  const selectTacticsStage = (n: number) => onOpenTactics(n);

  const tabs = v6Tabs(isStageRace);
  const tabIdBase = useId();
  const tabId = (key: string) => `${tabIdBase}-tab-${key}`;
  // Udgave E: én celle pr. etape, kun med data siden allerede har (v6StripCells).
  // #7865: vinderen på ALLE kørte etaper. Id'et kommer fra hele løbets etaperækker;
  // navnet fra de hentede lister, holdets ryttere eller ét navneopslag for resten.
  const winnerIds = useMemo(() => (isStageRace ? v6WinnerIdsByStage(stagePointRows) : {}), [isStageRace, stagePointRows]);
  const resultNames = useMemo(() => v6NamesFromResults(results as V6ResultRow[]), [results]);
  const unnamedWinnerIds = useMemo(
    () => [...new Set(Object.values(winnerIds))].filter((id) => !resultNames.has(id) && !nameById.get(id)).sort(),
    [winnerIds, resultNames, nameById],
  );
  const lookedUpNames = useRiderNames(unnamedWinnerIds) as Record<string, string | null>;
  const winners = useMemo(() => v6StripWinners({
    winnerIds,
    nameById: (id) => resultNames.get(id) ?? nameById.get(id) ?? lookedUpNames[id],
    fromResults: v6WinnersByStage(results as V6ResultRow[]),
  }), [winnerIds, resultNames, nameById, lookedUpNames, results]);
  // #7865 (valg 21): planens tilstand pr. kommende etape, fra Taktiks egne data.
  // #7778: et lykket gem i Taktik tæller op og henter igen, så striben følger med straks.
  const [tacticsSaves, setTacticsSaves] = useState(0);
  const onTacticsSaved = useCallback(() => setTacticsSaves((n) => n + 1), []);
  const savedStages = useV6SavedStages(
    raceId,
    isStageRace && !raceFinished && activeRiders(riders).length > 0,
    v6SavedStagesRefreshKey({ activeTab, tacticsStage, saves: tacticsSaves }),
  );
  const stripCells = useMemo(() => v6StripCells({
    totalStages, stagesCompleted, raceFinished, schedule, nowMs,
    profileTypeByStage: Object.fromEntries(Object.entries(profileByStage).map(([n, p]) => [n, p && profileLabelKey(p.profile_type) ? p.profile_type : null])),
    winners: spoiler.visible(winners), myBest: spoiler.visible(bestByStage), riders, overrides, savedStages, // #7859
    whenFor: whenLabelFor ?? timeLabelFor,
  }), [totalStages, stagesCompleted, raceFinished, schedule, nowMs, profileByStage, winners, bestByStage, riders, overrides, savedStages, whenLabelFor, timeLabelFor, spoiler.visible]);
  // #7865 (punkt 2): én etapestribe. På Taktik styrer den editoren (som ingen egen vælger har).
  const strip = v6Strip({ activeTab, isStageRace, selectedStage, tacticsStage });
  // #8253: rutekortet viser altid den valgte etapes rute (opslaget tjekker etapenummeret).
  const profile = v6RouteProfile(profileByStage, selectedStage);
  const canShowRoute = profile != null && hasRouteData(profile);
  const routeShown = canShowRoute && !routeHidden;
  const resultsPhase = v6ResultsPhase({ selectedStage, stagesCompleted, raceFinished, schedule, nowMs });

  let body: ReactNode;
  if (activeTab === "tactics") {
    // #7865 (punkt 3): editoren står altid samme sted i træet, så en kladde på en kommende
    // etape overlever et klik på en kørt etape. En kørt etape viser editoren låst og
    // skrivebeskyttet (roller, indsats, holdplan) og, hvor der er en plan og en
    // optegnelse, planen mod det der skete over den.
    body = (
      <div data-race-section="tactics" className="flex flex-col gap-[14px]">
        {tacticsResults !== null ? (
          <V6TacticsAfter
            key={tacticsStage}
            raceId={raceId}
            stageNumber={tacticsStage}
            isStageRace={isStageRace}
            results={results}
            myTeamId={myTeamId}
            stageRoles={stageRoles}
            profile={v6RouteProfile(profileByStage, tacticsStage)}
            resultsState={tacticsResults}
            resultsErrorSlot={tacticsResults === "failed" ? stageErrorFor?.(tacticsStage) ?? null : null}
          />
        ) : null}
        <V6TacticsSavedContext.Provider value={onTacticsSaved}>
          {renderTactics ? renderTactics(tacticsStage) : tacticsSlot}
        </V6TacticsSavedContext.Provider>
      </div>
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
  } else if (spoiler.resultsBody) {
    body = spoiler.resultsBody; // #7859 billede 3: Resultater bag "Show results"
  } else if (!isStageRace) {
    // Endagsloebets resultat er det nuvaerende (maaltavle + historie), uaendret.
    body = <div data-race-section="standings">{standingsSlot}</div>;
  } else if (resultsPhase !== "ridden") {
    // #7865 (punkt 5): en etape på vejen siger det, i stedet for "Get ready for stage N".
    body = (
      <EmptyState
        icon={<FlagIcon size={26} aria-hidden="true" />}
        title={resultsPhase === "on_road"
          ? t("racePage.hero.chipStageOnRoad", { number: selectedStage })
          : t("racePageV6.results.notRiddenTitle", { number: selectedStage })}
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
      sideSlot: <V6YourDay results={results} stageNumber={selectedStage} myTeamId={myTeamId} dnfRows={dnfRows} loaded={stageLoaded} raceId={raceId} profile={profile} stageRoles={stageRoles} nowMs={nowMs} />,
    });
  }

  const selectFromStrip = (n: number) => {
    if (!strip) return;
    if (strip.target === "tactics") selectTacticsStage(n);
    else if (strip.target === "open" && onOpenStage) onOpenStage(n, spoiler.tabFor(n, v6StageTabFor(n, stagesCompleted)));
    else onSelectStage(n);
  };

  return (
    <div data-race-page data-race-page-version="v6" className="flex flex-col gap-[14px]">
      {/* Udgave E: ét kort med striben som bund. Guld kun i stregen øverst og på den ene knap. */}
      <V6RaceHeroCard hero={spoiler.hero(hero)} aside={spoiler.heroAside} note={spoiler.heroNote} strip={strip ? <V6StageStrip cells={stripCells} profileByStage={profileByStage} selected={strip.selected} onSelect={selectFromStrip} /> : null} />
      {/* Fanerne står 8 px under kortet (gap 14 minus 14, plus 8 px luft i den klæbende række). */}
      <div className="sticky top-0 z-20 -mt-[14px] -mb-2 bg-cz-body pt-2 pb-2">
        <Tabs value={activeTab} onChange={(v) => onChangeTab(v as RacePageV6Tab)}>
          <TabList label={t("stagePageV2.tabsAria")} accent>
            {tabs.map((key) => (
              // En koert etapes "Etape"-fane er historien om etapen; foer etapen er den forhaandsvisningen.
              <Tab key={key} value={key} id={tabId(key)}>{t(`racePageV6.tab.${key === "stage" && phase === "after" ? "story" : key}`)}</Tab>
            ))}
          </TabList>
        </Tabs>
      </div>
      {/* #7865 (review-punkt d): panelet har samme bredde og placering som kortet og
          fanerne over det, så intet står venstrestillet under et bredere kort ved 1600 px+. */}
      <div role="tabpanel" aria-labelledby={tabId(activeTab)} data-race-body-width="card" className="w-full">
        <SpoilerStoryContext.Provider value={spoiler.story}>{body}</SpoilerStoryContext.Provider>
      </div>
    </div>
  );
}
