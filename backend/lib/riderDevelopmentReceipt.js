import { fetchAllRows } from "./supabasePagination.js";

// #5947: kalenderdags-tabellen (rider_derived_ability_history) har noeglen
// (rider_id, snapshot_date, source) og skrives med ignoreDuplicates. Med traening
// pr. loebsdag koerer en dato flere ticks, saa raekken fryser paa datoens FOERSTE
// gevinst-tick, og senere loebsdages gevinster ses foerst paa naeste gevinst-dato.
// Datoens sande slut-tilstand ligger i rider_ability_race_day_history (en raekke
// pr. loebsdag med gevinst). Laesesiden fletter derfor ALTID de to kilder og tager
// den seneste loebsdag pr. dato.
const priority = { daily_training: 3, race_development: 3, season_transition: 2, baseline: 1 };
export const DEVELOPMENT_HISTORY_LIMIT = 200;

export function mergeDevelopmentSnapshots(calendarRows, raceDayRows) {
  const byDate = new Map();
  for (const row of [...(calendarRows ?? []), ...(raceDayRows ?? [])]) {
    if (!row?.snapshot_date || !row.abilities) continue;
    const previous = byDate.get(row.snapshot_date);
    const difference = !previous ? 1
      : (row.season_number ?? -1) - (previous.season_number ?? -1)
        || (priority[row.source] ?? 0) - (priority[previous.source] ?? 0)
        || (row.game_day ?? -1) - (previous.game_day ?? -1);
    if (difference > 0) byDate.set(row.snapshot_date, row);
  }
  return [...byDate.values()].sort((a,b)=>a.snapshot_date.localeCompare(b.snapshot_date))
    .slice(-DEVELOPMENT_HISTORY_LIMIT);
}

// Loebsdags-snapshots for en rytter, valgfrit fra en dato. Bevidst uden flag-gate:
// det er afledt visningsdata, og uden dem er historikken forkert pr. dato (#5947).
export async function loadRaceDayHistory(supabase, riderId, { since = null } = {}) {
  // schema-columns-ok: introduced in database/2026-09-14-4846-training-tick-game-day.sql.
  return fetchAllRows(() => {
    let query = supabase.from("rider_ability_race_day_history")
      .select("id, snapshot_date, season_number, source, game_day, abilities")
      .eq("rider_id", riderId).order("snapshot_date", { ascending: false })
      .order("id", { ascending: true });
    if (since) query = query.gte("snapshot_date", since);
    return query;
  });
}

// `dailyReceiptEnabled` accepteres stadig af kaldere, men styrer ikke laengere
// kilden: en sand historik pr. dato er ikke en beta-funktion (#5947).
export async function loadDevelopmentReceiptHistory(supabase, riderId) {
  const { data, error } = await supabase.from("rider_derived_ability_history")
    .select("snapshot_date, season_number, source, abilities")
    .eq("rider_id", riderId).order("snapshot_date", { ascending: false })
    .order("source", { ascending: true })
    .limit(DEVELOPMENT_HISTORY_LIMIT);
  if (error) throw error;
  const calendarRows = data ?? [];
  const oldest = calendarRows.at(-1)?.snapshot_date ?? null;
  const raceDayRows = await loadRaceDayHistory(supabase, riderId, { since: oldest });
  return mergeDevelopmentSnapshots(calendarRows, raceDayRows);
}
