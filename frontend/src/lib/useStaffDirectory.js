// useStaffDirectory — henter GET /api/staff/directory (#2450 personale-oversigt
// på tværs af hold). Samme auth-mønster som useFacilities.js/useStaffProfile.js
// (getSession() → Bearer-token, ingen delt apiFetch-util i repoet).
import { useState, useEffect, useCallback } from "react";
import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi
import { apiFetch } from "./apiFetch.ts"; // #5242: Retry-After-respekt paa 429 + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

export function useStaffDirectory({ includeAi = false } = {}) {
  const [staff, setStaff] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/api/staff/directory?includeAi=${includeAi ? "1" : "0"}`, { headers });
      // #5242: catch'en herunder beholdt foer tidligere state uaendret (ingen fejl
      // vist) ved en transportfejl; apiFetch kaster ikke laengere (#5322), saa
      // grenen genindfoeres eksplicit — ellers ville en transportfejl falde i
      // !res.ok og vise en fejlbesked der foer aldrig blev vist.
      if (res.networkError) { setLoading(false); return; }
      const body = res.data || {};
      if (res.status === 403 && body.error === "facilities_disabled") { setEnabled(false); setLoading(false); return; }
      if (!res.ok) { setError(body.error || "failed"); setLoading(false); return; }
      const data = body;
      setEnabled(true);
      setStaff(data.staff ?? []);
      setError(null);
    } catch { /* netværk — behold state */ } finally { setLoading(false); }
  }, [includeAi]);

  useEffect(() => { refresh(); }, [refresh]);

  return { staff, enabled, loading, error, refresh };
}
