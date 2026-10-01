import { fetchAllRows } from "./supabasePagination.js";

const priority = { daily_training: 3, race_development: 3, season_transition: 2, baseline: 1 };
export function mergeDevelopmentSnapshots(calendarRows, raceDayRows) {
  const byDate = new Map();
  for (const row of [...calendarRows, ...raceDayRows]) {
    if (!row?.snapshot_date || !row.abilities) continue;
    const previous = byDate.get(row.snapshot_date);
    const difference = !previous ? 1
      : (row.season_number ?? -1) - (previous.season_number ?? -1)
        || (priority[row.source] ?? 0) - (priority[previous.source] ?? 0)
        || (row.game_day ?? -1) - (previous.game_day ?? -1);
    if (difference > 0) byDate.set(row.snapshot_date, row);
  }
  return [...byDate.values()].sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date)).slice(-200);
}

export async function loadDevelopmentReceiptHistory(supabase, riderId, { dailyReceiptEnabled = false } = {}) {
  let calendarQuery = supabase.from("rider_derived_ability_history")
    .select("snapshot_date, season_number, source, abilities")
    .eq("rider_id", riderId).order("snapshot_date", { ascending: false });
  if (dailyReceiptEnabled === true) calendarQuery = calendarQuery.order("source", { ascending: true });
  const { data, error } = await calendarQuery.limit(200);
  if (error) throw error;
  const calendarRows = data ?? [];
  if (dailyReceiptEnabled !== true) return [...calendarRows].reverse();
  const oldest = calendarRows.at(-1)?.snapshot_date;
  // schema-columns-ok: introduced in database/2026-09-14-4846-training-tick-game-day.sql.
  const raceDayRows = await fetchAllRows(() => {
    let query = supabase.from("rider_ability_race_day_history")
      .select("id, snapshot_date, season_number, source, game_day, abilities")
      .eq("rider_id", riderId).order("snapshot_date", { ascending: false })
      .order("id", { ascending: true });
    if (oldest) query = query.gte("snapshot_date", oldest);
    return query;
  });
  return mergeDevelopmentSnapshots(calendarRows, raceDayRows);
}
