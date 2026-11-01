// #6570 · Etapeside 2.0 (ejer-design-go 14/10 paa artifact v7), bag stadie-
// flaget stage_page_v2. Alle uden flaget ser den nuvaerende side uaendret.
//
// Faner: Stage / Standings / Team / Tactics. Overview er foldet ind i toppen
// (heroen + "Your day"). Standings, Team og Tactics genbruger det nuvaerende
// indhold, som RaceDetailPage sender ind som slots, saa intet tal regnes to
// steder. Fanerne og etapestriben er sticky; striben aabner paa dagens etape.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  activeRiders, myBestByStage, resolveV2Tab, scheduleFor, STAGE_PAGE_V2_TABS, stagePhase, tacticsProgress,
  type DnfRowInput, type ResultRow, type RoleOverride, type RoleRider, type ScheduleRow, type StagePageV2Tab, type StageProfile,
} from "./stagePageV2Model.ts";
import StageStripV2, { type StripStage } from "./StageStripV2.tsx";
import StageTabV2 from "./StageTabV2.tsx";
import type { CareerEvent } from "./YourDayCard.tsx";
import { Tab, TabList, Tabs } from "./ui.ts";
import { useStageTimeline } from "../../../hooks/useStageTimeline.js";
import { asStory, type StoryNarrativeContext } from "./raceStoryModel.ts";
import StageOrdersRecap from "../../stageOrders/StageOrdersRecap.tsx"; // #6299
import { fetchTeamOrders } from "../../../lib/tacticsOrdersAdapter.js";
import type { TeamOrdersContext } from "../../stageOrders/stageOrdersRecap.ts";
import { effectiveEffortByRider, ownRiderIdsForStage } from "../../../lib/stageSplitTimes.ts";
import { ownRiderIdsForOneDay } from "../../../lib/oneDayTimeline.ts";

export interface StagePageV2Props {
  isStageRace: boolean;
  totalStages: number;
  stagesCompleted: number;
  raceFinished: boolean;
  selectedStage: number;
  todayStage: number | number[] | null;
  onSelectStage: (n: number) => void;
  activeTab: StagePageV2Tab;
  onChangeTab: (tab: StagePageV2Tab) => void;
  /** Guld-knappen: aabn Tactics paa praecis den etape knappen naevner. */
  onOpenTactics: (stageNumber: number) => void;
  profileByStage: Record<number, StageProfile>;
  schedule: ScheduleRow[];
  timeLabelFor: (date: Date) => string;
  results: ResultRow[];
  stagePointRows: ResultRow[];
  stageLoaded: boolean;
  /** Fejl + "Try again" naar etapens resultater ikke kunne hentes; null ellers. */
  stageErrorSlot: ReactNode;
  myTeamId: string | null;
  stageRoles: null | false | { riders?: RoleRider[]; overrides?: RoleOverride[] };
  careerEvents: CareerEvent[];
  /** #7330: etapens udgaaede (dnfRowsForStage) til "Your riders". */
  dnfRows?: DnfRowInput[];
  standingsSlot: ReactNode;
  teamSlot: ReactNode;
  tacticsSlot: ReactNode;
  emptyStageSlot: ReactNode;
  /** Sidens 30 s-ur (RaceDetailPage), saa en startet etape ikke tilbyder taktik. */
  nowMs: number;
  /** #6570 spor 2: loebet, saa siden selv kan hente loebshistorien for en koert etape. */
  raceId?: string | null;
}

