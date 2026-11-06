// #7717 · Kontakten rider_why_button (off | beta | on) for Hvorfor?-knappen.
// Svaret evalueres server-side mod viewerens beta-status (GET /api/feature-flags).
// Fejl eller manglende svar = off, saa "Your day" ser ud som i dag.
import { useEffect, useState } from "react";
import { fetchPlayerFeatureFlags } from "./playerFeatureFlags.js";

export const RIDER_WHY_FLAG_KEY = "rider_why_button";

export function useRiderWhyEnabled(active = true): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => {
      if (alive) setEnabled(flags?.[RIDER_WHY_FLAG_KEY] === true);
    });
    return () => { alive = false; };
  }, [active]);
  return enabled;
}
