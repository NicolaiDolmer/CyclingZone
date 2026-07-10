// useScoutingCentral — frontend-state for Scouting-central (#2244 Fase 3 Slice C).
//
// Kilde: GET /api/scouting/me (scoutSystemEnabled — samme kill-switch-semantik som
// facilities/academy) + GET /api/scouting/central (scout, active/completed opgaver,
// kapacitet). Mens systemet er 'off' rapporterer siden `enabled:false` og
// ScoutingCentralPage viser en tom-state, matchende useFacilities-mønsteret.
//
// Al mutation (start målrettet/mission, annullér) går gennem POST
// /api/scouting/assignments[/:id/cancel] — rå potentiale forlader aldrig serveren
// her (getScoutState returnerer kun assignment-rækker, ingen riders.potentiale).
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useScoutingCentral() {
  const [enabled, setEnabled] = useState(false);
  const [scout, setScout] = useState(null);
  const [active, setActive] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [capacity, setCapacity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const meRes = await fetch(`${API}/api/scouting/me`, { headers });
      if (!meRes.ok) { setLoading(false); return; }
      const me = await meRes.json();
      const systemEnabled = Boolean(me.scoutSystemEnabled);
      setEnabled(systemEnabled);
      if (!systemEnabled) { setLoading(false); return; }

      const res = await fetch(`${API}/api/scouting/central`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "failed");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setScout(data.scout ?? null);
      setActive(data.active ?? []);
      setCompleted(data.completed ?? []);
      setCapacity(data.capacity ?? 1);
      setError(null);
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startTarget = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/scouting/assignments`, {
        method: "POST", headers, body: JSON.stringify({ kind: "target", riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      await refresh();
      return { ok: true, assignment: data.assignment };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const startMission = useCallback(async (criteria) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/scouting/assignments`, {
        method: "POST", headers, body: JSON.stringify({ kind: "mission", criteria }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      await refresh();
      return { ok: true, assignment: data.assignment };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const cancelAssignment = useCallback(async (assignmentId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/scouting/assignments/${assignmentId}/cancel`, {
        method: "POST", headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  return {
    enabled, scout, active, completed, capacity, loading, error, busy,
    refresh, startTarget, startMission, cancelAssignment,
  };
}
