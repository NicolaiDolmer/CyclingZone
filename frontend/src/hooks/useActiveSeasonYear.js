// #3071: delt hook til at hente det AKTIVE sæson-referenceår — samme
// spørgsmål hver side allerede stiller (`supabase.from("seasons").eq("status",
// "active")`, se fx DashboardPage.jsx/RacesPage.jsx/StandingsPage.jsx), blot
// reduceret til det ene tal rytter-alder-helperne (riderAge.js) har brug for.
//
// Rodårsag-fix (#3071): frontend brugte wall-clock (`new Date().getFullYear()`)
// som alders-reference, mens backend bruger sæsonens år
// (`LAUNCH_REFERENCE_YEAR + (seasonNumber-1)`, riderProgressionEngine.js:46).
// De to var identiske i sæson 1 (2026 = 2026) og divergerede usynligt fra
// sæson 2. Denne hook + `seasonReferenceYear` (riderAge.js) er nu ÉT sted der
// gør formlen — sider henter blot tallet, ligesom de allerede henter
// `seasons.number` til alt andet sæson-visning.
//
// Returnerer `null` indtil sæsonen er hentet ELLER hvis kaldet fejler — en
// manglende alder er bedre end en forkert (samme kontrakt som riderAge.js'
// helpers, der selv returnerer null uden et referenceår).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { seasonReferenceYear } from "../lib/riderAge.js";

export function useActiveSeasonYear() {
  const [seasonYear, setSeasonYear] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("seasons")
      .select("number")
      .eq("status", "active")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSeasonYear(seasonReferenceYear(data?.number ?? null));
      })
      .catch(() => {
        if (!cancelled) setSeasonYear(null);
      });
    return () => { cancelled = true; };
  }, []);

  return seasonYear;
}
