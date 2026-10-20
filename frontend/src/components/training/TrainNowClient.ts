// useTrainNow - client for /api/training/train-now (#4847).
//
// GET is safe to ask without knowing the flag: `enabled: false` = the page stays
// exactly as today. After a press the page's own data is refreshed through
// `onSettled` (useTraining.refresh), so the receipt and history show the result.
import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import {
  TRAIN_NOW_OFF, parseTrainNowStatus, parseShortRaces,
  type TrainNowPressResult, type TrainNowStatus,
} from "./TrainNowState.ts";

const PATH = "/api/training/train-now";
// #6839: while the evening run holds the date, ask again this often until it is settled.
export const TRAIN_NOW_RUNNING_POLL_MS = 10_000;
export const TRAIN_NOW_RUNNING_MAX_MS = 15 * 60_000;
export const TRAIN_NOW_STATUS_TIMEOUT_MS = 8_000;

export function useTrainNow({ onSettled }: { onSettled?: () => Promise<unknown> | void } = {}) {
  const [status, setStatus] = useState<TrainNowStatus>(TRAIN_NOW_OFF);
  const [result, setResult] = useState<TrainNowPressResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  // #6839 (owner choice A 19/10): the evening run is training the team right now.
  const [running, setRunning] = useState(false);
  // #6839 (Codex P2): did OUR press lock the date before the evening run held it?
  // Then "locked" is not a finish line. Otherwise a lock that appears while we wait
  // is a competing press (another tab) that completed: stop and show it.
  const heldWhileLocked = useRef(false);

  const load = useCallback(async (signal?: AbortSignal): Promise<TrainNowStatus | null> => {
    const headers = await authHeaders();
    if (!headers || signal?.aborted) return null;
    const res = await apiFetch(PATH, { headers, signal }, { source: "training-train-now" });
    if (!res.ok || signal?.aborted) return null;
    const next = parseTrainNowStatus(res.data);
    setStatus(next);
    return next;
  }, []);

  useEffect(() => { load(); }, [load]);

  // #6839: poll until the date is settled, then refresh the page once. The ceiling
  // is a timer of its own, so a status call that never answers cannot keep the
  // buttons locked; one call at a time, each bounded by TRAIN_NOW_STATUS_TIMEOUT_MS.
  useEffect(() => {
    if (!running) return undefined;
    let stopped = false;
    let polling = false;
    let controller: AbortController | null = null;
    const stop = () => {
      if (stopped) return false;
      stopped = true;
      controller?.abort();
      clearInterval(timer);
      clearTimeout(ceiling);
      setRunning(false);
      return true;
    };
    const ceiling = setTimeout(stop, TRAIN_NOW_RUNNING_MAX_MS);
    const timer = setInterval(async () => {
      if (stopped || polling) return;
      polling = true;
      controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), TRAIN_NOW_STATUS_TIMEOUT_MS);
      try {
        // Keep polling=true until the actual request settles, including abort.
        const next = await load(request.signal);
        const done = next?.settled === true || (next?.locked === true && !heldWhileLocked.current);
        if (done && stop()) {
          try { await onSettled?.(); } catch { /* best-effort: the next visit shows it */ }
        }
      } catch {
        // Aborted/unavailable status is retried by the next poll, without a UI error.
      } finally {
        clearTimeout(timeout);
        controller = null;
        polling = false;
      }
    }, TRAIN_NOW_RUNNING_POLL_MS);
    return () => { stopped = true; controller?.abort(); clearInterval(timer); clearTimeout(ceiling); };
  }, [running, load, onSettled]);

  // Synchronous in-flight guard: a second tap while the first POST is pending
  // sends nothing (state updates are not visible until the next render).
  const inFlight = useRef(false);

  // #6740: `confirmedShortRaceIds` is the explicit yes for the races the warning showed.
  // The server re-checks today's races on every first press and answers 409
  // short_races_confirm with the fresh list when a race is not covered by that yes;
  // the page then asks again (no error line: nothing failed).
  const press = useCallback(async ({ confirmedShortRaceIds = [] }: { confirmedShortRaceIds?: string[] } = {}): Promise<{ ok: boolean; error?: string }> => {
    if (inFlight.current) return { ok: false, error: "in_flight" };
    inFlight.current = true;
    setPressing(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) return { ok: false, error: "auth" };
      const res = await apiFetch(PATH, {
        method: "POST", headers, body: JSON.stringify({ confirmedShortRaceIds }),
      }, { source: "training-train-now" });
      const data = (res.data ?? {}) as {
        error?: string; locked?: boolean; lockedAt?: string; settledRiderIds?: string[]; afterRaceRiderIds?: string[]; settledGameDays?: number[];
        shortRaces?: unknown;
      };
      if (!res.ok && data.error === "training_in_progress") {
        // #6839: not an error. The page shows "Running…" and updates by itself.
        heldWhileLocked.current = data.locked === true;
        setRunning(true);
        return { ok: false, error: "training_in_progress" };
      }
      if (!res.ok && data.error === "short_races_confirm") {
        setStatus((prev) => ({ ...prev, shortRaces: parseShortRaces(data.shortRaces) }));
        return { ok: false, error: "short_races_confirm" };
      }
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
        ...(Array.isArray(data.settledGameDays) ? { settledGameDays: data.settledGameDays } : {}),
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

  return { status, result, error, pressing, running, press, reload: load };
}
