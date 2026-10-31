// #5435 — henter visnings-kontakterne ÉN gang pr. sideload (GET /api/display-flags).
//
// #6853: rating-kontakten (rider_best_role_display) er pensioneret; "bedste
// rolle nu" er den eneste visning, så gaten genmonterer ikke længere indholdet.
// Den henter stadig flagene for rytter-omdømmet (#5519 deler hentningen i
// lib/displayFlags.ts, så én sideload kun giver ét kald mod /api/display-flags).
import { useEffect } from "react";
import { loadDisplayFlags } from "../../lib/displayFlags.ts";
import { setRiderReputation } from "../../lib/riderReputation.ts";

export default function RiderRatingModeGate({ children }) {
  useEffect(() => {
    let cancelled = false;
    loadDisplayFlags().then((flags) => {
      // null = fejl/429/401, IKKE et "off"-svar: behold sidst kendte værdi.
      if (cancelled || !flags) return;
      setRiderReputation(flags.rider_reputation_enabled === true);
    });
    return () => { cancelled = true; };
  }, []);

  return children;
}
