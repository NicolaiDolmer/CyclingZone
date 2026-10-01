// useTrainNow - client for /api/training/train-now (#4847).
//
// GET is safe to ask without knowing the flag: `enabled: false` = the page stays
// exactly as today. After a press the page's own data is refreshed through
// `onSettled` (useTraining.refresh), so the receipt and history show the result.
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import {
  TRAIN_NOW_OFF, parseTrainNowStatus,
  type TrainNowPressResult, type TrainNowStatus,
} from "./TrainNowState.ts";

const PATH = "/api/training/train-now";

export function useTrainNow({ onSettled }: { onSettled?: () => Promise<unknown> | void } = {}) {
  const [status, setStatus] = useState<TrainNowStatus>(TRAIN_NOW_OFF);
  const [result, setResult] = useState<TrainNowPressResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch(PATH, { headers }, { source: "training-train-now" });
    if (!res.ok) return;
    setStatus(parseTrainNowStatus(res.data));
  }, []);

  useEffect(() => { load(); }, [load]);

  const press = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setPressing(true);
    setError(null);
    try {
      const res = await apiFetch(PATH, { method: "POST", headers }, { source: "training-train-now" });
      const data = (res.data ?? {}) as { error?: string; settledRiderIds?: string[]; afterRaceRiderIds?: string[] };
      if (!res.ok) {
        const code = data.error || "failed";
        setError(code);
        await load();
        return { ok: false, error: code };
      }
      setResult({
        settledRiderIds: Array.isArray(data.settledRiderIds) ? data.settledRiderIds : [],
        afterRaceRiderIds: Array.isArray(data.afterRaceRiderIds) ? data.afterRaceRiderIds : [],
      });
      await Promise.all([load(), onSettled?.()]);
      return { ok: true };
    } catch {
      setError("network");
      return { ok: false, error: "network" };
    } finally {
      setPressing(false);
    }
  }, [load, onSettled]);

  return { status, result, error, pressing, press, reload: load };
}
