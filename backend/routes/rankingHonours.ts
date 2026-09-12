import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../lib/supabasePagination.js";

type Stat = { rider_id: string; points: number | string | null } & Partial<Record<
  "stage_wins" | "gc_wins" | "classic_wins" | "pts_wins" | "mtn_wins" | "young_wins", number | string | null>>;
type Display = {
  id: string; firstname: string | null; lastname: string | null;
  nationality_code: string | null; team_id: string | null;
  team: { name: string; is_ai: boolean | null } | null;
};

// Display rows arrive in database lastname/id order, preserving SQL collation
// and tie-breaks. Filter visibility BEFORE taking either top five.
export function buildHonours(stats: Stat[], visible: Display[]) {
  const byId = new Map(stats.map(row => [row.rider_id, row]));
  const rows = visible.flatMap(display => {
    const stat = byId.get(display.id);
    if (!stat) return [];
    const wins = Number(stat.stage_wins || 0) + Number(stat.gc_wins || 0) + Number(stat.classic_wins || 0)
      + Number(stat.pts_wins || 0) + Number(stat.mtn_wins || 0) + Number(stat.young_wins || 0);
    return [{ rider_id: display.id, points: Number(stat.points || 0), wins,
      firstname: display.firstname, lastname: display.lastname,
      nationality_code: display.nationality_code, team_id: display.team_id,
      team_name: display.team?.name ?? null, is_ai: display.team?.is_ai ?? false }];
  });
  return {
    points: [...rows].sort((a, b) => b.points - a.points).slice(0, 5),
    wins: [...rows].sort((a, b) => b.wins - a.wins || b.points - a.points).slice(0, 5),
  };
}

export async function readHonours(admin: SupabaseClient, viewer: SupabaseClient, seasonId: string) {
  const [stats, visible] = await Promise.all([
    fetchAllRows(() => admin.from("rider_rankings_mv")
      .select("rider_id,points,stage_wins,gc_wins,classic_wins,pts_wins,mtn_wins,young_wins")
      .eq("season_id", seasonId).order("rider_id")),
    // The viewer's Bearer token applies the SAME riders/teams RLS as the former
    // INVOKER RPC. Never use admin here: intake riders may have historical points.
    fetchAllRows(() => viewer.from("riders")
      .select("id,firstname,lastname,nationality_code,team_id,team:team_id(name,is_ai)")
      .or("is_retired.is.null,is_retired.eq.false").order("lastname").order("id")),
  ]);
  return buildHonours(stats as Stat[], visible as unknown as Display[]);
}
