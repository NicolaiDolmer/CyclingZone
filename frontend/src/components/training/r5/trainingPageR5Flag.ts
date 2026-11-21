// #7947 · Kontakten training_page_r5: viser Traenings I dag-fane i R5-udgaven.
// Svaret evalueres server-side (GET /api/feature-flags, binaert: kun "on" taender).
// Fejl eller manglende svar = off, saa siden ser praecis ud som i dag.
import { useEffect, useState } from "react";

export const TRAINING_PAGE_R5_FLAG_KEY = "training_page_r5";

/** Kun et eksplicit true taender; alt andet (manglende noegle, fejl, "beta") er off. */
export function trainingR5On(flags: Record<string, unknown> | null | undefined): boolean {
  return flags?.[TRAINING_PAGE_R5_FLAG_KEY] === true;
}

export function useTrainingPageR5(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    import("../../../lib/playerFeatureFlags.js")
      .then(({ fetchPlayerFeatureFlags }) => fetchPlayerFeatureFlags() as Promise<Record<string, boolean>>)
      .then((flags) => { if (alive) setOn(trainingR5On(flags)); })
      .catch(() => { if (alive) setOn(false); }); // catch-ok: ukendt = off, som i dag
    return () => { alive = false; };
  }, []);
  return on;
}
