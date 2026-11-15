// #7535 · Kontakten til den nye planlaegningsside (app_config-noeglen planning_workbench, off|beta|on).
//
// Serveren evaluerer off|beta|on mod viewerens beta-status og svarer en enkelt boolean pr. noegle
// (GET /api/feature-flags). Standard er slukket: uden en raekke i app_config, ved en fejl og under
// hentningen er svaret "ikke tilsluttet", og den nuvaerende planlaegningsside staar uaendret.
// Hentes pr. komponent-instans og caches aldrig paa tvaers af brugere (et brugerskift i samme fane
// maa aldrig arve det forrige svar, jf. #7849).
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "./playerFeatureFlags.js";

export const PLANNING_WORKBENCH_FLAG_KEY = "planning_workbench";

/** @returns {boolean | null} null = hentes endnu, true = tilsluttet for denne spiller, false = slukket */
export function usePlanningWorkbenchFlag() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPlayerFeatureFlags().then((flags) => {
      if (!cancelled) setEnabled(flags?.[PLANNING_WORKBENCH_FLAG_KEY] === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
