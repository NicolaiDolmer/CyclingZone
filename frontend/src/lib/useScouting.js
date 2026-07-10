// useScouting — frontend-state for progression L1 (#1138) + server-estimater (#1162)
// + job-model-tilstand (#2244 Fase 3 Slice C).
//
// Henter holdets scout-state (slots + per-rytter niveau + eget team-id) fra
// backend én gang, og eksponerer:
//   • scout(riderId)        — start en scouting-handling på rytteren. Når
//                             scoutSystemEnabled er 'on' starter dette en job-model
//                             målrettet opgave (POST /api/scouting/assignments) der
//                             modner over dage (ingen øjeblikkelig niveau-ændring);
//                             ellers falder den tilbage til det gamle slots-kald
//                             (POST /api/scouting/:riderId).
//   • pendingFor(riderId)   — aktiv målrettet job-model-opgave på rytteren
//                             ({ readyOn, days }) eller undefined.
//   • requestEstimates(ids) — batched fetch af viewer-maskerede potentiale-
//                             estimater (POST /api/scouting/estimates). Den rå
//                             riders.potentiale findes IKKE i klienten længere —
//                             serveren beregner { lo, hi, level } pr.
//                             (rytter, hold) og kun det sendes.
//   • estimateFor(riderId)  — undefined = ikke hentet (endnu), null = rytter
//                             uden potentiale, ellers estimat-objektet.
//
// Batching: ScoutablePotentiale kalder requestEstimates([id]) pr. række; hooket
// samler ids i en kort timer-vindue og sender ÉT request pr. side-load.

import { useState, useEffect, useCallback, useRef } from "react";
import { getSession } from "./supabase";
import { daysUntil } from "./scoutingCentralDisplay.js";

