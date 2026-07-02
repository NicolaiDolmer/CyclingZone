import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { computeIsPro } from "./proEntitlement.js";

// Læser EGEN subscription (RLS select-own). Returnerer { isPro, isFounder, loading }.
export function useSubscription(teamId) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!teamId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("status, current_period_end, is_founder")
        .eq("team_id", teamId)
        .maybeSingle();
      if (alive) { setSub(data ?? null); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [teamId]);
  return { isPro: computeIsPro(sub), isFounder: Boolean(sub?.is_founder), loading };
}
