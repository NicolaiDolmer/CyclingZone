// #5944: truppens løbsvalg ("Enter races" / "Train only") på U23-/Junior-siden.
//
// GET /api/youth-race-opt-out?squad=… læser valget og første ulåste løbsdag;
// PUT /api/youth-race-opt-out/:squad gemmer det. Serveren rydder selv truppens
// tilmeldinger til ulåste løb ved et skift til "Train only", så klienten skal
// bare genindlæse kalenderen bagefter (onSaved).
//
// "unavailable" = tabellen er ikke migreret endnu (svarer available=false eller
// 503): kontrollen skjules, siden er som før.
import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import type { YouthSquad } from "../../lib/youthSquadPages.ts";

const API: string | undefined = import.meta.env.VITE_API_URL;

export type YouthRaceOptOutStatus = "loading" | "ready" | "unavailable" | "error";
export type YouthRaceMode = "enter" | "train_only";

interface OptOutPayload {
  available?: boolean;
  trainOnly?: boolean;
  effectiveFromDay?: number | null;
}

export function parseOptOut(data: unknown): { available: boolean; trainOnly: boolean; effectiveFromDay: number | null } {
  const d = (data ?? {}) as OptOutPayload;
  const day = typeof d.effectiveFromDay === "number" && Number.isFinite(d.effectiveFromDay) ? d.effectiveFromDay : null;
  return { available: d.available !== false, trainOnly: d.trainOnly === true, effectiveFromDay: day };
}

export function useYouthRaceOptOut(squad: YouthSquad, onSaved?: () => void) {
  const [status, setStatus] = useState<YouthRaceOptOutStatus>("loading");
  const [trainOnly, setTrainOnly] = useState(false);
  const [effectiveFromDay, setEffectiveFromDay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const isCurrent = () => requestRef.current === request;
    try {
      const headers = await authHeaders({ json: false });
      if (!isCurrent()) return;
      if (!headers || !API) { setStatus("error"); return; }
      const res = await apiFetch(`${API}/api/youth-race-opt-out?squad=${squad}`, { headers }, { source: "youth-race-opt-out" });
      if (!isCurrent()) return;
      if (!res.ok) { setStatus("error"); return; }
      const parsed = parseOptOut(res.data);
      if (!parsed.available) { setStatus("unavailable"); return; }
      setTrainOnly(parsed.trainOnly);
      setEffectiveFromDay(parsed.effectiveFromDay);
      setStatus("ready");
    } catch {
      if (isCurrent()) setStatus("error");
    }
  }, [squad]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const setMode = useCallback(async (mode: YouthRaceMode) => {
    setSaving(true);
    setSaveError(false);
    try {
      const headers = await authHeaders({ json: true });
      if (!headers || !API) { setSaveError(true); return; }
      const res = await apiFetch(`${API}/api/youth-race-opt-out/${squad}`, {
        method: "PUT", headers, body: JSON.stringify({ mode }),
      }, { source: "youth-race-opt-out-save" });
      if (res.status === 503) { setStatus("unavailable"); return; }
      if (!res.ok) { setSaveError(true); return; }
      const parsed = parseOptOut(res.data);
      setTrainOnly(parsed.trainOnly);
      setEffectiveFromDay(parsed.effectiveFromDay);
      onSaved?.();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [squad, onSaved]);

  return { status, trainOnly, effectiveFromDay, saving, saveError, setMode };
}
