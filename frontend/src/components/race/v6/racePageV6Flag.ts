// #7778 · Kontakten race_page_v6 (off | beta | on) for løbssidens v6-ramme.
// Svaret evalueres server-side mod viewerens beta-status (GET /api/feature-flags).
// Fejl eller manglende svar = off, så siden ser ud som i dag.
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "../../../lib/playerFeatureFlags.js";

export const RACE_PAGE_V6_FLAG_KEY = "race_page_v6";

export function useRacePageV6Enabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => {
      if (alive) setEnabled(flags?.[RACE_PAGE_V6_FLAG_KEY] === true);
    });
    return () => { alive = false; };
  }, []);
  return enabled;
}
