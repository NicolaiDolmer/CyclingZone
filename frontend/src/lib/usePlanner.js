// usePlanner — frontend-state for Season Planner-cockpittet (spec §3/§5).
//
// Kilde: GET /api/peak-plans/board (ét aggregat: enabled + sæson + holdets ryttere
// m. peaks/tq/status + kalender m. egnetheds-input + rival-neutralisering). Mens
// peak_planner_enabled er 'off' rapporterer board'et enabled:false og
// SeasonPlannerPage viser en tom-state — samme kill-switch-mønster som
// useScoutingCentral/useFacilities. Al mutation går gennem CRUD-endpointsene +
// accept-training; hver muterings-succes refresher board'et.
//
// #2455 assistent-forslag: rider.peaks kan indeholde `isSuggestion:true`-poster
// (RENT beregnet server-side, aldrig en ægte rider_peak_plans-række — se
// backend/lib/peakSuggestions.js). "Acceptér" en foreslået peak = samme
// createPeak-kald som en manuel peak (serveren genskaber præcis samme vindue,
// deterministisk); "nulstil til blank" er et separat sæson-scoped write.
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const EMPTY = { season: null, availableSeasons: [], maxPerRider: 2, today: null, leadupDays: 14, riders: [], races: [] };

// #2518: seasonNumber = null → backend defaulter til aktiv sæson (uændret
// adfærd); et eksplicit nummer (fra sæson-vælgeren i SeasonPlannerPage) lader
// manageren planlægge mod en ANDEN sæson (fx S2 før den starter, jf. #2449).
export function usePlanner(seasonNumber = null) {
  const [enabled, setEnabled] = useState(false);
  const [board, setBoard] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const qs = seasonNumber != null ? `?season_number=${seasonNumber}` : "";
      const res = await fetch(`${API}/api/peak-plans/board${qs}`, { headers });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      if (data.enabled) {
        setBoard({
          season: data.season ?? null,
          availableSeasons: data.availableSeasons ?? [],
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
  }, [seasonNumber]);

  useEffect(() => { refresh(); }, [refresh]);

  const mutate = useCallback(async (path, method, body) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const payload = (body || seasonNumber != null)
        ? { ...(body || {}), ...(seasonNumber != null ? { season_number: seasonNumber } : {}) }
        : undefined;
      const res = await fetch(`${API}/api/peak-plans${path}`, {
        method, headers, body: payload ? JSON.stringify(payload) : undefined,
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
  }, [refresh, seasonNumber]);

  const createPeak = useCallback((riderId, targetRaceId) =>
    mutate("", "POST", { rider_id: riderId, target_race_id: targetRaceId }), [mutate]);
  const retargetPeak = useCallback((planId, targetRaceId) =>
    mutate(`/${planId}`, "PATCH", { target_race_id: targetRaceId }), [mutate]);
  const deletePeak = useCallback((planId) =>
    mutate(`/${planId}`, "DELETE"), [mutate]);
  const acceptTraining = useCallback((planId, week) =>
    mutate(`/${planId}/accept-training`, "POST", { week }), [mutate]);
  // #2455: acceptér et assistent-forslag = opret det som en ægte peak (samme
  // endpoint/vindue-snap som en manuel peak — forslaget HAR ingen egen DB-id).
  const acceptSuggestion = useCallback((riderId, targetRaceId) =>
    mutate("", "POST", { rider_id: riderId, target_race_id: targetRaceId }), [mutate]);
  const dismissSuggestions = useCallback((riderId) =>
    mutate("/dismiss-suggestions", "POST", { rider_id: riderId }), [mutate]);

  return {
    enabled, ...board, loading, error, busy,
    refresh, createPeak, retargetPeak, deletePeak, acceptTraining,
    acceptSuggestion, dismissSuggestions,
  };
}
