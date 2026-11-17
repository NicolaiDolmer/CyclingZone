// #8081 (skitse A): "Kom via" pr. talent i "Dine talenter". Læses read-only direkte fra
// Supabase under holdets egen RLS (academy_intake: kun ejerens rækker; auctions: offentlig
// læsning). Hooken bruges kun af AcademyV2, som kun renderes bag kontakten
// academy_page_v2_8081: slukket = ingen hentning.
//
// Begge hentninger er pagineret (fetchAllRows, stabil .order("id")) og afgrænset til holdets
// egne talenter, så PostgREST's rækkeloft aldrig skærer stille. Reglen bor i academyV2Model.ts.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.ts";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { reportLoadFailure } from "../../lib/actionTelemetry.js";
import { buildTalentOrigins, type SignedIntakeRow, type TalentOrigin, type YouthAuctionWinRow } from "./academyV2Model.ts";

/**
 * origins: null = ikke kendt (indlæser eller fejlede); tabellen viser da ingen oprindelse frem for en forkert.
 * failed: hentningen fejlede (så "Dine talenter" viser en fejl i stedet for at indlæse for evigt).
 */
export function useTalentOrigins(teamId: string | null, riderIds: readonly string[]): { origins: Map<string, TalentOrigin> | null; failed: boolean } {
  const [origins, setOrigins] = useState<Map<string, TalentOrigin> | null>(null);
  const [failed, setFailed] = useState(false);
  const idsKey = [...riderIds].sort().join(",");

  useEffect(() => {
    let alive = true;
    const ids = idsKey ? idsKey.split(",") : [];
    setFailed(false);
    if (ids.length === 0) {
      setOrigins(new Map());
      return () => { alive = false; };
    }
    // Talenter uden holdets id kan ikke afgøres: en fejl, aldrig en tom liste der skjuler dem tavst.
    if (!teamId) {
      setOrigins(null);
      setFailed(true);
      return () => { alive = false; };
    }
    // Ved genhentning (fx efter en signering) bliver den forrige oprindelse stående, til svaret er her,
    // så listen ikke blinker til en spinner og mister sin sortering.
    Promise.all([
      fetchAllRows(() => supabase
        .from("academy_intake")
        .select("id, rider_id")
        .eq("team_id", teamId)
        .eq("status", "signed")
        .in("rider_id", ids)
        .order("id")) as Promise<SignedIntakeRow[]>,
      fetchAllRows(() => supabase
        .from("auctions")
        .select("id, rider_id, current_bidder_id, is_guaranteed_sale, is_youth")
        .eq("is_youth", true)
        .eq("status", "completed")
        .eq("current_bidder_id", teamId)
        .in("rider_id", ids)
        .order("id")) as Promise<YouthAuctionWinRow[]>,
    ])
      .then(([signedIntake, youthAuctionWins]) => {
        if (alive) setOrigins(buildTalentOrigins({ signedIntake, youthAuctionWins }));
      })
      .catch((err: unknown) => {
        // Ingen gæt: en fejlet hentning viser ingen oprindelse (null), aldrig "–" som om ingen fandtes.
        reportLoadFailure("academy_v2_talent_origins", { kind: "network", cause: err });
        if (alive) {
          setOrigins(null);
          setFailed(true);
        }
      });
    return () => { alive = false; };
  }, [teamId, idsKey]);

  return { origins, failed };
}
