// useAcademy — frontend-state for Akademi-MVP (#1308).
//
// Henter /api/academy/me (flag-gated), eksponerer signCandidate/rejectCandidate
// + pillar-events academy_sign / academy_reject. Spejler useTraining.

import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";
import { logEvent } from "./logEvent.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useAcademy() {
  const [enabled, setEnabled]   = useState(false);
  const [slots, setSlots]       = useState({ used: 0, max: 8 });
  const [roster, setRoster]     = useState([]);
  const [intake, setIntake]     = useState([]);
  const [freeAgents, setFreeAgents] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/academy/me`, { headers });
      if (res.status === 409) {
        // Flag disabled — graceful disabled state.
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
      const data = await res.json();
      setEnabled(data.enabled ?? false);
      setSlots(data.slots ?? { used: 0, max: 8 });
      setRoster(data.roster ?? []);
      setIntake(data.intake ?? []);
      setFreeAgents(data.freeAgents ?? []);
      setError(null);
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Sign-kandidat. Returnerer { ok, error? } (med brugervenlig fejlbesked).
  const signCandidate = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/academy/sign`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errKey = data.error || "failed";
        return { ok: false, error: errKey };
      }
      logEvent("academy_sign", { riderId });
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Afvis-kandidat. Returnerer { ok, error? }.
  const rejectCandidate = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/academy/reject`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_reject", { riderId });
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Direct-sign en fri ungdoms-free-agent til minimumsløn. Returnerer { ok, error? }.
  const signFreeAgent = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/academy/free-agent/sign`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_free_agent_sign", { riderId });
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  return { enabled, slots, roster, intake, freeAgents, loading, error, signCandidate, rejectCandidate, signFreeAgent, refresh };
}
