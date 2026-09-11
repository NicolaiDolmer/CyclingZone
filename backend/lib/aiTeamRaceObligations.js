// Shared read-only race checks for retirement and the mandatory league audit.
// Keep this module independent of team generation and mutation paths.
import { fetchAllRows } from './supabasePagination.js';
import { IN_CHUNK_SIZE } from './dbChunk.js';
import { STALL_WATCHDOG_DEFAULT_THRESHOLDS } from './stallWatchdog.js';

export async function teamInflightRaceIds(supabase, teamId, inflightRaceIds) {
  if (!inflightRaceIds.length) return [];
  const riders = await fetchAllRows(() => supabase.from('riders').select('id')
    .eq('team_id', teamId).order('id'));
  const riderIds = (riders || []).map((r) => r.id);
  const [byTeam, byRider] = await Promise.all([
    fetchAllRows(() => supabase.from('race_entries').select('race_id')
      .in('race_id', inflightRaceIds).eq('team_id', teamId).order('race_id').order('rider_id')),
    riderIds.length ? fetchAllRows(() => supabase.from('race_entries').select('race_id')
      .in('race_id', inflightRaceIds).in('rider_id', riderIds).order('race_id').order('rider_id')) : [],
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
    .order("race_id", { ascending: true }).order("stage_number", { ascending: true }));
  if (!dueRows.length) return [];

  const nextStageByRace = new Map(races.map((r) => [r.id, (r.stages_completed || 0) + 1]));
  const stalled = new Set();
  for (const row of dueRows) {
    // Kun DEN forfaldne række der ER løbets næste uafviklede etape betyder "stallet".
    if (row.stage_number === nextStageByRace.get(row.race_id)) stalled.add(row.race_id);
  }
  return [...stalled];
}

// PostgREST encodes .in() lists in the URL, so id lookups are chunked (dbChunk.js)
// and every chunk is range-paginated (a team's entries can exceed one page).
async function selectByIds(supabase, { table, columns, inColumn, ids, orderBy }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    out.push(...await fetchAllRows(() => {
      let q = supabase.from(table).select(columns).in(inColumn, chunk);
      for (const col of orderBy) q = q.order(col, { ascending: true });
      return q;
    }));
  }
  return out;
}

/**
 * #4959: when does an `inflight_entries`-blocked team become retirable again?
 *
 * The dry-run could only say that a team was waiting, never for how long, so an
 * overfull pool looked identical whether the block clears tonight or never. This
 * answers it read-only: the in-flight races the team is still in, and the last
 * stage those races have scheduled. "In-flight" mirrors ai_team_retirement_reason
 * exactly (not completed AND (a stage has run OR a stage is claimed)) so the two
 * can never disagree about which races hold a team open.
 *
 * The returned time is the FINAL SCHEDULED STAGE, i.e. the earliest moment the
 * block can lift - a stalled or rescheduled stage moves it. Callers must present
 * it as an estimate, never as a promise. An in-flight race with no schedule row
 * is reported separately instead of being silently dropped, because the remaining
 * races would otherwise look like the whole answer.
 *
 * @returns {Promise<Map<string, {raceIds: string[], lastStageAt: string|null, unscheduledRaceIds: string[]}>>}
 */
export async function inflightReleaseByTeam(supabase, teamIds) {
  const result = new Map();
  if (!teamIds?.length) return result;

  const riders = await selectByIds(supabase, {
    table: 'riders', columns: 'id, team_id', inColumn: 'team_id', ids: teamIds, orderBy: ['id'],
  });
  const teamByRider = new Map(riders.map((r) => [r.id, r.team_id]));
  const riderIds = riders.map((r) => r.id);

  // A rider on loan/pending move can hold a team open through his own entry row,
  // so both the team column and the team's riders are scanned - same as the SQL.
  const [byTeam, byRider] = await Promise.all([
    selectByIds(supabase, { table: 'race_entries', columns: 'race_id, team_id, rider_id',
      inColumn: 'team_id', ids: teamIds, orderBy: ['race_id', 'rider_id'] }),
    riderIds.length ? selectByIds(supabase, { table: 'race_entries', columns: 'race_id, team_id, rider_id',
      inColumn: 'rider_id', ids: riderIds, orderBy: ['race_id', 'rider_id'] }) : [],
  ]);
  const teamsByRace = new Map();
  for (const e of [...byTeam, ...byRider]) {
    const teamId = teamIds.includes(e.team_id) ? e.team_id : teamByRider.get(e.rider_id);
    if (!teamId) continue;
    if (!teamsByRace.has(e.race_id)) teamsByRace.set(e.race_id, new Set());
    teamsByRace.get(e.race_id).add(teamId);
  }
  if (!teamsByRace.size) return result;

  const races = await selectByIds(supabase, { table: 'races', columns: 'id, status, stages_completed',
    inColumn: 'id', ids: [...teamsByRace.keys()], orderBy: ['id'] });
  const open = races.filter((r) => r.status !== 'completed');
  const started = open.filter((r) => (r.stages_completed || 0) > 0).map((r) => r.id);
  const unstarted = open.filter((r) => !((r.stages_completed || 0) > 0)).map((r) => r.id);
  const claims = unstarted.length
    ? await selectByIds(supabase, { table: 'race_stage_claims', columns: 'race_id',
      inColumn: 'race_id', ids: unstarted, orderBy: ['race_id'] })
    : [];
  const inflight = [...new Set([...started, ...claims.map((c) => c.race_id)])];
  if (!inflight.length) return result;

  const schedule = await selectByIds(supabase, { table: 'race_stage_schedule',
    columns: 'race_id, scheduled_at', inColumn: 'race_id', ids: inflight, orderBy: ['race_id'] });
  const lastStageByRace = new Map();
  for (const row of schedule) {
    const at = row.scheduled_at ? Date.parse(row.scheduled_at) : NaN;
    if (!Number.isFinite(at)) continue;
    const current = lastStageByRace.get(row.race_id);
    if (current === undefined || at > current) lastStageByRace.set(row.race_id, at);
  }

  for (const raceId of inflight) {
    for (const teamId of teamsByRace.get(raceId) || []) {
      if (!result.has(teamId)) result.set(teamId, { raceIds: [], lastStageAt: null, unscheduledRaceIds: [] });
      const entry = result.get(teamId);
      entry.raceIds.push(raceId);
      const at = lastStageByRace.get(raceId);
      if (at === undefined) { entry.unscheduledRaceIds.push(raceId); continue; }
      const known = entry.lastStageAt === null ? null : Date.parse(entry.lastStageAt);
      if (known === null || at > known) entry.lastStageAt = new Date(at).toISOString();
    }
  }
  for (const entry of result.values()) { entry.raceIds.sort(); entry.unscheduledRaceIds.sort(); }
  return result;
}
