import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { computeIsPro } from "./proEntitlement.js";

// Læser EGEN subscription (RLS select-own). Returnerer
// { isPro, isFounder, loading, error, reload }.
//
// #6286: `loading` er afledt af hvilket hold-id det indlæste svar hører til, så
// den er true i SAMME render som et nyt hold-id ankommer (før var den false indtil
// effekten havde kørt, og en betalende spiller så "See Pro"-reklamen et øjeblik).
// Fejl (netværk/RLS) eksponeres som `error` i stedet for stille at blive "ikke Pro".
// Uden hold-id er der intet at slå op: loading=false, isPro=false.
export function useSubscription(teamId) {
  const [result, setResult] = useState({ teamId: null, sub: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setResult({ teamId: null, sub: null, error: null });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!teamId) return undefined;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("subscriptions")
          .select("status, current_period_end, is_founder, last_event_at")
          .eq("team_id", teamId)
          .maybeSingle();
        if (!alive) return;
        setResult({ teamId, sub: error ? null : data ?? null, error: error ?? null });
      } catch (err) {
        if (alive) setResult({ teamId, sub: null, error: err });
      }
    })();
    return () => { alive = false; };
  }, [teamId, attempt]);

  const current = teamId && result.teamId === teamId ? result : null;
  const sub = current?.sub ?? null;
  return {
    isPro: computeIsPro(sub),
    isFounder: Boolean(sub?.is_founder),
    loading: Boolean(teamId) && !current,
    error: current?.error ?? null,
    reload,
  };
}
