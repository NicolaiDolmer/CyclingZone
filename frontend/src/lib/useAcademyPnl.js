// useAcademyPnl — frontend-state for Akademi-regnskabet (#2485, addendum V3).
//
// Henter /api/academy/pnl (samme flag-gate som useAcademy). Ren læse-flade,
// ingen mutations. Spejler useAcademy's fetch-mønster.

import { useState, useEffect, useCallback } from "react";
import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi
import { apiFetch } from "./apiFetch.ts"; // #5242: Retry-After-respekt paa 429 + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

export function useAcademyPnl() {
  const [data, setData] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const headers = await authHeaders({ json: false }); // ren GET, ingen body
    if (!headers) { setLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/api/academy/pnl`, { headers });
      // #5242: catch'en herunder satte foer "network" ved en transportfejl; apiFetch
      // kaster ikke laengere (#5322), saa grenen genindfoeres eksplicit her for at
      // holde adfaerden uaendret (ellers ville den falde i !res.ok's "failed").
      if (res.networkError) { setError("network"); setLoading(false); return; }
      const body = res.data || {};
      if (res.status === 409) {
        // Flag disabled — spejler useAcademy's graceful disabled-state.
        if (body.error === "academy_disabled") {
          setEnabled(false);
          setLoading(false);
          return;
        }
      }
      if (!res.ok) {
        setError(body.error || "failed");
        setLoading(false);
        return;
      }
      setData(body);
      setEnabled(true);
      setError(null);
    } catch {
      setError("network");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, enabled, loading, error, refresh };
}
