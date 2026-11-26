// #7947 · Kontakten training_w1_v2: Program-fanen efter ejerens W1-design 26/11
// (ugeplanen foerst, "Plan for" med Alle ryttere, egen Grupper-fane, indsats som tre knapper).
// Gaelder kun sammen med training_page_r5. Svaret evalueres server-side (GET /api/feature-flags,
// binaert: kun "on" taender). Fejl eller manglende svar = off, saa Program ser ud som i dag.
import { useEffect, useState } from "react";

export const TRAINING_W1_V2_FLAG_KEY = "training_w1_v2";

/** Kun et eksplicit true taender; alt andet (manglende noegle, fejl, "beta") er off. */
export function trainingW1V2On(flags: Record<string, unknown> | null | undefined): boolean {
  return flags?.[TRAINING_W1_V2_FLAG_KEY] === true;
}

export function useTrainingW1V2(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    import("../../../lib/playerFeatureFlags.js")
      .then(({ fetchPlayerFeatureFlags }) => fetchPlayerFeatureFlags() as Promise<Record<string, boolean>>)
      .then((flags) => { if (alive) setOn(trainingW1V2On(flags)); })
      .catch(() => { if (alive) setOn(false); }); // catch-ok: ukendt = off, som i dag
    return () => { alive = false; };
  }, []);
  return on;
}
