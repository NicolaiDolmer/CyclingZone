// #7412: hvor styrtede rytteren? Det seneste SKADENDE styrt i race_incidents (offentlig
// loebsinformation, RLS: alle authenticated, idx_race_incidents_rider_id). Kun naar skaden
// ER et styrt; en fejl giver "Crashed in a race" uden sted, aldrig et opfundet loeb.
//
// Egen fil, ikke i ConditionChips.jsx: den fil importeres af node-testede komponenter
// (DailyTrainingReceipt.tsx), og supabase-klienten kan ikke oprettes uden Vite-miljoeet.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { CrashOrigin } from "../../lib/injuryExplain.ts";

type Result = { key: string | null; crash: CrashOrigin | null };

/** @param enabled kun naar rytteren er skadet OG aarsagen er race_crash */
export function useCrashOrigin(riderId: string | null | undefined, enabled: boolean): CrashOrigin | null {
  const key = enabled && riderId ? riderId : null;
  const [result, setResult] = useState<Result>({ key: null, crash: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    supabase
      .from("race_incidents")
      .select("stage_number, created_at, race:race_id(name, stages)")
      .eq("rider_id", key)
      // Samme raekker som skadeskriveren (incidentInjuryUpsertRows): ethvert uheld med
      // skadedage undtagen kind=injury (fx et styrt der endte uden for tidsgraensen).
      .neq("kind", "injury")
      .gt("injury_days", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = error ? null : data?.[0] ?? null;
        const race = row?.race as { name?: string | null; stages?: number | null } | null | undefined;
        setResult({ key, crash: row ? { race: race?.name ?? null, stage: row.stage_number ?? null, stages: race?.stages ?? null } : null });
      }, () => { if (!cancelled) setResult({ key, crash: null }); });
    return () => { cancelled = true; };
  }, [key]);
  // Et svar for en anden rytter (eller fra foer skaden blev et styrt) vises aldrig.
  return result.key === key ? result.crash : null;
}
