// #5843: holdets U23-/juniorløb i den aktive sæson (Calendar- og Results-fanen).
//
// Samme direkte Supabase-læsninger som Race Centre (RaceCentrePage.jsx): løbene
// i holdets ungdomspulje for truppen (races.squad + teams.<trup>_league_division_id),
// deres etape-slots og holdets egne entries. Ingen ny API; udtagelsen sker på
// den eksisterende løbsside, som senior.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { buildYouthRaceItems, type YouthEntryRow, type YouthRaceItem, type YouthRaceRow, type YouthScheduleRow } from "../../lib/youthRaceCalendar.ts";
import type { YouthSquad } from "../../lib/youthSquadPages.ts";

export type YouthRacesStatus = "loading" | "ready" | "no_pool" | "error";

const POOL_COLUMN: Record<YouthSquad, "u23_league_division_id" | "junior_league_division_id"> = {
  u23: "u23_league_division_id",
  junior: "junior_league_division_id",
};

type TeamRow = { id: string; u23_league_division_id: number | null; junior_league_division_id: number | null };

export function useYouthRaces(squad: YouthSquad) {
  const [status, setStatus] = useState<YouthRacesStatus>("loading");
  const [calendar, setCalendar] = useState<YouthRaceItem[]>([]);
  const [results, setResults] = useState<YouthRaceItem[]>([]);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const isCurrent = () => requestRef.current === request;
    setStatus("loading");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!isCurrent()) return;
      if (!user) { setStatus("error"); return; }

      const [teamRes, seasonRes] = await Promise.all([
        supabase.from("teams").select("id, u23_league_division_id, junior_league_division_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("seasons").select("id").eq("status", "active").maybeSingle(),
      ]);
      if (!isCurrent()) return;
      if (teamRes.error || seasonRes.error) { setStatus("error"); return; }
      const team = teamRes.data as TeamRow | null;
      const seasonId = (seasonRes.data as { id?: string } | null)?.id ?? null;
      const poolId = team?.[POOL_COLUMN[squad]] ?? null;
      if (!team || poolId == null || !seasonId) {
        setCalendar([]); setResults([]); setStatus("no_pool");
        return;
      }

      // pagination-safe: én pulje i én sæson for én trup (S4: 80 U23-løb og
      // 40 juniorløb fordelt på alle grupper), langt under 1000 rækker.
      const racesRes = await supabase.from("races")
        .select("id, name, race_type, stages, stages_completed, status")
        .eq("season_id", seasonId)
        // Ungdomspuljen er trup-specifik (#5517), så puljen alene udpeger
        // truppens løb; races.squad er ikke i de genererede typer endnu.
        .eq("league_division_id", poolId);
      if (!isCurrent()) return;
      if (racesRes.error) { setStatus("error"); return; }
      const races = (racesRes.data ?? []) as YouthRaceRow[];
      const raceIds = races.map((r) => r.id);

      let schedule: YouthScheduleRow[] = [];
      let entries: YouthEntryRow[] = [];
      if (raceIds.length) {
        // pagination-safe: puljens løb × etaper (to-cifret) og holdets egne entries
        // i de samme løb (løb × højst en trup), begge langt under 1000.
        const [schedRes, entriesRes] = await Promise.all([
          supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at").in("race_id", raceIds),
          supabase.from("race_entries").select("race_id, is_auto_filled").eq("team_id", team.id).in("race_id", raceIds),
        ]);
        if (!isCurrent()) return;
        if (schedRes.error || entriesRes.error) { setStatus("error"); return; }
        schedule = (schedRes.data ?? []) as YouthScheduleRow[];
        entries = (entriesRes.data ?? []) as YouthEntryRow[];
      }

      const built = buildYouthRaceItems(races, schedule, entries);
      setCalendar(built.calendar);
      setResults(built.results);
      setStatus("ready");
    } catch {
      if (isCurrent()) setStatus("error");
    }
  }, [squad]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return { status, calendar, results, reload: load };
}
