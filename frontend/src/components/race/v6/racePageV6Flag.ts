// #7778 · Kontakten race_page_v6 (off | beta | on) for løbssidens v6-ramme.
// Svaret evalueres server-side mod viewerens beta-status (GET /api/feature-flags).
// Fejl eller manglende svar = off, så siden ser ud som i dag.
//
// #7865 (punkt 7): siden tegnede først den gamle ramme og skiftede så til v6, når
// svaret kom. Den sidst kendte værdi huskes derfor i browseren og bruges til første
// billede; serverens svar vinder altid bagefter. En spiller uden kontakten venter
// aldrig: uden husket værdi (eller med off) tegnes den gamle side straks, som i dag.
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "../../../lib/playerFeatureFlags.js";
import { readLastRacePageV6, rememberedFromFlags, writeLastRacePageV6 } from "./racePageV6FlagCache.ts";

export const RACE_PAGE_V6_FLAG_KEY = "race_page_v6";

export function useRacePageV6Enabled(): boolean {
  const [enabled, setEnabled] = useState(() => readLastRacePageV6());
  useEffect(() => {
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => {
      const remembered = rememberedFromFlags(flags, RACE_PAGE_V6_FLAG_KEY);
      if (remembered !== null) writeLastRacePageV6(remembered);
      if (alive) setEnabled(remembered === true);
    });
    return () => { alive = false; };
  }, []);
  return enabled;
}
