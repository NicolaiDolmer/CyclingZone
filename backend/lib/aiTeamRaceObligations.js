// Shared read-only race checks for retirement and the mandatory league audit.
// Keep this module independent of team generation and mutation paths.
import { fetchAllRows } from './supabasePagination.js';
import { STALL_WATCHDOG_DEFAULT_THRESHOLDS } from './stallWatchdog.js';

export async function teamInflightRaceIds(supabase, teamId, inflightRaceIds) {
  if (!inflightRaceIds.length) return [];
  const riders = await fetchAllRows(() => supabase.from('riders').select('id')
    .eq('team_id', teamId).order('id'));
  const riderIds = (riders || []).map((r) => r.id);
  const [byTeam, byRider] = await Promise.all([
    fetchAllRows(() => supabase.from('race_entries').select('race_id')
      .in('race_id', inflightRaceIds).eq('team_id', teamId).order('rider_id')),
    riderIds.length ? fetchAllRows(() => supabase.from('race_entries').select('race_id')
      .in('race_id', inflightRaceIds).in('rider_id', riderIds).order('rider_id')) : [],
  ]);
  return [...new Set([...byTeam, ...byRider].map(e => e.race_id))];
}

export async function getStalledInflightRaceIds(
  supabase,
  now = new Date(),
  stageAlarmHours = STALL_WATCHDOG_DEFAULT_THRESHOLDS.stageAlarmHours,
) {
  const races = await fetchAllRows(() => supabase
    .from("races")
    .select("id, stages_completed")
    .neq("status", "completed")
    .gt("stages_completed", 0).order('id'));
  if (!races?.length) return [];

  const cutoff = new Date(now.getTime() - stageAlarmHours * 60 * 60 * 1000).toISOString();
  const raceIds = races.map((r) => r.id);

  const dueRows = await fetchAllRows(() => supabase
    .from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at")
    .in("race_id", raceIds)
    .lte("scheduled_at", cutoff)
    .order("race_id", { ascending: true }));
  if (!dueRows.length) return [];

  const nextStageByRace = new Map(races.map((r) => [r.id, (r.stages_completed || 0) + 1]));
  const stalled = new Set();
  for (const row of dueRows) {
    // Kun DEN forfaldne række der ER løbets næste uafviklede etape betyder "stallet".
    if (row.stage_number === nextStageByRace.get(row.race_id)) stalled.add(row.race_id);
  }
  return [...stalled];
}
