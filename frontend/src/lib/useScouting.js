// useScouting — frontend-state for progression L1 (#1138).
//
// Henter holdets scout-state (slots + per-rytter niveau + eget team-id) fra
// backend én gang, og eksponerer en scout(riderId)-handling der bruger ét slot
// og opdaterer state fra svaret. Sider bruger `levelFor` + `teamId` til at
// beregne estimat-intervallet lokalt (display-lag v1, frontend/src/lib/scouting.js).

import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useScouting() {
  const [slots, setSlots] = useState(null);     // { total, used, remaining } | null
  const [maxLevel, setMaxLevel] = useState(3);
  const [levels, setLevels] = useState({});     // { <rider_id>: level }
  const [teamId, setTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoutingId, setScoutingId] = useState(null); // rytter under aktiv scout

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/scouting/me`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots ?? null);
        setMaxLevel(data.maxLevel ?? 3);
        setLevels(data.levels ?? {});
        setTeamId(data.teamId ?? null);
      }
    } catch {
      /* netværk — behold tidligere state, UI falder tilbage til uscoutet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Brug ét scout-slot på en rytter. Returnerer { ok, error?, level? }.
  const scout = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setScoutingId(riderId);
    try {
      const res = await fetch(`${API}/api/scouting/${riderId}`, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      if (data.slots) setSlots(data.slots);
      if (data.maxLevel) setMaxLevel(data.maxLevel);
      setLevels((prev) => ({ ...prev, [riderId]: data.level ?? (prev[riderId] ?? 0) + 1 }));
      return { ok: true, level: data.level };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setScoutingId(null);
    }
  }, []);

  const levelFor = useCallback((riderId) => levels[riderId] ?? 0, [levels]);

  return { slots, maxLevel, levels, teamId, loading, scoutingId, scout, refresh, levelFor };
}
