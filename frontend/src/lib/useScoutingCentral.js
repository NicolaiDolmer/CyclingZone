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
import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi
import { sharedRequestCache, SHARED_KEYS, SHARED_TTL_MS } from "./sharedRequestCache.js";
import { apiFetch } from "./apiFetch.ts"; // #5242: Retry-After-respekt paa 429 + centraliseret 401-vej

const API = import.meta.env.VITE_API_URL;

export function useScoutingCentral() {
  const [enabled, setEnabled] = useState(false);
  const [scout, setScout] = useState(null);
  const [active, setActive] = useState([]);
  const [completed, setCompleted] = useState([]);
  // #2721: holds-bred target-historik, afkoblet fra completed's mission-delte
  // 20-cap (se scoutAssignmentService.loadTeamScoutHistory for hvorfor).
  const [teamHistory, setTeamHistory] = useState([]);
  const [capacity, setCapacity] = useState(1);
  const [jobConfig, setJobConfig] = useState(null); // { targetEtaMinutes, targetCostPerLevel, missionDays, missionCost } | null (før første fetch)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      // #5089: samme globale endpoint som useScouting bruger. Layout mounter
      // denne hook paa HVER side, saa uden deling kostede enhver rytterprofil
      // to GET /api/scouting/me. Mutationerne nedenfor invaliderer.
      const me = await sharedRequestCache.get(
        SHARED_KEYS.scoutingMe,
        async () => {
          // catch-ok: bobler ud gennem sharedRequestCache.get() til refresh()s
          // egen try/catch/finally, som rydder loading-tilstanden.
          const meRes = await apiFetch(`${API}/api/scouting/me`, { headers }); // catch-ok
          if (!meRes.ok) throw new Error("scouting_me_failed"); // apiFetch: ok:false ogsaa ved networkError, saa uaendret
          return meRes.data;
        },
        SHARED_TTL_MS.scoutingMe,
      );
      const systemEnabled = Boolean(me.scoutSystemEnabled);
      setEnabled(systemEnabled);
      if (!systemEnabled) { setLoading(false); return; }

      const res = await apiFetch(`${API}/api/scouting/central`, { headers });
      // #5242: catch'en herunder beholdt foer tidligere state uaendret (ingen
      // fejl vist) ved en transportfejl; apiFetch kaster ikke laengere (#5322),
      // saa grenen genindfoeres eksplicit her — ellers ville en transportfejl nu
      // falde i !res.ok og vise en fejlbesked der foer aldrig blev vist.
      if (res.networkError) { setLoading(false); return; }
      if (!res.ok) {
        const body = res.data || {};
        setError(body.error || "failed");
        setLoading(false);
        return;
      }
      const data = res.data;
      setScout(data.scout ?? null);
      setActive(data.active ?? []);
      setCompleted(data.completed ?? []);
      setTeamHistory(data.teamHistory ?? []);
      setCapacity(data.capacity ?? 1);
      setJobConfig(data.jobConfig ?? null);
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
      const res = await apiFetch(`${API}/api/scouting/assignments`, {
        method: "POST", headers, body: JSON.stringify({ kind: "target", riderId }),
      });
      // #5242: eksplicit netvaerksfejl-gren (#5322) — se startTarget/startMission/
      // cancelAssignment: catch'en gav foer "network", !res.ok giver "failed".
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      sharedRequestCache.invalidate(SHARED_KEYS.scoutingMe); // #5089: holdtilstand aendret
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
      const res = await apiFetch(`${API}/api/scouting/assignments`, {
        method: "POST", headers, body: JSON.stringify({ kind: "mission", criteria }),
      });
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      sharedRequestCache.invalidate(SHARED_KEYS.scoutingMe); // #5089: holdtilstand aendret
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
      const res = await apiFetch(`${API}/api/scouting/assignments/${assignmentId}/cancel`, {
        method: "POST", headers,
      });
      if (res.networkError) return { ok: false, error: "network" };
      const data = res.data || {};
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      sharedRequestCache.invalidate(SHARED_KEYS.scoutingMe); // #5089: holdtilstand aendret
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  return {
    enabled, scout, active, completed, teamHistory, capacity, jobConfig, loading, error, busy,
    refresh, startTarget, startMission, cancelAssignment,
  };
}
