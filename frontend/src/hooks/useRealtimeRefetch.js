import { useEffect, useRef } from "react";
import { subscribeAuthedChannel } from "../lib/realtimeChannel";

/**
 * Abonnér på Supabase realtime postgres_changes for et sæt tabeller og kald
 * `refetch` (debounced) når en af dem ændrer sig. Bruges til sider der ellers
 * kun henter data ved mount og derfor bliver stale efter fx en resultat-import
 * (StandingsPage, ResultaterPage, DashboardPage — #783).
 *
 * Debounce er vigtig: en resultat-import laver mange INSERTs på race_results i
 * samme transaktion. Uden debounce ville hver række trigge et fuldt refetch.
 * Vi samler dem i ét kald efter `debounceMs` ro.
 *
 * Forudsætter at tabellerne ligger i `supabase_realtime` publication (se
 * database/2026-05-30-realtime-publication-results.sql) og har en SELECT-policy
 * for den indloggede rolle — ellers leverer realtime ingen events.
 *
 * #4010: abonnementet er session-gatet via subscribeAuthedChannel. Hook'et
 * mountes af useActionSummary i Layout, altså på HVER side — også mens auth
 * stadig initialiserer. Uden gaten connectede det med den opake api-nøgle, som
 * Realtime afviser med MalformedJWT (7.727 gange i døgnet). Se
 * lib/realtimeChannel.js for mekanikken.
 *
 * @param {string} channelName  Unikt kanalnavn (én pr. side).
 * @param {string[]} tables     Tabeller at lytte på. SKAL være en stabil
 *                              reference (modul-konstant), ikke et inline-array,
 *                              så effekten ikke re-subscriber hver render.
 * @param {() => void} refetch   Kaldes når data ændrer sig.
 * @param {{ debounceMs?: number }} [opts]
 */
export function useRealtimeRefetch(channelName, tables, refetch, { debounceMs = 400 } = {}) {
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; });

  useEffect(() => {
    let timer = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { refetchRef.current?.(); }, debounceMs);
    };

    const unsubscribe = subscribeAuthedChannel(channelName, (channel) => {
      for (const table of tables) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          schedule,
        );
      }
      return channel;
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [channelName, debounceMs, tables]);
}
