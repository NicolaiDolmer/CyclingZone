// useTrainingHistory — træningsrapport-historik (#1533).
//
// Henter de seneste ~30 dages daglige trænings-kørsler for det indloggede holds
// EGNE ryttere direkte fra training_day_runs (RLS: SELECT kun for holdets ejer,
// indeks på (team_id, tick_date DESC)). Ingen ny datamodel — al historik er
// allerede persisteret af daily-training-engine (én report JSONB pr. dag).
//
// Spejler useTraining-formen (loading + refresh), men er en ren SELECT-hook uden
// mutationer. Bruges af TrainingPage (historik-liste) + rytterprofilen
// (per-rytter-udsnit via riderHistoryFromRuns).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { getAuthedUser } from "./getAuthedUser.js";

// Vinduet historikken dækker (dage tilbage). Matcher idx_training_day_runs_team_date.
export const HISTORY_DAYS = 30;

// Dansk ISO-dato (YYYY-MM-DD) for "nu minus N dage". tick_date er en DATE-kolonne,
// så vi sammenligner mod en ren dato-streng (ingen klokkeslæt).
function sinceDate(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function useTrainingHistory() {
  const [runs, setRuns] = useState([]);     // [{ tick_date, executed_by, bonus_applied, report }]
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getAuthedUser();
      if (!user) { setRuns([]); return; }
      const { data: myTeam } = await supabase
        .from("teams")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!myTeam) { setRuns([]); return; }
      // RLS begrænser allerede til egne hold; team_id-filteret holder query'et
      // på det aktive hold (samme indeks (team_id, tick_date DESC)).
      const { data, error } = await supabase
        .from("training_day_runs")
        .select("tick_date, executed_by, bonus_applied, report")
        .eq("team_id", myTeam.id)
        .gte("tick_date", sinceDate(HISTORY_DAYS))
        .order("tick_date", { ascending: false });
      if (!error) setRuns(data ?? []);
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { runs, loading, refresh };
}
