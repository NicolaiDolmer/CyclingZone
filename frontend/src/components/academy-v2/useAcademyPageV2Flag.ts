// #8081 · Kontakten til akademisiden udgave A (app_config-nøglen academy_page_v2_8081, off|beta|on).
//
// Serveren evaluerer off|beta|on mod viewerens beta-status og svarer en boolean pr. nøgle
// (GET /api/feature-flags). Uden række, ved en fejl og under hentningen er svaret "ikke tændt",
// og akademisiden står uændret. Hentes pr. komponent-instans og caches aldrig på tværs af
// brugere (samme valg som usePlanningWorkbenchFlag, #7849).
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { ACADEMY_PAGE_V2_FLAG_KEY } from "./academyV2Model.ts";

/** @returns null = hentes endnu, true = tændt for denne spiller, false = slukket */
export function useAcademyPageV2Flag(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => {
      if (!cancelled) setEnabled(flags?.[ACADEMY_PAGE_V2_FLAG_KEY] === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
