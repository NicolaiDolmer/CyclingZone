// useTrainingPrograms — Program-fanens klient (#4629, beta 26/9).
//
// Serveren afgoer om funktionen findes for viewereren (stadie-flaget
// `training_programs`, evalueret mod beta-status server-side). `enabled`
// false = fladen viser Ugeplan-fanen praecis som i dag.
//
// Cellerne selv kommer fra useTraining's riderWeekPlans (samme kilde som
// ugeplanen); efter en tildeling eller en celle-rettelse kalder vi derfor
// `onChanged` (useTraining.refresh), saa der kun er een sandhed paa siden.
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import type { CatalogProgram } from "../../lib/trainingPrograms.ts";

type ProgramsResponse = {
  enabled?: boolean;
  catalog?: CatalogProgram[];
  assigned?: Record<string, string>;
};

export type ProgramsResult = { ok: boolean; error?: string };

export function useTrainingPrograms({ onChanged }: { onChanged?: () => Promise<unknown> | void } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProgram[]>([]);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch("/api/training/programs", { headers }, { source: "training-programs" });
    if (!res.ok) return;
    const data = (res.data ?? {}) as ProgramsResponse;
    // `=== true`: et aeldre backend-svar uden feltet skal give den GAMLE flade.
    setEnabled(data.enabled === true);
    setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
    setAssigned(data.assigned && typeof data.assigned === "object" ? data.assigned : {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (path: string, method: string, body: unknown): Promise<ProgramsResult> => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const res = await apiFetch(path, { method, headers, body: JSON.stringify(body) }, { source: "training-programs" });
      const data = (res.data ?? {}) as { error?: string };
      if (!res.ok) return { ok: false, error: data.error || "failed" };
      await Promise.all([load(), onChanged?.()]);
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, [load, onChanged]);

  // target: "squad" eller et rytter-id.
  const applyProgram = useCallback(
    (programKey: string, target: string) => send("/api/training/programs/apply", "POST", { programKey, target }),
    [send],
  );

  // slotIndex null = hele ugedagen; 0-4 = een loebsdag.
  const setCell = useCallback(
    (riderId: string, weekday: string, slotIndex: number | null, session: string) =>
      send("/api/training/programs/cell", "PUT", { riderId, weekday, slotIndex, session }),
    [send],
  );

  return { enabled, catalog, assigned, busy, applyProgram, setCell, reload: load };
}
