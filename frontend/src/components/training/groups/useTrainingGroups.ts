// useTrainingGroups — klienten bag traeningsgrupper (#6000, beta).
//
// Serveren afgoer om funktionen findes for viewereren (stadie-flaget
// `training_groups` + felterne, evalueret mod beta-status server-side).
// `enabled` false = Plan-fanen er praecis som i dag.
//
// Efter en skrivning genindlaeses baade grupperne og useTraining (`onChanged`),
// saa rytternes felter har een sandhed paa siden (riderWeekPlans).
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import type { TrainingGroup } from "./trainingGroupsModel.ts";

type GroupsResponse = { enabled?: boolean; groups?: TrainingGroup[] };
export type GroupsResult = { ok: boolean; error?: string; groups?: TrainingGroup[] };
export type GroupFatigueMode = "team" | "own" | "off";

export function useTrainingGroups({ onChanged }: { onChanged?: () => Promise<unknown> | void } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch("/api/training/groups", { headers }, { source: "training-groups" });
    if (!res.ok) return;
    const data = (res.data ?? {}) as GroupsResponse;
    setEnabled(data.enabled === true);
    setGroups(Array.isArray(data.groups) ? data.groups : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (path: string, method: string, body?: unknown): Promise<GroupsResult> => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/training/groups${path}`,
        { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
        { source: "training-groups" },
      );
      const data = (res.data ?? {}) as { error?: string; groups?: TrainingGroup[] };
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      if (Array.isArray(data.groups)) setGroups(data.groups);
      else await load();
      await onChanged?.();
      return { ok: true, groups: data.groups };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, [load, onChanged]);

  const create = useCallback((name: string, riderIds: string[]) => send("", "POST", { name, riderIds }), [send]);
  const update = useCallback(
    (id: string, patch: { name?: string; riderIds?: string[] }) => send(`/${id}`, "PATCH", patch), [send]);
  const remove = useCallback((id: string) => send(`/${id}`, "DELETE"), [send]);
  // slotIndex null = hele ugedagen; 0-4 = een loebsdag.
  const setCell = useCallback(
    (id: string, weekday: string, slotIndex: number | null, session: string) =>
      send(`/${id}/cell`, "PUT", { weekday, slotIndex, session }),
    [send],
  );
  const putProgram = useCallback((id: string, programKey: string) => send(`/${id}/program`, "POST", { programKey }), [send]);
  const follow = useCallback((id: string, riderIds: string[]) => send(`/${id}/follow`, "POST", { riderIds }), [send]);
  const setFatigue = useCallback(
    (id: string, mode: GroupFatigueMode, own?: { threshold: number; fallback: string }) =>
      send(`/${id}/fatigue`, "PUT", mode === "own" ? { mode, ...own } : { mode }),
    [send],
  );

  return { enabled, groups, busy, create, update, remove, setCell, putProgram, follow, setFatigue, reload: load };
}

export type TrainingGroupsClient = ReturnType<typeof useTrainingGroups>;
