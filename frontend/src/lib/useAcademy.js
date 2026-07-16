// useAcademy — frontend-state for Akademi-MVP (#1308).
//
// Henter /api/academy/me (flag-gated), eksponerer signCandidate/rejectCandidate
// + pillar-events academy_sign / academy_reject. Spejler useTraining.

import { useState, useEffect, useCallback } from "react";
import { getSession, supabase } from "./supabase.js";
import { getAuthedUser } from "./getAuthedUser.js";
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
  const [graduations, setGraduations] = useState([]);
  const [seniorCount, setSeniorCount] = useState(0);
  const [seniorMax, setSeniorMax] = useState(30);
  const [balance, setBalance]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  // Holdets saldo hentes direkte fra Supabase (samme mønster som AuctionsPage) — så
  // bekræftelses-modalen (#1744) kan vise saldo-effekt uden en backend-ændring på
  // /api/academy/me (ejes af en anden fleet-agent). Fejl er ikke-kritiske: saldo-
  // raekken udelades blot hvis hentningen fejler.
  const refreshBalance = useCallback(async () => {
    try {
      const user = await getAuthedUser();
      if (!user?.id) return;
      const { data: team } = await supabase
        .from("teams")
        .select("balance")
        .eq("user_id", user.id)
        .single();
      if (team && team.balance != null) setBalance(Number(team.balance));
    } catch {
      /* saldo er nice-to-have — behold tidligere state */
    }
  }, []);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    refreshBalance();
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
      setGraduations(data.graduations ?? []);
      setSeniorCount(data.seniorCount ?? 0);
      setSeniorMax(data.seniorMax ?? 30);
      setError(null);
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, [refreshBalance]);

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

  // Resolvér en graduate (#932). action ∈ promote|sell|release. Returnerer { ok, error? }.
  const resolveGraduate = useCallback(async (riderId, action) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/academy/graduate`, {
        method: "POST", headers, body: JSON.stringify({ riderId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_graduate", { riderId, action });
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Promovér en akademi-rytter til senior-truppen (#932 S7). Returnerer { ok, error? }.
  const promoteRider = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/academy/promote`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_promote", { riderId });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Flyt en U23-senior-rytter ned i akademiet (#932 S7). Returnerer { ok, error?, result? }.
  const demoteRider = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await fetch(`${API}/api/academy/demote`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_demote", { riderId });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  return { enabled, slots, seniorCount, seniorMax, roster, intake, graduations, balance, loading, error, signCandidate, rejectCandidate, resolveGraduate, promoteRider, demoteRider, refresh };
}
