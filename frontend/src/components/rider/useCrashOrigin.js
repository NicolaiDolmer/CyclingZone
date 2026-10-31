// #7412: hvor styrtede rytteren? Det seneste SKADENDE styrt i race_incidents (offentlig
// loebsinformation, RLS: alle authenticated, idx_race_incidents_rider_id). Kun naar skaden
// ER et styrt; en fejl giver "Crashed in a race" uden sted, aldrig et opfundet loeb.
//
// Egen fil, ikke i ConditionChips.jsx: den fil importeres af node-testede komponenter
// (DailyTrainingReceipt.tsx), og supabase-klienten kan ikke oprettes uden Vite-miljoeet.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/**
 * @param {string|null|undefined} riderId
 * @param {boolean} enabled kun naar rytteren er skadet OG aarsagen er race_crash
 * @returns {{race: string|null, stage: number|null, stages: number|null}|null}
 */
export function useCrashOrigin(riderId, enabled) {
  const key = enabled && riderId ? riderId : null;
  const [result, setResult] = useState({ key: null, crash: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    supabase
      .from("race_incidents")
      .select("stage_number, created_at, race:race_id(name, stages)")
      .eq("rider_id", key)
      .eq("kind", "crash")
      .gt("injury_days", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = error ? null : data?.[0] ?? null;
        setResult({ key, crash: row ? { race: row.race?.name ?? null, stage: row.stage_number ?? null, stages: row.race?.stages ?? null } : null });
      }, () => { if (!cancelled) setResult({ key, crash: null }); });
    return () => { cancelled = true; };
  }, [key]);
  // Et svar for en anden rytter (eller fra foer skaden blev et styrt) vises aldrig.
  return result.key === key ? result.crash : null;
}
