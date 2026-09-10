// #4983 — hook bag den synlige udtagelses-påmindelse. Én kilde (serveren), to
// forbrugere: nav-markeringen i Layout.jsx og boksen på planlægningssiden.
//
// Bevidst uden Supabase-realtime (modsat useActionSummary): påmindelsen
// afhænger af TIDEN til fristen lige så meget som af race_entries, så en
// abonnement-baseret opdatering ville alligevel ikke fange overgangen gul → rød.
// Et roligt interval dækker begge dele, og endpointet er read-only + cache-let.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { sharedRequestCache, SHARED_KEYS, SHARED_TTL_MS } from "../lib/sharedRequestCache.js";
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

  // #5089's delte request-lag: hooket mountes i Layout (hver eneste side) OG i
  // PlanningHubPage, så /planning ville ellers fyre to uafhængige kald — hver
  // med 5 Supabase-runder — ved mount og ved hvert interval-tick. TTL'en (60 s)
  // dækker kun de samtidige kald; den udskyder ikke overgangen gul → rød.
  const load = useCallback(async (force: boolean) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setReminder(EMPTY_SELECTION_REMINDER); return; }
      if (force) sharedRequestCache.invalidate(SHARED_KEYS.selectionReminder);
      const payload = await sharedRequestCache.get(
        SHARED_KEYS.selectionReminder,
        async () => {
          // catch-ok: loaderens rejection bobler ud gennem sharedRequestCache.get()
          // og fanges af catch'en nedenfor (fail-safe = ingen markering).
          const res = await fetch(`${API}/api/me/selection-reminder`, { // catch-ok
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!res.ok) throw new Error("selection_reminder_failed");
          return res.json();
        },
        SHARED_TTL_MS.selectionReminder,
      );
      setReminder(normalizeSelectionReminder(payload));
    } catch {
      // Fail-safe: ingen markering. En påmindelse må aldrig vælte navigationen.
      setReminder(EMPTY_SELECTION_REMINDER);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Eksplicit refetch springer cachen over — kalderen beder om FRISKE tal.
  const refetch = useCallback(() => load(true), [load]);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return { reminder, loaded, refetch };
}
