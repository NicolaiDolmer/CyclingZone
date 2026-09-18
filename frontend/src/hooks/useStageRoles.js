// useStageRoles — GET /api/races/:raceId/stage-roles for løbssidens faner (#4613).
//
// Overblik-fanen (hvad er stadig åbent?) og Hold-fanen (hvem kører, med hvilken
// rolle) læser samme svar. Én hook i stedet for to næsten-ens fetch-blokke, med
// den samme tre-tilstands-kontrakt resten af fladerne bruger:
//
//   null   henter endnu
//   false  hentningen fejlede — vis en fejl + prøv igen, ALDRIG en tom tilstand
//          der ligner "intet sat" (#2849's silent-degradation-fund)
//   objekt svaret
//
// Fanerne er monteret én ad gangen, så det er ét kald pr. fane-skift, ikke to
// samtidige.

import { useState, useEffect, useCallback } from "react";
import { authHeaders } from "../lib/supabase";
import { apiFetch } from "../lib/apiFetch.ts"; // #5242: Retry-After-respekt + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

export function useStageRoles(raceId, { skip = false } = {}) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const headers = await authHeaders({ json: false });
    if (!headers) { setData(false); return; }
    try {
      const res = await apiFetch(`${API}/api/races/${raceId}/stage-roles`, { headers });
      if (!res.ok) { setData(false); return; } // dækker også limited/unauthorized/networkError
      setData(res.data);
    } catch {
      setData(false);
    }
  }, [raceId]);

  useEffect(() => {
    if (skip) return;
    setData(null);
    load();
  }, [skip, load]);

  return { data, reload: load };
}
