// #4983 — hook bag den synlige udtagelses-påmindelse. Én kilde (serveren), to
// forbrugere: nav-markeringen i Layout.jsx og boksen på planlægningssiden.
//
// Bevidst uden Supabase-realtime (modsat useActionSummary): påmindelsen
// afhænger af TIDEN til fristen lige så meget som af race_entries, så en
// abonnement-baseret opdatering ville alligevel ikke fange overgangen gul → rød.
// Et roligt interval dækker begge dele, og endpointet er read-only + cache-let.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/apiFetch.ts"; // #5242: Retry-After-respekt + centraliseret 401-vej
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

// Hooket mountes to steder (Layout + PlanningHubPage) med hver sin useState, og
// der er hverken context eller abonnement imellem dem. Efter ProfilePage's
// til/fra-PATCH ville den gamle nav-markering derfor blive stående indtil næste
// 5-minutters tick. De to linjer nedenfor er det mindste der lukker hullet:
// et modul-lokalt sæt af "hent forfra"-lyttere — ingen ny store, ingen context.
const refreshListeners = new Set<() => void>();

// Sat af notify'en, ryddet af den FØRSTE loader der når frem: så invaliderer
// kun én af de to forbrugere cachen, og den anden deler dens svar (in-flight-
// dedupe i sharedRequestCache) i stedet for at fyre et kald mere.
let pendingRefresh = false;

/**
 * Bed begge forbrugere om friske tal NU. Kaldes efter en mutation der ændrer
 * påmindelsen — i dag kun spillerens til/fra på profilen.
 */
export function refreshSelectionReminder(): void {
  pendingRefresh = true;
  for (const listener of [...refreshListeners]) listener();
}

export function useSelectionReminder(): {
  reminder: SelectionReminder;
  loaded: boolean;
  refetch: () => Promise<void>;
} {
  const [reminder, setReminder] = useState<SelectionReminder>(EMPTY_SELECTION_REMINDER);
  const [loaded, setLoaded] = useState(false);

  // Generationen gør det SIDSTE kald til det gældende. Et interval-tick kan
  // stadig være undervejs når profilens til/fra udløser et nyt: invalidate()
  // fjerner kun det cachede løfte, den annullerer ikke kaldet. Lander det gamle
  // svar sidst, ville det ellers skrive gamle tal — eller, på sin fejl-gren,
  // rydde et NYERE svar der lige er lykkedes.
  const loadGeneration = useRef(0);

  // #5089's delte request-lag: hooket mountes i Layout (hver eneste side) OG i
  // PlanningHubPage, så /planning ville ellers fyre to uafhængige kald — hver
  // med 5 Supabase-runder — ved mount og ved hvert interval-tick. TTL'en (60 s)
  // dækker kun de samtidige kald; den udskyder ikke overgangen gul → rød.
  const load = useCallback(async (force: boolean) => {
    const generation = ++loadGeneration.current;
    const isCurrent = () => generation === loadGeneration.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (isCurrent()) setReminder(EMPTY_SELECTION_REMINDER); return; }
      // Nøglen er bundet til den indloggede manager. Uden user-id'et ville et
      // svar der stadig er undervejs når manager A logger ud lande på den faste
      // nøgle bagefter — `clear()` ved logud fjerner kun det der ligger i
      // cachen, den kan ikke annullere et kald der allerede er sendt — og
      // manager B ville se A's løb i op til TTL'en (60 s).
      const cacheKey = `${SHARED_KEYS.selectionReminder}:${session.user.id}`;
      if (force || pendingRefresh) {
        pendingRefresh = false;
        sharedRequestCache.invalidate(cacheKey);
      }
      const payload = await sharedRequestCache.get(
        cacheKey,
        async () => {
          // catch-ok: loaderens rejection bobler ud gennem sharedRequestCache.get()
          // og fanges af catch'en nedenfor (fail-safe = ingen markering).
          const res = await apiFetch(`${API}/api/me/selection-reminder`, { // catch-ok
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          // #5242: kastet fejl er bevidst bevaret — sharedRequestCache må ikke
          // cache et limited/unauthorized/networkError-svar som et gyldigt
          // resultat i hele TTL'en. Kastet holder cachen tom, så næste
          // navigation prøver igen, præcis som før.
          if (!res.ok) throw new Error("selection_reminder_failed");
          return res.data;
        },
        SHARED_TTL_MS.selectionReminder,
      );
      if (isCurrent()) setReminder(normalizeSelectionReminder(payload));
    } catch {
      // Fail-safe: ingen markering. En påmindelse må aldrig vælte navigationen.
      if (isCurrent()) setReminder(EMPTY_SELECTION_REMINDER);
    } finally {
      if (isCurrent()) setLoaded(true);
    }
  }, []);

  // Eksplicit refetch springer cachen over — kalderen beder om FRISKE tal.
  const refetch = useCallback(() => load(true), [load]);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(false), REFRESH_MS);
    // `false`: invalideringen er allerede bestilt af refreshSelectionReminder()
    // via pendingRefresh, så kun den første af de to forbrugere rammer nettet.
    const listener = () => { void load(false); };
    refreshListeners.add(listener);
    return () => {
      clearInterval(timer);
      refreshListeners.delete(listener);
    };
  }, [load]);

  return { reminder, loaded, refetch };
}
