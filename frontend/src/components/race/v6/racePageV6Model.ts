// #7778 · Løbssiden v6, trin 1: rene regler for fanerne og hovedets handlingsrække.
//
// Beslutningslisten på #7778 (ejer 12/11):
//   valg 5: en kørt etape åbner på Resultater.
//   valg 8: ingen bannere; låse-fristen og den ene guld-knap står i hovedets handlingsrække.
// #7865: hovedet er løbets og står stille, når man klikker i etapestriben; tal-rækken,
// statuschippen, låse-fristen og guld-knappen står sammen (tacticsCta nedenfor).
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
 * Hovedets handling: taktik for løbets næste åbne etape, eller null.
 * #7865: hovedet er løbets, ikke den valgte etapes, så det står stille, når man
 * klikker i etapestriben. Den åbne etape er den første ukørte etape, der ikke er
 * startet (en etape på vejen er låst; så er den næste åben). Kun mens løbet ikke
 * er slut og holdet har ryttere i løbet.
 */
export function tacticsCta({
  stagesCompleted, totalStages, raceFinished, schedule, riders, overrides, nowMs,
}: {
  stagesCompleted: number; totalStages: number; raceFinished: boolean;
  schedule: ScheduleRow[]; riders: RoleRider[]; overrides: RoleOverride[]; nowMs: number;
}): TacticsCta | null {
  if (raceFinished || activeRiders(riders).length === 0) return null;
  for (let stage = stagesCompleted + 1; stage <= totalStages; stage++) {
    const locksAt = scheduleFor(schedule, stage);
    if (locksAt !== null && locksAt.getTime() <= nowMs) continue;
    const progress = tacticsProgress(riders, overrides, stage);
    return { stage, locksAt, done: progress.done, total: progress.total };
  }
  return null;
}

/**
 * #7865: Resultater for den valgte etape. "on_road" = etapen er startet, men ikke
 * afgjort (den næste etape efter de kørte, og dens start er passeret).
 */
export type V6ResultsPhase = "ridden" | "on_road" | "not_ridden";

export function v6ResultsPhase({ selectedStage, stagesCompleted, raceFinished, schedule, nowMs }: {
  selectedStage: number; stagesCompleted: number; raceFinished: boolean; schedule: ScheduleRow[]; nowMs: number;
}): V6ResultsPhase {
  if (selectedStage <= stagesCompleted) return "ridden";
  if (raceFinished || selectedStage !== stagesCompleted + 1) return "not_ridden";
  const startsAt = scheduleFor(schedule, selectedStage);
  return startsAt !== null && startsAt.getTime() <= nowMs ? "on_road" : "not_ridden";
}

/**
 * #7865: den ene etapestribe. Resultater og Etape følger sidens valgte etape;
 * Taktik følger Taktik-fanens etape (og styrer editoren, der ikke har sin egen
 * vælger under v6). Stillinger og Hold har ingen stribe; et endagsløb heller ikke.
 */
export function v6Strip({ activeTab, isStageRace, selectedStage, tacticsStage }: {
  activeTab: RacePageV6Tab; isStageRace: boolean; selectedStage: number; tacticsStage: number;
}): { selected: number; target: "page" | "tactics" } | null {
  if (!isStageRace) return null;
  if (activeTab === "tactics") return { selected: tacticsStage, target: "tactics" };
  if (STAGE_SCOPED_TABS.includes(activeTab)) return { selected: selectedStage, target: "page" };
  return null;
}

/**
 * #7865 (punkt 8): kun v6's egen resultatvisning for en etape er bygget til den
 * brede side (loft 1600 px); de genbrugte faner står på deres egen bredde (max-w-5xl).
 */
export function v6BodyIsWide({ activeTab, isStageRace }: { activeTab: RacePageV6Tab; isStageRace: boolean }): boolean {
  return activeTab === "results" && isStageRace;
}

/**
 * #7865 (punkt 3): hvad planen mod det der skete viser på en kørt etape. Den låste
 * oversigt over roller, indsats og holdplan står altid under den; "hidden" = intet
 * at sammenligne (enkeltstart og holdtidskørsel, ingen optegnelse, ingen egne
 * ryttere i optegnelsen), så oversigten står alene i stedet for en tom besked.
 */
export type TacticsAfterView = "hidden" | "loading" | "error" | "no_orders" | "compare";

export function tacticsAfterView({ timeTrial, resultsState, timelineLoading, timelineMissing, ordersPending, ordersMissing, riderCount }: {
  timeTrial: boolean; resultsState: StageResultsState; timelineLoading: boolean; timelineMissing: boolean;
  ordersPending: boolean; ordersMissing: boolean; riderCount: number;
}): TacticsAfterView {
  if (timeTrial) return "hidden";
  if (resultsState === "failed") return "error";
  if (resultsState === "loading" || timelineLoading) return "loading";
  if (timelineMissing) return "hidden";
  if (ordersPending) return "loading";
  if (ordersMissing) return "no_orders";
  return riderCount > 0 ? "compare" : "hidden";
}

/**
 * #7865: Taktik-fanens etape. `requested` er den seneste eksplicitte navigation
 * (Taktiks egen stribe eller hovedets guld-knap; siden ejer den og nulstiller den,
 * når fanen forlades). Uden den åbner fanen på etapen guld-knappen nævner, ellers
 * på den valgte etape. Den sidste handling vinder altid, så guld-knappen åbner
 * editoren, også når en kørt etape står valgt i striben.
 */
export function v6TacticsStage({ requested, ctaStage, selectedStage }: { requested: number | null | undefined; ctaStage: number | null | undefined; selectedStage: number }): number {
  return requested ?? ctaStage ?? selectedStage;
}

/** En etapes resultater, som siden henter dem pr. etape (stageFetchState). */
export type StageResultsState = "loaded" | "loading" | "failed";

/**
 * #7865: planen mod det der skete bygger på etapens resultater (placeringer og egne
 * ryttere). null = ingen sammenligning (fanen er ikke Taktik, eller etapen er ikke kørt);
 * ellers etapens hentetilstand. Uden kendt tilstand (ældre kald) regnes den for hentet.
 */
export function v6TacticsResults({ activeTab, stage, stagesCompleted, stateFor }: {
  activeTab: RacePageV6Tab; stage: number; stagesCompleted: number; stateFor?: ((n: number) => StageResultsState) | null;
}): StageResultsState | null {
  if (activeTab !== "tactics" || stage > stagesCompleted) return null;
  return stateFor ? stateFor(stage) : "loaded";
}
