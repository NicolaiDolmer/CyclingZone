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
//
// #5519: selve hentningen er delt (lib/displayFlags.ts) med U23/Junior-
// kontakten, så én sideload stadig kun giver ét kald mod /api/display-flags.
import { Fragment, useEffect } from "react";
import { loadDisplayFlags } from "../../lib/displayFlags.ts";
import { setBestRoleDisplay } from "../../lib/riderRatingMode.js";
import { useBestRoleDisplay } from "../../lib/useBestRoleDisplay.js";

export default function RiderRatingModeGate({ children }) {
  const bestRole = useBestRoleDisplay();

  useEffect(() => {
    let cancelled = false;
    loadDisplayFlags().then((flags) => {
      // null = fejl/429/401, IKKE et "off"-svar: behold sidst kendte værdi i
      // stedet for at blinke tilbage til den gamle visning.
      if (cancelled || !flags) return;
      setBestRoleDisplay(flags.rider_best_role_display === true);
    });
    return () => { cancelled = true; };
  }, []);

  return <Fragment key={bestRole ? "best-role" : "own-role"}>{children}</Fragment>;
}
