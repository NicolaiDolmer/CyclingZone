import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";

// Rytter-rangliste for den aktive sæson (#2175). Erstatter den gamle client-agg
// der hentede ALLE ~38k race_results til browseren og aggregerede der (én fejlet
// batch = uendelig spinner). Nu: ÉN let query mod det færdig-aggregerede
// rider_rankings_mv + en let riders-query til FERSKE display/hold-felter (navn/
// nation/hold ændrer sig oftere end matview'et refreshes; matview'et er kun de
// tunge race_results-tællinger).
//
// Returnerer eksplicit { loading, error, reload } så en fetch-fejl viser en
// fejl-tilstand frem for en uendelig spinner (rod-symptomet i #2175).

// SUM/COUNT fra matview'et kommer som number ELLER string (PostgREST serialiserer
// bigint/numeric som string) → coerce defensivt, ellers knækker den numeriske sort.
const n = (v) => Number(v) || 0;

// Kategori-sejre der summeres til total_wins (#925: alle kategorier, ikke kun etape+GC).
const WIN_KEYS = ["stage_wins", "gc_wins", "classic_wins", "pts_wins", "mtn_wins", "young_wins"];

export function useRiderRankings() {
  const [riders, setRiders] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: seasonData, error: seasonErr } = await supabase
        .from("seasons").select("*").eq("status", "active").single();
      if (seasonErr) throw seasonErr;
      setSeason(seasonData);
      if (!seasonData) { setRiders([]); return; }

      // Færdig-aggregerede stats (kun ryttere med resultater i sæsonen) + lette
      // display/hold-felter (ferske). is_retired=false spejler den gamle
      // `r.rider.is_retired`-skip: pensionerede droppes ved merge.
      //
      // BEGGE queries SKAL pagineres via fetchAllRows: matview'et har >3k rækker
      // og riders >5k, men PostgREST capper stille ved db-max-rows (1000). Et
      // naivt .select() droppede derfor de fleste rangliste-ryttere — og de
      // top-rangerede (nyere id'er uden for de første 1000) forsvandt helt (#2206).
      // Stabil .order() er påkrævet af fetchAllRows for at undgå side-overlap.
      const [statsData, displayData] = await Promise.all([
        fetchAllRows(() => supabase
          .from("rider_rankings_mv").select("*")
          .eq("season_id", seasonData.id)
          .order("rider_id", { ascending: true })),
        fetchAllRows(() => supabase.from("riders")
          .select("id, firstname, lastname, birthdate, nationality_code, is_u25, is_retired, team:team_id(id, name, is_ai)")
          .eq("is_retired", false)
          .order("id", { ascending: true })),
      ]);

      const displayById = new Map((displayData || []).map((r) => [r.id, r]));
      const rows = [];
      for (const s of statsData || []) {
        const d = displayById.get(s.rider_id);
        if (!d) continue; // pensioneret/slettet → droppes (matcher gammel adfærd)
        const winTotal = WIN_KEYS.reduce((sum, k) => sum + n(s[k]), 0);
        rows.push({
          ...d,
          points: n(s.points),
          prize_earned: n(s.prize_earned),
          stage_wins: n(s.stage_wins),
          gc_wins: n(s.gc_wins),
          classic_wins: n(s.classic_wins),
          pts_wins: n(s.pts_wins),
          mtn_wins: n(s.mtn_wins),
          young_wins: n(s.young_wins),
          yellow_days: n(s.yellow_days),
          green_days: n(s.green_days),
          polka_days: n(s.polka_days),
          white_days: n(s.white_days),
          top3: n(s.top3),
          top10: n(s.top10),
          total_wins: winTotal,
        });
      }
      setRiders(rows);
    } catch (e) {
      setError(e);
      setRiders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { riders, season, loading, error, reload: load };
}
