// "Dage 70+" paa traeningssidens holdtabel (#6110 S26, retning B): hvor mange
// AFREGNEDE dage i traek rytterens traethed har staaet paa eller over graensen.
//
// Kilden er training_condition_settlements.applied_condition (den tilstand dagens
// afregning skrev). Laeses paa rider_id (primaernoeglen), ALDRIG paa team_id:
// en team_id-scanning ville laese hele tabellen. Kaldes kun naar flaget
// training_decision_card er on (kald-stedet gater), saa flag off = ingen ekstra
// DB-belastning.
//
// Graensen er den samme som overblikkets "Fatigue 70+" (frontend
// trainingOverview.ts TIRED_FATIGUE_FROM). Flytter den, skal begge flytte.
// Raekker uden et gyldigt traethedstal bryder raekken: vi taeller aldrig en dag
// vi ikke kan se.

import { fetchAllRows } from "./supabasePagination.js";
import { copenhagenDateString } from "./copenhagenTime.js";

export const FATIGUE_STREAK_FROM = 70;
// Vinduet vi kigger tilbage i: tallet er "dage i traek inden for de seneste 30 dage".
export const FATIGUE_STREAK_WINDOW_DAYS = 30;

/**
 * Ren funktion. rows: { rider_id, tick_date, applied_condition }.
 * Returnerer { [riderId]: antal afregnede dage i traek (nyeste foerst) med
 * traethed >= from }. Ryttere med 0 dage udelades (frontend viser 0).
 */
export function fatigueStreaksFromRows(rows, from = FATIGUE_STREAK_FROM) {
  const byRider = new Map();
  for (const row of rows ?? []) {
    if (!row?.rider_id) continue;
    if (!byRider.has(row.rider_id)) byRider.set(row.rider_id, []);
    byRider.get(row.rider_id).push(row);
  }
  const out = {};
  for (const [riderId, list] of byRider) {
    list.sort((a, b) => (a.tick_date < b.tick_date ? 1 : a.tick_date > b.tick_date ? -1 : 0));
    let streak = 0;
    for (const row of list) {
      const raw = row.applied_condition?.fatigue;
      const fatigue = raw == null ? NaN : Number(raw);
      if (!Number.isFinite(fatigue) || fatigue < from) break;
      streak += 1;
    }
    if (streak > 0) out[riderId] = streak;
  }
  return out;
}

/**
 * Loader. Fail-safe: ALDRIG throw. Ved fejl (eller uden ryttere/saeson) returneres
 * null, saa kald-stedet udelader feltet og fladen viser en streg i stedet for et
 * opdigtet 0.
 */
export async function loadFatigueStreaks(supabase, { riderIds, seasonId, now = new Date() } = {}) {
  if (!supabase?.from || !seasonId || !riderIds?.length) return null;
  try {
    const since = copenhagenDateString(new Date(now.getTime() - FATIGUE_STREAK_WINDOW_DAYS * 86_400_000));
    // Paginieret: ryttere x dage kan overstige PostgRESTs 1.000-raekkers-cap.
    // Sorteringen (rider_id, tick_date) er unik pr. saeson og dermed stabil.
    const rows = await fetchAllRows(() => supabase
      .from("training_condition_settlements")
      .select("rider_id, tick_date, applied_condition")
      .in("rider_id", riderIds)
      .eq("season_id", seasonId)
      .gte("tick_date", since)
      .order("rider_id", { ascending: true })
      .order("tick_date", { ascending: false }));
    return fatigueStreaksFromRows(rows);
  } catch {
    // best-effort: ren berigelse; null = kolonnen viser en streg, intet opdigtet.
    return null;
  }
}
