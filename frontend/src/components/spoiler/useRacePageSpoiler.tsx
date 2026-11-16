// #7859 · Løbssidens skjold samlet ét sted, så RacePageV6 kun får få linjer
// (andre spor ændrer også RacePageV6, #7861 og #8297).
//
// Slukket kontakt (eller fejl) = alt som i dag: ingen kontakt i hovedet, intet skjult,
// samme faner. Tændt og løbet skjult: en kørt etape, spilleren ikke har åbnet,
//   - åbner i Story (filmen), ikke i Resultater (billede 2),
//   - viser "Results are hidden · Show results" under Resultater (billede 3),
//   - står uden vinder og egen placering i etapestriben, og talrækkens
//     resultat-tal (mærket `spoiler` af siden) står ikke i hovedet,
//   - åbnes med ét tryk eller når filmen er i mål, overalt og på alle enheder (billede 4).
import { useCallback, useId, useMemo, type ReactNode } from "react";
import { SpoilerHeroNote, SpoilerHeroSwitch, SpoilerResultsHidden, SpoilerResultsPending } from "./SpoilerShield.tsx";
import { finishedStageTab, raceShielded, stageHidden, withoutHiddenStages, withoutSpoilerStats } from "./spoilerShieldModel.ts";
import type { SpoilerStory } from "./spoilerStoryContext.ts";
import { useRaceSpoilerShield } from "./useSpoilerShield.ts";

type Tab = string;

/** Har siden en ?tab= i adressen? Uden er fanen sidens standardvalg (som skjoldet må ændre). */
function tabInUrl(): boolean {
  try {
    return typeof window === "undefined" || new URLSearchParams(window.location.search).has("tab");
  } catch {
    return true; // catch-ok: ukendt adresse = rør ikke ved fanen
  }
}

export interface RacePageSpoiler {
  /** Fanen der vises: sidens standard "Resultater" bliver til Story for en skjult etape. */
  shownTab: <T extends Tab>(requested: T) => T;
  /** Fanen et klik i striben åbner en etape på. */
  tabFor: <T extends Tab>(stage: number, fallback: T) => T;
  /** Pr.-etape-data uden de skjulte etaper (striben). */
  visible: <T>(byStage: Record<number, T>) => Record<number, T>;
  /** Hovedet uden resultat-tal, mens en kørt etape er skjult. */
  hero: <H extends { stats: Array<{ spoiler?: boolean }> }>(hero: H) => H;
  heroAside: ReactNode;
  heroNote: ReactNode;
  /** Resultater for den valgte etape, når den er skjult; null = som i dag. */
  resultsBody: ReactNode;
  story: SpoilerStory;
}

export function useRacePageSpoiler({ raceId, selectedStage, stagesCompleted, onShowResults }: {
  raceId: string | null; selectedStage: number; stagesCompleted: number; onShowResults: () => void;
}): RacePageSpoiler {
  const { view, openStage, setRaceShield } = useRaceSpoilerShield(raceId);
  const switchId = useId();
  const hidden = useCallback((n: number) => stageHidden(view, n, stagesCompleted), [view, stagesCompleted]);
  const selectedHidden = hidden(selectedStage);
  const anyHidden = useMemo(() => {
    for (let n = 1; n <= stagesCompleted; n++) if (hidden(n)) return true;
    return false;
  }, [hidden, stagesCompleted]);

  const visible = useCallback(<T,>(byStage: Record<number, T>) => withoutHiddenStages(byStage, hidden), [hidden]);
  const shownTab = useCallback(<T extends Tab>(requested: T): T => {
    if (requested !== "results" || selectedStage > stagesCompleted || tabInUrl()) return requested;
    return finishedStageTab(view, { hidden: selectedHidden }) as T;
  }, [view, selectedHidden, selectedStage, stagesCompleted]);
  const tabFor = useCallback(<T extends Tab>(stage: number, fallback: T): T => (
    fallback === "results" && stage <= stagesCompleted ? finishedStageTab(view, { hidden: hidden(stage) }) as T : fallback
  ), [view, hidden, stagesCompleted]);
  const hero = useCallback(<H extends { stats: Array<{ spoiler?: boolean }> }>(h: H): H => (
    anyHidden ? { ...h, stats: withoutSpoilerStats(h.stats, true) } : h
  ), [anyHidden]);

  const show = useCallback(() => openStage(selectedStage), [openStage, selectedStage]);
  const story = useMemo<SpoilerStory>(() => ({
    active: selectedHidden,
    open: show,
    showResults: () => { show(); onShowResults(); },
  }), [selectedHidden, show, onShowResults]);

  const shielded = raceShielded(view);
  return {
    shownTab, tabFor, visible, hero, story,
    heroAside: view.enabled ? <SpoilerHeroSwitch id={switchId} on={shielded} onChange={setRaceShield} /> : null,
    heroNote: view.enabled && selectedHidden ? <SpoilerHeroNote /> : null,
    resultsBody: selectedHidden ? (view.pending ? <SpoilerResultsPending /> : <SpoilerResultsHidden onShow={show} />) : null,
  };
}
