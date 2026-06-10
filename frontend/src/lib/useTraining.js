// useTraining — frontend-state for progression L2 teaser (#1163).
//
// Henter holdets træningsstate (slots + per-rytter aktiv plan + eget team-id) fra
// backend, og eksponerer setPlan(riderId, focus, intensity) + clearPlan(riderId).
// Spejler useScouting (#1138). Effekten lander ved sæson-skift (gated bag #1137).

import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase";
import { logEvent } from "./logEvent";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useTraining() {
  const [slots, setSlots] = useState(null);     // { total, used, remaining } | null
  const [plans, setPlans] = useState({});       // { <rider_id>: { focus, intensity } }
  const [teamId, setTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null); // rytter under aktiv save/clear

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/training/me`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots ?? null);
        setPlans(data.plans ?? {});
        setTeamId(data.teamId ?? null);
      }
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Sæt/ændr en træningsfokus på en egen rytter. Returnerer { ok, error? }.
  const setPlan = useCallback(async (riderId, focus, intensity) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setSavingId(riderId);
    try {
      const res = await fetch(`${API}/api/training/${riderId}`, {
        method: "POST", headers, body: JSON.stringify({ focus, intensity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      if (data.slots) setSlots(data.slots);
      setPlans((prev) => ({ ...prev, [riderId]: data.plan ?? { focus, intensity } }));
      // Pillar-event (#1168): trænings-funnellen til go/no-go. Consent-gated i logEvent.
      logEvent("training_focus_set", { focus, intensity });
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setSavingId(null);
    }
  }, []);

  // Fjern en træningsfokus (frigør slottet). Returnerer { ok, error? }.
  const clearPlan = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setSavingId(riderId);
    try {
      const res = await fetch(`${API}/api/training/${riderId}`, { method: "DELETE", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      if (data.slots) setSlots(data.slots);
      setPlans((prev) => { const next = { ...prev }; delete next[riderId]; return next; });
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setSavingId(null);
    }
  }, []);

  const planFor = useCallback((riderId) => plans[riderId] ?? null, [plans]);

  return { slots, plans, teamId, loading, savingId, setPlan, clearPlan, planFor, refresh };
}
