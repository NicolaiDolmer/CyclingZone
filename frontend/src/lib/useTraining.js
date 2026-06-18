// useTraining — frontend-state for progression L2 teaser (#1163) + daglig træning (#1305).
//
// Henter holdets træningsstate (slots + per-rytter aktiv plan + eget team-id + daglig
// kørsel + condition + progress) fra backend, og eksponerer setPlan/clearPlan/runToday.
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
  const [slots, setSlots] = useState(null);       // { total, used, remaining } | null
  const [plans, setPlans] = useState({});         // { <rider_id>: { focus, intensity } }
  const [teamId, setTeamId] = useState(null);
  const [enabled, setEnabled] = useState(false);  // daglig træning aktiveret
  const [todayRun, setTodayRun] = useState(null); // { executed_by, bonus_applied, report, tick_date } | null
  const [condition, setCondition] = useState({}); // { <rider_id>: { form, fatigue, injured_until, risk } }
  const [progress, setProgress] = useState({});   // { <rider_id>: { ability } }
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null); // rytter under aktiv save/clear
  const [running, setRunning] = useState(false);  // runToday kører
  const [bulkApplying, setBulkApplying] = useState(false); // bulk-apply kører (#1480)

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
        setEnabled(data.enabled ?? false);
        setTodayRun(data.todayRun ?? null);
        setCondition(data.condition ?? {});
        setProgress(data.progress ?? {});
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

  // Bulk-anvend samme fokus+intensitet på flere ryttere (#1480). Looper
  // sekventielt med ÉT POST pr. rytter (fokus+intensitet i samme body, samme
  // route som setPlan) for at undgå at sprænge marketWriteLimiter (30/min) med
  // dobbelt-kald. Stopper IKKE ved en enkelt rytter-fejl: samler delvist
  // resultat så UI kan vise "X af Y opdateret" + hvilke der fejlede.
  // Returnerer { ok, applied, failed: [{ riderId, error }] }.
  const setPlanBulk = useCallback(async (riderIds, focus, intensity) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, applied: 0, failed: [], error: "auth" };
    const ids = Array.isArray(riderIds) ? riderIds : [];
    const failed = [];
    const updated = {};
    let latestSlots = null;
    setBulkApplying(true);
    try {
      for (const riderId of ids) {
        try {
          const res = await fetch(`${API}/api/training/${riderId}`, {
            method: "POST", headers, body: JSON.stringify({ focus, intensity }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            failed.push({ riderId, error: data.error || "failed" });
            continue;
          }
          if (data.slots) latestSlots = data.slots;
          updated[riderId] = data.plan ?? { focus, intensity };
        } catch {
          failed.push({ riderId, error: "network" });
        }
      }
      if (Object.keys(updated).length > 0) {
        setPlans((prev) => ({ ...prev, ...updated }));
      }
      if (latestSlots) setSlots(latestSlots);
      const applied = Object.keys(updated).length;
      if (applied > 0) logEvent("training_focus_set_bulk", { focus, intensity, applied });
      return { ok: failed.length === 0, applied, failed };
    } finally {
      setBulkApplying(false);
    }
  }, []);

  const planFor = useCallback((riderId) => plans[riderId] ?? null, [plans]);

  // Kør daglig træning (POST /api/training/run-today). Returnerer { ok, tickDate, report }
  // ved succes, null ved 409 (allerede kørt / deaktiveret / ingen sæson), eller { ok: false }.
  const runToday = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setRunning(true);
    try {
      const res = await fetch(`${API}/api/training/run-today`, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        await refresh();
        return null;
      }
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      // Opdatér todayRun lokalt + kald refresh for konsistent state.
      setTodayRun({ executed_by: "manual", bonus_applied: data.bonus_applied, report: data.report, tick_date: data.tickDate });
      logEvent("training_run_today", { tickDate: data.tickDate, bonus_applied: data.bonus_applied });
      await refresh();
      return data;
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setRunning(false);
    }
  }, [refresh]);

  return { slots, plans, teamId, enabled, todayRun, condition, progress, loading, savingId, running, bulkApplying, setPlan, setPlanBulk, clearPlan, planFor, runToday, refresh };
}
