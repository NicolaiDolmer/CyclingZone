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
//
// #4223 (ejer 25/8): hook'en spurgte KUN på `status='active'`. Mellem to
// sæsoner findes ingen sådan række — prod 25/8 havde S2 completed (23/8) og S3
// upcoming (28/8) — så `data` var null, seasonYear blev null, og null-frem-for-
// gæt-kontrakten slog igennem på hele fladen: alle ryttere viste "—" som alder,
// U23/U25-badget forsvandt og pensionsrisiko-advarslen på bud blev tavs. Hullet
// åbner ved HVERT sæsonskifte, ikke kun dette ene. Rækkefølgen (active →
// nærmeste upcoming → seneste completed) ligger i seasonReference.js.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { seasonReferenceYear } from "../lib/riderAge.js";
import { pickReferenceSeasonNumber } from "../lib/seasonReference.js";

export function useActiveSeasonYear() {
  const [seasonYear, setSeasonYear] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("seasons")
      .select("number, status")
      // Sæson 0 er bogførings-sæsonen (#2763) og filtreres allerede her, så
      // pickReferenceSeason aldrig ser den.
      .gt("number", 0)
      .then(({ data }) => {
        if (!cancelled) setSeasonYear(seasonReferenceYear(pickReferenceSeasonNumber(data)));
      })
      .catch(() => {
        if (!cancelled) setSeasonYear(null);
      });
    return () => { cancelled = true; };
  }, []);

  return seasonYear;
}
