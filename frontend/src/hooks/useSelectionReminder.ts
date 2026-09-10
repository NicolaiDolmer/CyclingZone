// #4983 — hook bag den synlige udtagelses-påmindelse. Én kilde (serveren), to
// forbrugere: nav-markeringen i Layout.jsx og boksen på planlægningssiden.
//
// Bevidst uden Supabase-realtime (modsat useActionSummary): påmindelsen
// afhænger af TIDEN til fristen lige så meget som af race_entries, så en
// abonnement-baseret opdatering ville alligevel ikke fange overgangen gul → rød.
// Et roligt interval dækker begge dele, og endpointet er read-only + cache-let.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  normalizeSelectionReminder,
  EMPTY_SELECTION_REMINDER,
  type SelectionReminder,
} from "../lib/selectionReminder.ts";

const API = import.meta.env.VITE_API_URL;

// 5 minutter: fin nok til at ramme overgangen gul → rød uden at fladen banker
// på serveren. Fristen selv flytter sig ikke.
const REFRESH_MS = 5 * 60 * 1000;

export function useSelectionReminder(): {
  reminder: SelectionReminder;
  loaded: boolean;
  refetch: () => Promise<void>;
} {
  const [reminder, setReminder] = useState<SelectionReminder>(EMPTY_SELECTION_REMINDER);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setReminder(EMPTY_SELECTION_REMINDER); return; }
      const res = await fetch(`${API}/api/me/selection-reminder`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { setReminder(EMPTY_SELECTION_REMINDER); return; }
      setReminder(normalizeSelectionReminder(await res.json()));
    } catch {
      // Fail-safe: ingen markering. En påmindelse må aldrig vælte navigationen.
      setReminder(EMPTY_SELECTION_REMINDER);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refetch();
    const timer = setInterval(refetch, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refetch]);

  return { reminder, loaded, refetch };
}
