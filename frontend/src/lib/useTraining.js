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
  const [todayRun, setTodayRun] = useState(null); // { executed_by, bonus_applied, report, tick_date, created_at } | null
  const [condition, setCondition] = useState({}); // { <rider_id>: { form, fatigue, injured_until, risk } }
  const [progress, setProgress] = useState({});   // { <rider_id>: { ability } }
  const [trainability, setTrainability] = useState({}); // { <rider_id>: { <focus>: 'strength'|'limited'|'blocked' } } (#1974)
  const [smartDefaultFocus, setSmartDefaultFocus] = useState({}); // { <rider_id>: <focus> } — type-matchet default (#1894)
  const [weekPlan, setWeekPlanState] = useState(null); // holdets ugerytme { mon:{intensity}, ..., sun:{intensity} } | null (#1895)
  const [riderWeekPlans, setRiderWeekPlansState] = useState({}); // { <rider_id>: {mon:{intensity},...} } — pr-rytter-override (#1895 PR 2)
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
        setTrainability(data.trainability ?? {});
        setSmartDefaultFocus(data.smartDefaultFocus ?? {});
        setWeekPlanState(data.weekPlan ?? null);
        setRiderWeekPlansState(data.riderWeekPlans ?? {});
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
      const skippedHasPlan = (data.skipped?.hasPlan) ?? []; // #1894 smart-mode: har allerede en plan
      const skipped = [
        ...((data.skipped?.notOwned) ?? []),
        ...((data.skipped?.noSlots) ?? []),
      ];
      const failed = skipped.map((riderId) => ({ riderId, error: "skipped" }));
      if (applied > 0) logEvent("training_focus_set_bulk", { focus, intensity, applied });
      return { ok: failed.length === 0, applied, failed, skippedHasPlan };
    } catch {
      return { ok: false, applied: 0, failed: ids.map((riderId) => ({ riderId, error: "network" })), error: "network" };
    } finally {
      setBulkApplying(false);
    }
  }, []);

  const planFor = useCallback((riderId) => plans[riderId] ?? null, [plans]);

  // #1895 PR 1: sæt/opdatér holdets ugentlige træningsrytme (7 ugedags-nøgler,
  // valideret backend-side). Rører ALDRIG fokus. Returnerer { ok, error? }.
  const [savingWeekPlan, setSavingWeekPlan] = useState(false);
  const setWeekPlan = useCallback(async (days) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setSavingWeekPlan(true);
    try {
      const res = await fetch(`${API}/api/training/week-plan`, {
        method: "PUT", headers, body: JSON.stringify({ days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      setWeekPlanState(data.weekPlan ?? days);
      logEvent("training_week_plan_set", {});
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setSavingWeekPlan(false);
    }
  }, []);

  // Fjern holdets ugerytme (tilbage til flad sæson-intensitet hver dag). Returnerer { ok, error? }.
  const clearWeekPlan = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setSavingWeekPlan(true);
    try {
      const res = await fetch(`${API}/api/training/week-plan`, { method: "DELETE", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      setWeekPlanState(null);
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setSavingWeekPlan(false);
    }
  }, []);

  // #1895 PR 2: sæt/opdatér ÉN rytters egen ugerytme-override (vinder over holdets
  // rytme for netop denne rytter). Rører ALDRIG fokus. Returnerer { ok, error? }.
  const [savingRiderWeekPlanId, setSavingRiderWeekPlanId] = useState(null);
  const setRiderWeekPlan = useCallback(async (riderId, days) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setSavingRiderWeekPlanId(riderId);
    try {
      const res = await fetch(`${API}/api/training/week-plan/${riderId}`, {
        method: "PUT", headers, body: JSON.stringify({ days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      setRiderWeekPlansState((prev) => ({ ...prev, [riderId]: data.days ?? days }));
      logEvent("training_rider_week_plan_set", {});
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setSavingRiderWeekPlanId(null);
    }
  }, []);

  // Fjern én rytters egen ugerytme-override (tilbage til holdets rytme). Returnerer { ok, error? }.
  const clearRiderWeekPlan = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setSavingRiderWeekPlanId(riderId);
    try {
      const res = await fetch(`${API}/api/training/week-plan/${riderId}`, { method: "DELETE", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      setRiderWeekPlansState((prev) => { const next = { ...prev }; delete next[riderId]; return next; });
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setSavingRiderWeekPlanId(null);
    }
  }, []);

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
      setTodayRun({ executed_by: "manual", bonus_applied: data.bonus_applied, report: data.report, tick_date: data.tickDate, created_at: new Date().toISOString() });
      logEvent("training_run_today", { tickDate: data.tickDate, bonus_applied: data.bonus_applied });
      await refresh();
      return data;
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setRunning(false);
    }
  }, [refresh]);

  return {
    slots, plans, teamId, enabled, todayRun, condition, progress, trainability, smartDefaultFocus,
    weekPlan, savingWeekPlan, loading, savingId, running, bulkApplying,
    riderWeekPlans, savingRiderWeekPlanId,
    setPlan, setPlanBulk, clearPlan, planFor, runToday, refresh, setWeekPlan, clearWeekPlan,
    setRiderWeekPlan, clearRiderWeekPlan,
  };
}
