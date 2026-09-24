// #5519: React-adgang til kontakten for U23 team- og Junior team-siderne.
//
// useYouthSquadPages(): true når siderne og menupunkterne skal vises, og
// Akademiets Coming soon-kort skal væk. Re-renderer hvis kontakten flipper
// mens siden er åben.
//
// useYouthSquadPagesSync(): kaldes ÉN gang af Layout. Henter kontakten via den
// delte display-flags-hentning (displayFlags.ts), så rating-kontakten og denne
// deler samme netværkskald.
import { useEffect, useSyncExternalStore } from "react";
import { loadDisplayFlags } from "./displayFlags.ts";
import { isYouthSquadPagesOn, setYouthSquadPages, subscribeYouthSquadPages } from "./youthSquadPages.ts";

// Prerender/SSR: dagens visning (off).
const serverSnapshot = (): boolean => false;

export function useYouthSquadPages(): boolean {
  return useSyncExternalStore(subscribeYouthSquadPages, isYouthSquadPagesOn, serverSnapshot);
}

export function useYouthSquadPagesSync(): void {
  useEffect(() => {
    let cancelled = false;
    void loadDisplayFlags().then((flags) => {
      // null = fejl/429/401: behold sidst kendte værdi, ingen blink til off.
      if (cancelled || !flags) return;
      setYouthSquadPages(flags.youth_squad_pages === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
