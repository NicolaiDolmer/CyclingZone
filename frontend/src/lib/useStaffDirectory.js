// useStaffDirectory — henter GET /api/staff/directory (#2450 personale-oversigt
// på tværs af hold). Samme auth-mønster som useFacilities.js/useStaffProfile.js
// (getSession() → Bearer-token, ingen delt apiFetch-util i repoet).
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

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
      const res = await fetch(`${API}/api/staff/directory?includeAi=${includeAi ? "1" : "0"}`, { headers });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "facilities_disabled") { setEnabled(false); setLoading(false); return; }
      }
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "failed"); setLoading(false); return; }
      const data = await res.json();
      setEnabled(true);
      setStaff(data.staff ?? []);
      setError(null);
    } catch { /* netværk — behold state */ } finally { setLoading(false); }
  }, [includeAi]);

  useEffect(() => { refresh(); }, [refresh]);

  return { staff, enabled, loading, error, refresh };
}
