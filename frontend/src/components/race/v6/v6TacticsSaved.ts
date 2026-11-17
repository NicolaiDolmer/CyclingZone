// #7778 (Codex P2 fra #8211): Taktik giver løbssiden v6 besked, når et gem lykkes,
// så etapestribens "Gemt"/"Standardplan"/"Ikke gemt" opdateres straks og ikke først
// ved næste fane- eller etapeskift. Kun RacePageV6 sætter værdien; uden den (løbssiden
// uden v6) er den null, og Taktik opfører sig som før.
import { createContext, useContext } from "react";

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
