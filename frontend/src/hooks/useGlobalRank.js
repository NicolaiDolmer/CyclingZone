import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";

// Global rank (#2453): ÉN rangliste på tværs af alle managers, over de seneste
// 2 sæsoner (divisions- + sæson-vægtet, se database/2026-07-17-global-rank.sql
// for den fulde beslutning). Læser KUN den færdig-beregnede global_rank_mv +
// global_rank_snapshot (forrige refresh-cyklus' rang, til bevægelses-pilen) —
// ingen live-aggregering (#2196/#2204/#2206-mønsteret).
//
// fetchAllRows: matview'et vokser med antal hold (i dag under PostgREST's
// 1000-rows-cap, men #2206 lærte os at ALDRIG antage det forbliver sådan).

const n = (v) => Number(v) || 0;

export function useGlobalRank() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mvData, snapshotData] = await Promise.all([
        fetchAllRows(() => supabase
          .from("global_rank_mv").select("*")
          .order("global_rank", { ascending: true })),
        fetchAllRows(() => supabase
          .from("global_rank_snapshot").select("team_id, global_rank")
          .order("team_id", { ascending: true })),
      ]);

      const prevRankByTeam = new Map((snapshotData || []).map(s => [s.team_id, n(s.global_rank)]));
      const rows = (mvData || []).map(row => {
        const prevRank = prevRankByTeam.has(row.team_id) ? prevRankByTeam.get(row.team_id) : null;
        const currentRank = n(row.global_rank);
        // movement > 0 = op ad ranglisten (lavere rank-tal), < 0 = ned. null = ingen
        // forrige måling endnu (fx helt ny manager eller lige efter migration).
        const movement = prevRank == null ? null : prevRank - currentRank;
        return {
          team_id: row.team_id,
          name: row.name,
          division: row.division,
          is_ai: row.is_ai,
          weighted_points_sum: n(row.weighted_points_sum),
          seasons_played: n(row.seasons_played),
          global_score: n(row.global_score),
          global_rank: currentRank,
          movement,
        };
      });
      setTeams(rows);
    } catch (e) {
      setError(e);
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { teams, loading, error, reload: load };
}
