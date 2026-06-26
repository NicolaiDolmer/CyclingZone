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

  // Bulk-anvend samme fokus+intensitet på flere ryttere (#1480/#1885). ÉT POST
  // mod /api/training/bulk — backend partitionerer mod ejerskab + slots og
  // upserter alle gyldige i én batch. Tidligere loopede vi ét POST pr. rytter,
  // hvilket sprængte marketWriteLimiter (30/min) på en fuld trup (30+) → de
  // sidste ryttere fik 429 og blev tabt ("det åd den ikke"). Returnerer
  // { ok, applied, failed: [{ riderId, error }] } — uændret kontrakt mod
  // TrainingPage, hvor failed = de oversprungne (ikke-ejet / ingen slots).
  const setPlanBulk = useCallback(async (riderIds, focus, intensity) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, applied: 0, failed: [], error: "auth" };
    const ids = Array.isArray(riderIds) ? riderIds : [];
    if (ids.length === 0) return { ok: true, applied: 0, failed: [] };
    setBulkApplying(true);
    try {
      const res = await fetch(`${API}/api/training/bulk`, {
        method: "POST", headers, body: JSON.stringify({ riderIds: ids, focus, intensity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Hele requestet fejlede (auth/validering/rate/5xx) → alle markeres fejlet,
        // så UI'et beholder dem valgt til et nyt forsøg.
        const error = data.error || "failed";
        return { ok: false, applied: 0, failed: ids.map((riderId) => ({ riderId, error })), error };
      }
      if (data.plans) setPlans(data.plans);
      if (data.slots) setSlots(data.slots);
      const applied = data.applied ?? 0;
      const skipped = [
        ...((data.skipped?.notOwned) ?? []),
        ...((data.skipped?.noSlots) ?? []),
      ];
      const failed = skipped.map((riderId) => ({ riderId, error: "skipped" }));
      if (applied > 0) logEvent("training_focus_set_bulk", { focus, intensity, applied });
      return { ok: failed.length === 0, applied, failed };
    } catch {
      return { ok: false, applied: 0, failed: ids.map((riderId) => ({ riderId, error: "network" })), error: "network" };
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
