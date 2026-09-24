// useFacilities — frontend-state for Klub (faciliteter + staff, #1441 A3).
// Henter /api/club/facilities (flag-gated: 403 facilities_disabled → enabled=false,
// præcis som useAcademy's 409). Eksponerer upgrade/hire/fire + candidates-loader.
// Backend er eneste flag-kilde → nav + side gater på `enabled` uden dobbelt-flag.
import { useState, useEffect, useCallback } from "react";
import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi
import { logEvent } from "./logEvent.js";
import { apiFetch } from "./apiFetch.ts"; // #5242: Retry-After-respekt paa 429 + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

export function useFacilities() {
  const [enabled, setEnabled] = useState(false);
  const [facilities, setFacilities] = useState([]);
  const [seasonCost, setSeasonCost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/api/club/facilities`, { headers });
      // #5242: catch'en herunder beholdt foer tidligere state uaendret (ingen fejl
      // vist) ved en transportfejl; apiFetch kaster ikke laengere (#5322), saa
      // grenen genindfoeres eksplicit — ellers ville en transportfejl falde i
      // !res.ok og vise en fejlbesked der foer aldrig blev vist.
      if (res.networkError) { setLoading(false); return; }
      const body = res.data || {};
      if (res.status === 403 && body.error === "facilities_disabled") { setEnabled(false); setLoading(false); return; }
      if (!res.ok) { setError(body.error || "failed"); setLoading(false); return; }
      const data = body;
      setEnabled(true);
      setFacilities(data.facilities ?? []);
      setSeasonCost(data.seasonCost ?? null);
      setError(null);
    } catch { /* netværk — behold state */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const upgrade = useCallback(async (track) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/club/facilities/upgrade`, { method: "POST", headers, body: JSON.stringify({ track }) });
      // #5242: catch'en herunder gav foer "network"; !res.ok giver "failed" —
      // grenen genindfoeres eksplicit (#5322).
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
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
      const res = await apiFetch(`${API}/api/club/staff/candidates?role=${encodeURIComponent(role)}`, { headers });
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      return { ok: true, candidates: data.candidates ?? [], facilityTier: data.facilityTier ?? 0 };
    } catch { return { ok: false, error: "network" }; }
  }, []);

  const hire = useCallback(async (role, candidateName) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/club/staff/hire`, { method: "POST", headers, body: JSON.stringify({ role, candidateName }) });
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("staff_hire", { role });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  // #3489: staffId er valgfri (bagudkompatibel) — angiv den for at ramme en
  // bestemt af de op til 2 samtidige aktive staff i rollen.
  const fire = useCallback(async (role, staffId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/club/staff/fire`, { method: "POST", headers, body: JSON.stringify({ role, staffId }) });
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      logEvent("staff_fire", { role });
      await refresh();
      return { ok: true, result: data };
    } catch { return { ok: false, error: "network" }; }
  }, [refresh]);

  return { enabled, facilities, seasonCost, loading, error, refresh, upgrade, loadCandidates, hire, fire };
}
