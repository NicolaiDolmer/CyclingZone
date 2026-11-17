// #7859 · Skjoldet for den valgte etapes Story (løbssiden v6 giver det videre).
//
// Story-kortet og "Din dag" ligger dybt inde i etapesiden (StagePageV2 → StageTabV2 →
// RaceStoryCard). En kontekst holder koblingen til få linjer i hver fil: uden en
// udbyder er skjoldet inaktivt, og alt tegnes som i dag.
import { createContext, useContext } from "react";

export interface SpoilerStory {
  /** Etapens resultat er skjult: filmen starter ved start, referatet stopper ved filmen. */
  active: boolean;
  /** Filmen er i mål: etapen åbnes (overalt og på alle enheder). */
  open: () => void;
  /** "Show results": etapen åbnes, og Resultater vises. */
  showResults: () => void;
}

export const INACTIVE_SPOILER_STORY: SpoilerStory = Object.freeze({ active: false, open: () => {}, showResults: () => {} });

export const SpoilerStoryContext = createContext<SpoilerStory>(INACTIVE_SPOILER_STORY);

export function useSpoilerStory(): SpoilerStory {
  return useContext(SpoilerStoryContext);
}
