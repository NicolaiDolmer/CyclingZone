// #8297 · Hvilket udseende taktik-editoren har. Løbssiden v6 (bag race_page_v6) sætter
// "v6c" omkring sin Taktik-fane; alle andre steder (den gamle løbsside, etapeside 2.0)
// er der ingen provider, og editoren tegner præcis som før ("classic").
// Logikken (gem-vejen, valideringen, holdplanerne) er den samme i begge udseender:
// kun visningen skifter.
import { createContext, useContext } from "react";

export type TacticsLayout = "classic" | "v6c";

export const TacticsLayoutContext = createContext<TacticsLayout>("classic");

/** Editorens udseende; "classic" uden provider. */
export function useTacticsLayout(): TacticsLayout {
  return useContext(TacticsLayoutContext);
}