const API = import.meta.env.VITE_API_URL;
const BATCH_DELAY_MS = 25;
const BATCH_MAX = 400; // server capper på 500 — hold os under med margin

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useScouting() {
  const [slots, setSlots] = useState(null);     // { total, used, remaining } | null
  const [maxLevel, setMaxLevel] = useState(3);
  const [levels, setLevels] = useState({});     // { <rider_id>: level }
  const [teamId, setTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoutingId, setScoutingId] = useState(null); // rytter under aktiv scout
  const [estimates, setEstimates] = useState({});     // { <rider_id>: {lo,hi,exact,level} | null }
  const [scoutSystemEnabled, setScoutSystemEnabled] = useState(false);
  const [pendingTargets, setPendingTargets] = useState({}); // { <rider_id>: { readyOn } }
  const [jobCapacity, setJobCapacity] = useState(1);
  const [jobActiveCount, setJobActiveCount] = useState(0);
  const [jobConfig, setJobConfig] = useState(null); // { targetDaysPerLevel, targetCostPerLevel, missionDays, missionCost } | null (før første fetch)

  const requestedRef = useRef(new Set()); // ids vi allerede har bedt om (dedup)
  const pendingRef = useRef(new Set());   // ids der venter på næste batch
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; clearTimeout(timerRef.current); }, []);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const res = await fetch(`${API}/api/scouting/me`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots ?? null);
        setMaxLevel(data.maxLevel ?? 3);
        setLevels(data.levels ?? {});
        setTeamId(data.teamId ?? null);
        setScoutSystemEnabled(Boolean(data.scoutSystemEnabled));
        const active = data.jobModel?.active ?? [];
        const nextPending = {};
        for (const a of active) {
          if (a.kind === "target" && a.rider_id) nextPending[a.rider_id] = { readyOn: a.ready_on };
        }
        setPendingTargets(nextPending);
        setJobActiveCount(active.length);
        setJobCapacity(data.jobModel?.capacity ?? 1);
        setJobConfig(data.jobModel?.jobConfig ?? null);
      }
    } catch {
      /* netværk — behold tidligere state, UI falder tilbage til uscoutet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Tømmer pending-køen i batches. While-loopet (frem for selv-genplanlægning)
  // dækker ids der kommer til MENS et fetch er i gang — ingen self-reference.
  const flushEstimates = useCallback(async () => {
    timerRef.current = null;
    while (mountedRef.current && pendingRef.current.size > 0) {
      const batch = [...pendingRef.current].slice(0, BATCH_MAX);
      batch.forEach((id) => pendingRef.current.delete(id));
      const headers = await authHeaders();
      if (!headers) return;
      try {
        const res = await fetch(`${API}/api/scouting/estimates`, {
          method: "POST",
          headers,
          body: JSON.stringify({ riderIds: batch }),
        });
        if (!res.ok) throw new Error("estimates_failed");
        const data = await res.json();
        if (!mountedRef.current || !data?.estimates) return;
        setEstimates((prev) => ({ ...prev, ...data.estimates }));
        if (data.maxLevel) setMaxLevel(data.maxLevel);
        if (data.teamId) setTeamId((prev) => prev ?? data.teamId);
      } catch {
        // Netværk/serverfejl — tillad nyt forsøg for batchens ids senere.
        batch.forEach((id) => requestedRef.current.delete(id));
        return;
      }
    }
  }, []);

  // Bed om estimater for en liste rytter-ids (dedupes; batched).
  const requestEstimates = useCallback((riderIds) => {
    let added = false;
    for (const id of riderIds ?? []) {
      if (!id || requestedRef.current.has(id)) continue;
      requestedRef.current.add(id);
      pendingRef.current.add(id);
      added = true;
    }
    if (added && !timerRef.current) {
      timerRef.current = setTimeout(flushEstimates, BATCH_DELAY_MS);
    }
  }, [flushEstimates]);

  // undefined = ikke hentet, null = intet potentiale, ellers { lo, hi, exact, level }.
  const estimateFor = useCallback((riderId) => (riderId ? estimates[riderId] : undefined), [estimates]);

  // Start en målrettet job-model-opgave (#2244): koster rejsepenge, modner over
  // dage via den daglige sweep — INGEN øjeblikkelig niveau-ændring. Returnerer
  // { ok, error? } | { ok:true, assignment }.
  const startTargetJob = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setScoutingId(riderId);
    try {
      const res = await fetch(`${API}/api/scouting/assignments`, {
        method: "POST", headers, body: JSON.stringify({ kind: "target", riderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed" };
      if (data.assignment?.readyOn) {
        setPendingTargets((prev) => ({ ...prev, [riderId]: { readyOn: data.assignment.readyOn } }));
        setJobActiveCount((prev) => prev + 1);
      }
      return { ok: true, assignment: data.assignment };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setScoutingId(null);
    }
  }, []);

  // Brug ét scout-slot på en rytter (legacy-model, kun mens scoutSystemEnabled
  // er 'off'). Returnerer { ok, error?, level? }.
  const scoutLegacy = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setScoutingId(riderId);
    try {
      const res = await fetch(`${API}/api/scouting/${riderId}`, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      if (data.slots) setSlots(data.slots);
      if (data.maxLevel) setMaxLevel(data.maxLevel);
      setLevels((prev) => ({ ...prev, [riderId]: data.level ?? (prev[riderId] ?? 0) + 1 }));
      if (data.estimate !== undefined) {
        setEstimates((prev) => ({ ...prev, [riderId]: data.estimate }));
      }
      return { ok: true, level: data.level };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setScoutingId(null);
    }
  }, []);

  // Dispatcher: job-model når 'on', ellers det gamle slots-kald.
  const scout = useCallback((riderId) => (
    scoutSystemEnabled ? startTargetJob(riderId) : scoutLegacy(riderId)
  ), [scoutSystemEnabled, startTargetJob, scoutLegacy]);

  const levelFor = useCallback((riderId) => levels[riderId] ?? 0, [levels]);

  // Aktiv målrettet job-model-opgave på en rytter, eller undefined. `days` er et
  // afledt bekvemmelighedsfelt (hele dage til ready_on) — se scoutingCentralDisplay.js.
  const pendingFor = useCallback((riderId) => {
    const pending = riderId ? pendingTargets[riderId] : undefined;
    if (!pending) return undefined;
    return { ...pending, days: daysUntil(pending.readyOn) };
  }, [pendingTargets]);

  return {
    slots, maxLevel, levels, teamId, loading, scoutingId, scoutSystemEnabled,
    jobCapacity, jobActiveCount, jobConfig,
    scout, refresh, levelFor, pendingFor, requestEstimates, estimateFor, estimates,
  };
}
