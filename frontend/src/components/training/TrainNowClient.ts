// useTrainNow - client for /api/training/train-now (#4847).
//
// GET is safe to ask without knowing the flag: `enabled: false` = the page stays
// exactly as today. After a press the page's own data is refreshed through
// `onSettled` (useTraining.refresh), so the receipt and history show the result.
import { useCallback, useEffect, useRef, useState } from "react";
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

  // Synchronous in-flight guard: a second tap while the first POST is pending
  // sends nothing (state updates are not visible until the next render).
  const inFlight = useRef(false);

  const press = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (inFlight.current) return { ok: false, error: "in_flight" };
    inFlight.current = true;
    setPressing(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) return { ok: false, error: "auth" };
      const res = await apiFetch(PATH, { method: "POST", headers }, { source: "training-train-now" });
      const data = (res.data ?? {}) as {
        error?: string; lockedAt?: string; settledRiderIds?: string[]; afterRaceRiderIds?: string[];
      };
      if (!res.ok) {
        const code = data.error || "failed";
        setError(code);
        await load();
        return { ok: false, error: code };
      }
      // The press succeeded: show the locked state now, independent of the refresh.
      setStatus((prev) => ({
        ...prev, available: false, locked: true, reason: "locked", lockedAt: data.lockedAt ?? prev.lockedAt,
      }));
      setResult({
        settledRiderIds: Array.isArray(data.settledRiderIds) ? data.settledRiderIds : [],
        afterRaceRiderIds: Array.isArray(data.afterRaceRiderIds) ? data.afterRaceRiderIds : [],
      });
      try {
        await Promise.all([load(), onSettled?.()]);
      } catch {
        // best-effort: the lock is already confirmed by the POST; a failed page
        // refresh must not turn a successful press into an error line.
      }
      return { ok: true };
    } catch {
      setError("network");
      return { ok: false, error: "network" };
    } finally {
      inFlight.current = false;
      setPressing(false);
    }
  }, [load, onSettled]);

  return { status, result, error, pressing, press, reload: load };
}
