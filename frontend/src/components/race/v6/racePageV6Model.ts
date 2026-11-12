// #7778 · Løbssiden v6, trin 1: rene regler for fanerne og hovedets handlingsrække.
//
// Beslutningslisten på #7778 (ejer 12/11):
//   valg 5: en kørt etape åbner på Resultater.
//   valg 8: ingen bannere; låse-fristen og den ene guld-knap står i hovedets handlingsrække.
// Taktik-knappens regel er den samme som etapeside 2.0 (StagePageV2): før etapen
// den valgte etape, efter den den næste, og kun mens etapen ikke er startet og
// holdet har ryttere i løbet.
import { activeRiders, scheduleFor, tacticsProgress, type RoleOverride, type RoleRider, type ScheduleRow } from "../stagePageV2/stagePageV2Model.ts";

/** Resultater først (valg 5). "stage" er etapens nuværende indhold (historien efter etapen). */
export const RACE_PAGE_V6_TABS = ["results", "stage", "standings", "tactics", "team"] as const;
export type RacePageV6Tab = (typeof RACE_PAGE_V6_TABS)[number];

/** Faner der handler om én etape og derfor viser etapestriben. */
export const STAGE_SCOPED_TABS: readonly RacePageV6Tab[] = ["results", "stage"];

/**
 * ?tab= → fane. Uden (gyldig) fane åbner en kørt etape på Resultater og en
 * kommende etape på Etape. Et endagsløb har ingen Stillinger-fane: resultatet
 * står på Resultater.
 */
export function resolveV6Tab(param: string | null, { ridden, isStageRace }: { ridden: boolean; isStageRace: boolean }): RacePageV6Tab {
  const tabs = v6Tabs(isStageRace);
  if (param && (tabs as readonly string[]).includes(param)) return param as RacePageV6Tab;
  return ridden ? "results" : "stage";
}

export function v6Tabs(isStageRace: boolean): readonly RacePageV6Tab[] {
  return isStageRace ? RACE_PAGE_V6_TABS : RACE_PAGE_V6_TABS.filter((t) => t !== "standings");
}

export interface TacticsCta {
  /** Etapen knappen åbner Taktik på. */
  stage: number;
  /** Etapens start (= låsetid); null når skemaet ikke kender den. */
  locksAt: Date | null;
  done: number;
  total: number;
}

/**
 * Hovedets handling: taktik for den etape der er åben, eller null. Samme regel
 * som StagePageV2's guld-knap, så knappen ikke flytter sig, når kontakten tændes.
 */
export function tacticsCta({
  selectedStage, stagesCompleted, totalStages, raceFinished, schedule, riders, overrides, nowMs,
}: {
  selectedStage: number; stagesCompleted: number; totalStages: number; raceFinished: boolean;
  schedule: ScheduleRow[]; riders: RoleRider[]; overrides: RoleOverride[]; nowMs: number;
}): TacticsCta | null {
  const before = selectedStage > stagesCompleted;
  const stage = before ? selectedStage : selectedStage + 1;
  const locksAt = scheduleFor(schedule, stage);
  const started = locksAt !== null && locksAt.getTime() <= nowMs;
  const open = !raceFinished && !started && stage <= totalStages && stage > stagesCompleted && activeRiders(riders).length > 0;
  if (!open) return null;
  const progress = tacticsProgress(riders, overrides, stage);
  return { stage, locksAt, done: progress.done, total: progress.total };
}
