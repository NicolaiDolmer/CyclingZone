// useFacilities — frontend-state for Klub (faciliteter + staff, #1441 A3).
// Henter /api/club/facilities (flag-gated: 403 facilities_disabled → enabled=false,
// præcis som useAcademy's 409). Eksponerer upgrade/hire/fire + candidates-loader.
// Backend er eneste flag-kilde → nav + side gater på `enabled` uden dobbelt-flag.
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

export function useFacilities() {
  const [enabled, setEnabled] = useState(false);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/club/facilities`, { headers });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "facilities_disabled") { setEnabled(false); setLoading(false); return; }
      }
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "failed"); setLoading(false); return; }
      const data = await res.json();
      setEnabled(true);
      setFacilities(data.facilities ?? []);
      setError(null);
    } catch { /* netværk — behold state */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const upgrade = useCallback(async (track) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/facilities/upgrade`, { method: "POST", headers, body: JSON.stringify({ track }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("facility_upgrade", { track, tier: data.tier });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  const loadCandidates = useCallback(async (role) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/staff/candidates?role=${encodeURIComponent(role)}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      return { ok: true, candidates: data.candidates ?? [], facilityTier: data.facilityTier ?? 0 };
    } catch { return { ok: false, error: "network" }; }
  }, []);

  const hire = useCallback(async (role, candidateName) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/staff/hire`, { method: "POST", headers, body: JSON.stringify({ role, candidateName }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("staff_hire", { role });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  const fire = useCallback(async (role) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/club/staff/fire`, { method: "POST", headers, body: JSON.stringify({ role }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("staff_fire", { role });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  return { enabled, facilities, loading, error, refresh, upgrade, loadCandidates, hire, fire };
}
