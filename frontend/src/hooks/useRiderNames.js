import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// #4026: batch-opslag af rytternavne for en liste rider-ids — til flader der
// viser tidslinje-events UDEN at have startlisten ved hånden (Race Centre-live-
// kortenes filmlinje). Løbssiden bygger sit map af resultat-embeds; live-kort
// har ingen resultater endnu, så navnene hentes her direkte fra riders.
//
// Modul-cache med session-livstid: dagens live-kort deler i praksis et lille
// rytterunivers (~6 navne pr. kort), og navne ændrer sig ikke midt i et løb —
// gen-render/scrub må aldrig koste nye queries.
const nameCache = new Map();

// Kun ægte UUID'er sendes til Postgres — fixture-/testdata ("rider-2") ville
// ellers 400'e på uuid-parsning i PostgREST.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useRiderNames(riderIds) {
  const ids = useMemo(
    () => [...new Set((riderIds || []).filter((id) => typeof id === "string" && UUID_RE.test(id)))].sort(),
    [riderIds],
  );
  const cacheKey = ids.join(",");

  const [names, setNames] = useState(() => new Map());

  useEffect(() => {
    if (!ids.length) { setNames(new Map()); return undefined; }

    const fromCache = () => new Map(ids.filter((id) => nameCache.has(id)).map((id) => [id, nameCache.get(id)]));

    const missing = ids.filter((id) => !nameCache.has(id));
    if (!missing.length) { setNames(fromCache()); return undefined; }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("riders")
        .select("id, firstname, lastname")
        .in("id", missing);
      // Fejl → ingen cache-skrivning; describeEvent skipper de uopløste linjer
      // (ærlig degradering, aldrig rå UUID'er) og næste mount prøver igen.
      if (!error) {
        for (const row of data || []) {
          nameCache.set(row.id, `${row.firstname ?? ""} ${row.lastname ?? ""}`.trim());
        }
      }
      if (!cancelled) setNames(fromCache());
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids er derived af cacheKey (stabil sorteret nøgle)
  }, [cacheKey]);

  return names;
}
