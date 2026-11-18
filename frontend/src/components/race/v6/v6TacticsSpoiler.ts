// #8388: løbssiden v6 fortæller Taktik, at spoiler-skjoldet skjuler den viste etape. Så henter
// etapeplanen ikke etapens forløb og viser kun planen (ingen udfald, placering eller km for skift).
// Kun RacePageV6 sætter værdien; uden for v6 er den false, og Taktik opfører sig som før.
import { createContext, useContext } from "react";

export const V6TacticsResultsHiddenContext = createContext<boolean>(false);

/** Skjuler spoiler-skjoldet den etape, Taktik viser? Altid false uden for v6. */
export function useV6TacticsResultsHidden(): boolean {
  return useContext(V6TacticsResultsHiddenContext);
}
