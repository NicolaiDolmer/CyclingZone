// useTeamPublicProfile — henter GET /api/teams/:id/public-profile (#2601: saniteret
// staff + faciliteter for ET VILKÅRLIGT hold, egen holdside eller andres). Samme
// auth-/enabled-mønster som useFacilities.js/useStaffDirectory.js (getSession() →
// Bearer-token; 403 facilities_disabled → enabled=false, IKKE en fejl).
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useTeamPublicProfile(teamId) {
  const [staff, setStaff] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!teamId) { setLoading(false); return; }
    setLoading(true);
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/teams/${teamId}/public-profile`, { headers });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "facilities_disabled") { setEnabled(false); setLoading(false); return; }
      }
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "failed"); setLoading(false); return; }
      const data = await res.json();
      setEnabled(true);
      setStaff(data.staff ?? []);
      setFacilities(data.facilities ?? []);
      setError(null);
    } catch { /* netværk — behold state */ } finally { setLoading(false); }
  }, [teamId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { staff, facilities, enabled, loading, error, refresh };
}
