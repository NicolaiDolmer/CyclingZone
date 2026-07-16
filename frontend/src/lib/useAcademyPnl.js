// useAcademyPnl — frontend-state for Akademi-regnskabet (#2485, addendum V3).
//
// Henter /api/academy/pnl (samme flag-gate som useAcademy). Ren læse-flade,
// ingen mutations. Spejler useAcademy's fetch-mønster.

import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export function useAcademyPnl() {
  const [data, setData] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/academy/pnl`, { headers });
      if (res.status === 409) {
        // Flag disabled — spejler useAcademy's graceful disabled-state.
        const body = await res.json().catch(() => ({}));
        if (body.error === "academy_disabled") {
          setEnabled(false);
          setLoading(false);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "failed");
        setLoading(false);
        return;
      }
      const body = await res.json();
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
