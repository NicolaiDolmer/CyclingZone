import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";

// Global Rank (#2453): ÉN rangliste på tværs af alle managers. Point halveres
// ved hvert sæsonskifte (se database/2026-07-17-global-rank.sql +
// backend/lib/globalRankFormula.js for den fulde beslutning). Læser KUN de
// færdig-beregnede global_rank_mv + de to snapshot-tabeller (ugentlig
// bevægelse, sæson-start) — ingen live-aggregering (#2196/#2204/#2206-mønsteret).
//
// fetchAllRows: matview'et vokser med antal hold (i dag under PostgREST's
// 1000-rows-cap, men #2206 lærte os at ALDRIG antage det forbliver sådan).
// Inaktive managere (active_recent=false) FILTRERES fra listen her (point
// bevares i databasen — kun display-visibiliteten fjernes).

const n = (v) => (v == null ? null : Number(v) || 0);

export function useGlobalRank() {
  const [teams, setTeams] = useState([]);
  const [climbers, setClimbers] = useState([]);
  const [bestNewManagers, setBestNewManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mvData, weeklyData, seasonStartData] = await Promise.all([
        fetchAllRows(() => supabase
          .from("global_rank_mv").select("*")
          .order("global_rank", { ascending: true, nullsFirst: false })),
        fetchAllRows(() => supabase
          .from("global_rank_weekly_snapshot").select("team_id, global_rank")),
        fetchAllRows(() => supabase
          .from("global_rank_season_start_snapshot").select("team_id, global_rank")),
      ]);

      const weeklyRankByTeam = new Map((weeklyData || []).map(s => [s.team_id, n(s.global_rank)]));
      const seasonStartRankByTeam = new Map((seasonStartData || []).map(s => [s.team_id, n(s.global_rank)]));

      // Inaktive managere (>= 2 sæsoner uden aktivitet) skjules — point bevares i mv'et,
      // vises bare ikke her (#2453 accept: "managere uden aktivitet vises ikke på listen").
      const active = (mvData || []).filter(row => row.active_recent);

      const rows = active.map(row => {
        const currentRank = n(row.global_rank);
        const prevRank = weeklyRankByTeam.has(row.team_id) ? weeklyRankByTeam.get(row.team_id) : null;
        const movement = (prevRank == null || currentRank == null) ? null : prevRank - currentRank;
        const startRank = seasonStartRankByTeam.has(row.team_id) ? seasonStartRankByTeam.get(row.team_id) : null;
        const placesGained = (startRank == null || currentRank == null) ? null : startRank - currentRank;
        return {
          team_id: row.team_id,
          name: row.name,
          division: row.division,
          is_ai: row.is_ai,
          banked_points: n(row.banked_points) || 0,
          season_points: n(row.season_points) || 0,
          global_points: n(row.global_points) || 0,
          global_rank: currentRank,
          is_rookie: !!row.is_rookie,
          movement,
          places_gained: placesGained,
        };
      });

      setTeams(rows);
      setClimbers(
        rows.filter(r => r.places_gained != null && r.places_gained > 0)
          .sort((a, b) => b.places_gained - a.places_gained)
          .slice(0, 10)
      );
      setBestNewManagers(
        rows.filter(r => r.is_rookie)
          .sort((a, b) => b.global_points - a.global_points)
          .slice(0, 10)
      );
    } catch (e) {
      setError(e);
      setTeams([]);
      setClimbers([]);
      setBestNewManagers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { teams, climbers, bestNewManagers, loading, error, reload: load };
}
