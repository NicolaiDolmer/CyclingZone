// useScoutHistory — historik-flade pr. spejder (#3203, Discord-løfte 27/7):
// hvilke ryttere har DENNE spejder (staffId) tidligere afsluttet en målrettet
// undersøgelse på. Henter GET /api/club/staff/:id/scouting-history — samme
// auth-mønster som useStaffProfile.js (getSession() → Bearer-token, ingen
// delt apiFetch-util i repoet).
import { useState, useEffect } from "react";
import { getSession } from "./supabase.js";
import { apiFetch } from "./apiFetch.ts"; // #5242: Retry-After-respekt paa 429 + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

export function useScoutHistory(staffId) {
  const [history, setHistory] = useState(null); // null = loader, [] = ægte tom historik
  const [maxLevel, setMaxLevel] = useState(3);   // SSOT: SCOUTING_CONFIG.maxLevel (backend)
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setHistory(null);
    setError(false);
    if (!staffId) return undefined;
    (async () => {
      const { data } = await getSession();
      const token = data?.session?.access_token;
      if (!token) { if (alive) setError(true); return; }
      try {
        const res = await apiFetch(`${API}/api/club/staff/${staffId}/scouting-history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("scouting_history_failed");
        const body = res.data || {};
        if (!alive) return;
        setHistory(body.history ?? []);
        if (body.maxLevel) setMaxLevel(body.maxLevel);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [staffId]);

  return { history, maxLevel, error };
}
