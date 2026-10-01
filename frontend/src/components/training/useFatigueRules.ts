// useFatigueRules — klienten bag traethedsgraensen (#4854 + #5620, beta).
//
// #5932 (ejer-godkendt omstrukturering 1/10): data hentes nu EET sted (siden),
// fordi to flader viser den samme regel: under-fanen "Fatigue limit" paa
// Program-fanen og en linje i Today-fanens overblik. Serveren afgoer om
// funktionen findes for viewereren (stadie-flaget `training_fatigue_rules`);
// `enabled` false = begge flader renderer intet.
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import type { FatigueRulesResponse } from "./FatigueRuleModel.ts";

const BASE = "/api/training/fatigue-rules";

export type FatigueRulesClient = ReturnType<typeof useFatigueRules>;

export function useFatigueRules() {
  const [data, setData] = useState<FatigueRulesResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch(BASE, { headers }, { source: "training-fatigue-rules" });
    if (!res.ok) return;
    setData((res.data ?? {}) as FatigueRulesResponse);
  }, []);

  useEffect(() => { load(); }, [load]);

  // path: "/team" eller "/riders/:id". true = gemt (og genindlaest).
  const save = useCallback(async (path: string, body: unknown): Promise<boolean> => {
    const headers = await authHeaders();
    if (!headers) return false;
    setBusy(true);
    try {
      const res = await apiFetch(`${BASE}${path}`, { method: "PUT", headers, body: JSON.stringify(body) }, { source: "training-fatigue-rules" });
      if (!res.ok) return false;
      await load();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);

  return { data, enabled: data?.enabled === true, busy, save, reload: load };
}