export default function StagePageV2(props: StagePageV2Props) {
  const {
    isStageRace, totalStages, stagesCompleted, raceFinished, selectedStage, todayStage, onSelectStage,
    activeTab, onChangeTab, onOpenTactics, profileByStage, schedule, timeLabelFor, results, stagePointRows, stageLoaded, stageErrorSlot,
    myTeamId, stageRoles, careerEvents, dnfRows = [], standingsSlot, teamSlot, tacticsSlot, emptyStageSlot, nowMs, raceId = null,
  } = props;
  const { t } = useTranslation("races");

  const riders = useMemo(() => (stageRoles ? stageRoles.riders ?? [] : []), [stageRoles]);
  const overrides = useMemo(() => (stageRoles ? stageRoles.overrides ?? [] : []), [stageRoles]);
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
  // #6570 spor 2 (+ #6512 endagsloeb): loebshistorien for en koert etape. 404 =
  // ingen tidslinje = den nuvaerende visning, uaendret.
  const { timeline } = useStageTimeline(phase === "after" && activeTab === "stage" ? raceId : null, selectedStage, { story: true });
  const story = useMemo(() => asStory((timeline as { story?: unknown } | null)?.story), [timeline]);
  // #6299 (b): egne rytteres laaste ordre paa en koert v4-etape.
  const ranTimeline = timeline as { timeline_version?: number; created_at?: string | null } | null;
  // Endagsloeb gemmer resultatet som `gc`-raekker (#6512), saa de skal have endags-opslaget.
  const ownStageRiders = useMemo(
    () => (isStageRace ? ownRiderIdsForStage(results, selectedStage, myTeamId) : ownRiderIdsForOneDay(results, myTeamId)),
    [isStageRace, results, selectedStage, myTeamId],
  );
  const nameOfRider = useMemo(() => (id: string) => nameById.get(id) || null, [nameById]);

  // #6469: share the already-needed own-team order read with the recap; no other team orders are read.
  const [fetchedOrders, setFetchedOrders] = useState<{ raceId: string; stage: number; value: TeamOrdersContext | null } | null>(null);
  const v4Timeline = (ranTimeline?.timeline_version ?? 1) >= 2;
  const needsOrders = phase === "after" && activeTab === "stage" && v4Timeline && ownStageRiders.length > 0;
  useEffect(() => {
    if (!needsOrders || !raceId) return undefined;
    let live = true;
    fetchTeamOrders({ raceId })
      .then(value => { if (live) setFetchedOrders({ raceId, stage: selectedStage, value: value as TeamOrdersContext | null }); })
      .catch(() => { /* catch-ok: unknown orders cannot support an order-impact claim */ });
    return () => { live = false; };
  }, [needsOrders, raceId, selectedStage]);
  const knownOrders = fetchedOrders?.raceId === raceId && fetchedOrders?.stage === selectedStage ? fetchedOrders : null;
  const narrative = useMemo<StoryNarrativeContext>(() => {
    const teamNameById = new Map<string, string>();
    for (const row of results) {
      const id = row.team_id ?? row.rider?.team?.id;
      const name = row.team_name ?? row.rider?.team?.name;
      if (id && name) teamNameById.set(String(id), name);
    }
    return {
      profileType: profileByStage[selectedStage]?.profile_type ?? null,
      events: (timeline as { events?: StoryNarrativeContext["events"] } | null)?.events ?? [],
      teamNameById,
      // Wait for the authoritative v4 order read. Failed reads make no order-impact assertion.
      effortByRider: v4Timeline && !knownOrders ? null : effectiveEffortByRider(stageRoles, knownOrders?.value, selectedStage, { v4: v4Timeline, ranAt: ranTimeline?.created_at ?? null }),
    };
  }, [timeline, results, stageRoles, selectedStage, profileByStage, v4Timeline, knownOrders, ranTimeline?.created_at]);
  // Den ene guld-knap: taktik for den etape der er aaben. Foer etapen = den
  // valgte; efter = den naeste, hvis loebet ikke er slut.
  const tacticsStage = phase === "before" ? selectedStage : selectedStage + 1;
  const tacticsAt = scheduleFor(schedule, tacticsStage);
  const started = tacticsAt !== null && tacticsAt.getTime() <= nowMs;
  // Kun ryttere der stadig er i loebet: er hele holdet udgaaet, er der ingen taktik at saette.
  const hasOpenTactics = !raceFinished && !started && tacticsStage <= totalStages && tacticsStage > stagesCompleted && activeRiders(riders).length > 0;
  let tacticsAction: { label: string; onClick: () => void } | null = null;
  if (hasOpenTactics) {
    const progress = tacticsProgress(riders, overrides, tacticsStage);
    const at = tacticsAt;
    const label = !isStageRace
      ? t("stagePageV2.cta.setTacticsOneDay", { done: progress.done, total: progress.total })
      : at
        ? t("stagePageV2.cta.setTacticsLocks", { number: tacticsStage, done: progress.done, total: progress.total, time: timeLabelFor(at) })
        : t("stagePageV2.cta.setTactics", { number: tacticsStage, done: progress.done, total: progress.total });
    tacticsAction = { label, onClick: () => onOpenTactics(tacticsStage) };
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="sticky top-0 z-20 -my-2 flex flex-col gap-3 bg-cz-body py-2">
        <Tabs value={activeTab} onChange={(v) => onChangeTab(resolveV2Tab(v))}>
          <TabList label={t("stagePageV2.tabsAria")}>
            {STAGE_PAGE_V2_TABS.map((key) => (
              <Tab key={key} value={key}>{t(`stagePageV2.tab.${key}`)}</Tab>
            ))}
          </TabList>
        </Tabs>
        {activeTab === "stage" && isStageRace && (
          <StageStripV2 stages={stripStages} selected={selectedStage} today={todayStage} ridden={stagesCompleted} onSelect={onSelectStage} />
        )}
      </div>

      {activeTab === "stage" && (
        <StageTabV2
          key={selectedStage}
          stageNumber={selectedStage}
          stagesCompleted={stagesCompleted}
          isStageRace={isStageRace}
          phase={phase}
          profile={profileByStage[selectedStage] ?? null}
          results={results}
          stagePointRows={stagePointRows}
          profileByStage={profileByStage}
          stageLoaded={stageLoaded}
          stageErrorSlot={stageErrorSlot}
          myTeamId={myTeamId}
          stageRoles={stageRoles}
          careerEvents={careerEvents}
          dnfRows={dnfRows}
          tacticsAction={tacticsAction}
          onOpenStandings={() => onChangeTab("standings")}
          emptyState={emptyStageSlot}
          story={story}
          narrative={narrative}
        />
      )}
      {activeTab === "stage" && phase === "after" && (ranTimeline?.timeline_version ?? 1) >= 2 && (
        <StageOrdersRecap raceId={raceId} stageNumber={selectedStage} riderIds={ownStageRiders} nameOf={nameOfRider} profileType={profileByStage[selectedStage]?.profile_type ?? null} stageRoles={stageRoles} ranAt={ranTimeline?.created_at ?? null} teamOrders={knownOrders?.value ?? null} />
      )}
      {activeTab === "standings" && standingsSlot}
      {activeTab === "team" && teamSlot}
      {activeTab === "tactics" && tacticsSlot}
    </div>
  );
}
