// usePlanner — frontend-state for Season Planner-cockpittet (spec §3/§5).
//
// Kilde: GET /api/peak-plans/board (ét aggregat: enabled + sæson + holdets ryttere
// m. peaks/tq/status + kalender m. egnetheds-input + rival-neutralisering). Mens
// peak_planner_enabled er 'off' rapporterer board'et enabled:false og
// SeasonPlannerPage viser en tom-state — samme kill-switch-mønster som
// useScoutingCentral/useFacilities. Al mutation går gennem CRUD-endpointsene +
// accept-training; hver muterings-succes refresher board'et.
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const EMPTY = { season: null, maxPerRider: 2, today: null, leadupDays: 14, riders: [], races: [] };

export function usePlanner() {
  const [enabled, setEnabled] = useState(false);
  const [board, setBoard] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/peak-plans/board`, { headers });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      if (data.enabled) {
        setBoard({
          season: data.season ?? null,
          maxPerRider: data.maxPerRider ?? 2,
          today: data.today ?? null,
          leadupDays: data.leadupDays ?? 14,
          riders: data.riders ?? [],
          races: data.races ?? [],
        });
      }
      setError(null);
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const mutate = useCallback(async (path, method, body) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/peak-plans${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed", status: res.status };
      await refresh();
      return { ok: true, ...data };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const createPeak = useCallback((riderId, targetRaceId) =>
    mutate("", "POST", { rider_id: riderId, target_race_id: targetRaceId }), [mutate]);
  const retargetPeak = useCallback((planId, targetRaceId) =>
    mutate(`/${planId}`, "PATCH", { target_race_id: targetRaceId }), [mutate]);
  const deletePeak = useCallback((planId) =>
    mutate(`/${planId}`, "DELETE"), [mutate]);
  const acceptTraining = useCallback((planId, week) =>
    mutate(`/${planId}/accept-training`, "POST", { week }), [mutate]);

  return {
    enabled, ...board, loading, error, busy,
    refresh, createPeak, retargetPeak, deletePeak, acceptTraining,
  };
}
