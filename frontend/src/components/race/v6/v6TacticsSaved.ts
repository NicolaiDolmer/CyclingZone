// #7778 (Codex P2 fra #8211): Taktik giver løbssiden v6 besked, når et gem lykkes,
// så etapestribens "Gemt"/"Standardplan"/"Ikke gemt" opdateres straks og ikke først
// ved næste fane- eller etapeskift. Kun RacePageV6 sætter værdien; uden den (løbssiden
// uden v6) er den null, og Taktik opfører sig som før.
import { createContext, useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

export const V6TacticsSavedContext = createContext<(() => void) | null>(null);

/** Løbssidens gem-besked, eller null uden for v6. Skal være stabil (useCallback). */
export function useV6TacticsSaved(): (() => void) | null {
  return useContext(V6TacticsSavedContext);
}

/**
 * #8298 (wireframe v6c pkt. 28): Taktik fortæller løbssiden v6, hvor mange ryttere der
 * kører assistentens plan på den åbne etape, så hero'ens fristlinje kan sige det
 * ("7 riders ride the assistant's plan"). null uden for v6.
 */
export const V6TacticsSummaryContext = createContext<((summary: { stage: number; assistant: number } | null) => void) | null>(null);

export function useV6TacticsSummary(): ((summary: { stage: number; assistant: number } | null) => void) | null {
  return useContext(V6TacticsSummaryContext);
}

type TacticsSummary = { stage: number; assistant: number } | null;

/**
 * #8298: løbssidens side af beskeden. `report` gives til V6TacticsSummaryContext (stabil, ignorerer
 * et uændret tal); `note` er hero'ens tekst, eller null (intet tal, 0 ryttere, eller teksterne er
 * ikke hentet endnu). Holder RacePageV6 fri for tilstanden (#8275 rører samme fil).
 */
export function useV6TacticsSummaryNote(): { report: (summary: TacticsSummary) => void; note: string | null } {
  const [summary, setSummary] = useState<TacticsSummary>(null);
  const report = useCallback((next: TacticsSummary) => {
    setSummary((cur) => (cur?.stage === next?.stage && cur?.assistant === next?.assistant ? cur : next));
  }, []);
  const { t, ready } = useTranslation("tactics", { useSuspense: false });
  const note = summary && summary.assistant > 0 && ready ? t("hero.assistant", { count: summary.assistant }) : null;
  return { report, note };
}
