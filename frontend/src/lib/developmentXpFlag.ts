// #8476 · XP-kontakten (development_xp_model) for de flader, der under XP ikke må vise
// loft, mål, skarpe dage eller point betalt fra bjælken som dagens træning.
// Svaret evalueres server-side (GET /api/feature-flags); fejl eller manglende svar = off,
// så fladerne ser ud som i dag. Med kontakten slukket ændrer intet sig.
//
// Opslaget deles mellem de flader, der monteres samtidig, og det seneste svar huskes, så
// en flade der monteres senere i samme session starter med det kendte svar.
import { useEffect, useState } from "react";

export const DEVELOPMENT_XP_FLAG_KEY = "development_xp_model";
const SHARE_MS = 5000;

let shared: { at: number; promise: Promise<boolean> } | null = null;
let lastKnown = false;

function readXpFlag(): Promise<boolean> {
  const now = Date.now();
  if (!shared || now - shared.at > SHARE_MS) {
    shared = {
      at: now,
      promise: import("./playerFeatureFlags.js")
        .then(({ fetchPlayerFeatureFlags }) => fetchPlayerFeatureFlags() as Promise<Record<string, boolean>>)
        .then((flags) => flags?.[DEVELOPMENT_XP_FLAG_KEY] === true)
        .catch(() => false), // catch-ok: ukendt = off, som i dag
    };
  }
  return shared.promise;
}

export function useDevelopmentXpEnabled(): boolean {
  const [enabled, setEnabled] = useState(lastKnown);
  useEffect(() => {
    let alive = true;
    readXpFlag().then((on) => {
      lastKnown = on;
      if (alive) setEnabled(on);
    });
    return () => { alive = false; };
  }, []);
  return enabled;
}
