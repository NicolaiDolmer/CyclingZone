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
// #8419: naar baade denne og planning_workbench er taendt, er den nye side standard paa /planning.
export const PLANNING_V2_DEFAULT_FLAG_KEY = "planning_v2_default_8419";

/** @returns {boolean | null} null = hentes endnu, true = tilsluttet for denne spiller, false = slukket */
export function usePlanningWorkbenchFlag() {
  return usePlanningFlags()?.workbench ?? null;
}

/**
 * #8419: begge planlaegnings-kontakter i ét kald. null = hentes endnu. v2Default er kun sand, naar
 * ogsaa planning_workbench er taendt (den nye side findes ikke uden den).
 */
export function usePlanningFlags(): { workbench: boolean; v2Default: boolean } | null {
  const [flags, setFlags] = useState<{ workbench: boolean; v2Default: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPlayerFeatureFlags().then((all) => {
      if (cancelled) return;
      const workbench = all?.[PLANNING_WORKBENCH_FLAG_KEY] === true;
      setFlags({ workbench, v2Default: workbench && all?.[PLANNING_V2_DEFAULT_FLAG_KEY] === true });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return flags;
}
