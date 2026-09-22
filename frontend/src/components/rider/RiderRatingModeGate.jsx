// #5435 — henter rating-kontakten ÉN gang pr. sideload (GET /api/display-flags)
// og sørger for at ALLE flader skifter samtidig.
//
// Ratingen bliver regnet i useMemo'er, sorteringer og dekorerede rækker (_ovr)
// rundt om i siderne. At lade hver af dem abonnere på kontakten ville kunne
// glemmes ét sted, og så viste tabellen én skala og heroen en anden (#3666's
// "aldrig to skalaer"-krav). I stedet GENMONTERES sidens indhold når kontakten
// skifter værdi: alt regnes forfra med den nye model.
//
// I praksis sker det kun den ene gang kontakten flippes for brugeren: den
// sidst kendte værdi caches i browseren (riderRatingMode.js), så startværdien
// normalt allerede er den rigtige, og serverens svar ændrer intet.
import { Fragment, useEffect } from "react";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { setBestRoleDisplay } from "../../lib/riderRatingMode.js";
import { useBestRoleDisplay } from "../../lib/useBestRoleDisplay.js";

const API = import.meta.env.VITE_API_URL;

export default function RiderRatingModeGate({ children }) {
  const bestRole = useBestRoleDisplay();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!API) return;
      try {
        const headers = await authHeaders();
        if (!headers) return;
        const res = await apiFetch(`${API}/api/display-flags`, { headers }, { source: "display-flags" });
        // En fejl/429/401 er IKKE et "off"-svar: behold sidst kendte værdi i
        // stedet for at blinke tilbage til den gamle visning.
        if (cancelled || !res.ok || res.limited || res.unauthorized) return;
        setBestRoleDisplay(res.data?.rider_best_role_display === true);
      } catch {
        // Fail-safe: sidst kendte værdi (default off) står.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <Fragment key={bestRole ? "best-role" : "own-role"}>{children}</Fragment>;
}
