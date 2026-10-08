import { copenhagenDateString, copenhagenHour, copenhagenHourToUTC } from './copenhagenTime.js';
import { fetchAllRows } from './supabasePagination.js';
import { resolveCalendarRaceDayTarget } from './trainingRaceDayTick.js';
import { isEligibleRider, raceSquadOf, ANY_SQUAD } from './riderEligibility.js';
import { teamPoolIdForSquad } from './raceBinding.js';
import { loadTrainNowLockedRidersByDate } from './trainNowLock.js';

// #6006/#6139: a rider locked by a "Train now" press for the date is decided (I3).
// The assistant cannot add him afterwards, so only a real entry can still hold him
// back; he is free to settle now. Riders without a lock row stay candidates.
export function trainingAutopickCandidates(race, teams, riders, trainNowLockedRiderIds = new Set()) {
  const squad = raceSquadOf(race);
  const possibleTeams = new Set(teams.filter(team => (team.is_ai || team.assistant_autopick_enabled) &&
    teamPoolIdForSquad(team, squad) === race.league_division_id).map(team => team.id));
  return riders.filter(rider => possibleTeams.has(rider.team_id) && rider.pending_team_id == null &&
    !trainNowLockedRiderIds.has(rider.id) &&
    isEligibleRider(rider, { squad })).map(rider => rider.id);
}

export function nextCivilDate(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

export function trainingDateBounds(date) {
  return { start: copenhagenHourToUTC(date, 0), end: copenhagenHourToUTC(nextCivilDate(date), 0) };
}

export function trainingDateDeadline(date) {
  const next = nextCivilDate(date);
  const midnight = copenhagenHourToUTC(next, 0);
  // First occurrence on the autumn overlap; first valid time after the spring gap.
  for (let hours = 0; hours <= 5; hours++) {
    const candidate = new Date(midnight.getTime() + hours * 3600000);
    if (copenhagenDateString(candidate) === next && copenhagenHour(candidate) >= 2) return candidate;
  }
  throw new Error('Cannot resolve Copenhagen settlement deadline');
}

function snapshotIds(run) {
  if (!Array.isArray(run?.entrant_snapshot)) return null;
  const ids = run.entrant_snapshot.map(entry => typeof entry === 'string' ? entry : entry?.rider_id);
  return ids.every(id => typeof id === 'string' && id.length > 0) ? ids : null;
}

export function resolveTrainingDateReadiness({
  tickDate, now, riderIds, stages = [], races = [], runs = [], entries = [],
  results = [], incidents = [], loads = [], candidateRiderIdsByRace = new Map(),
}) {
  const unresolvedSlotsByRider = {};
  const owned = new Set(riderIds);
  for (const stage of stages) {
    const race = races.find(row => row.id === stage.race_id);
    const match = row => row.race_id === stage.race_id && Number(row.stage_number) === Number(stage.stage_number);
    const snapshot = snapshotIds(runs.find(match));
    const selected = entries.filter(row => row.race_id === stage.race_id).map(row => row.rider_id);
    const candidates = snapshot ?? [...new Set([...selected, ...(candidateRiderIdsByRace.get(stage.race_id) ?? [])])];
    const closed = race && Number(race.stages_completed) >= Number(stage.stage_number) && race.finalize_state == null;
    for (const riderId of candidates) {
      if (!owned.has(riderId)) continue;
      const hasLoad = loads.some(row => match(row) && row.rider_id === riderId);
      const hasResult = results.some(row => match(row) && row.rider_id === riderId &&
        (row.result_type === 'stage' || (race?.race_type === 'single' && row.result_type === 'gc')));
      const abandoned = incidents.some(row => match(row) && row.rider_id === riderId && row.outcome === 'abandon');
      if (hasLoad && (closed || hasResult || abandoned)) continue;
      (unresolvedSlotsByRider[riderId] ??= []).push({ raceId: stage.race_id, stageNumber: Number(stage.stage_number), gameDay: stage.game_day });
    }
  }
  const deadlineAt = trainingDateDeadline(tickDate);
  const deadlineReached = now.getTime() >= deadlineAt.getTime();
  return { deadlineAt, deadlineReached, unresolvedSlotsByRider,
    eligibleRiderIds: riderIds.filter(id => deadlineReached || !unresolvedSlotsByRider[id]) };
}

async function must(query, name) {
  const { data, error } = await query;
  if (error) throw new Error(`${name}: ${error.message}`);
  return data ?? [];
}

export async function loadTrainingDateContext({ supabase, season, tickDate, loadDaySpans, registeredTeamIds = [] }) {
  const { start, end } = trainingDateBounds(tickDate);
  const [races, allTeams, riders, stageRows, loads] = await Promise.all([
    fetchAllRows(() => supabase.from('races').select('id,league_division_id,race_type,squad,stages_completed,finalize_state').eq('season_id', season.id).order('id')),
    fetchAllRows(() => supabase.from('teams').select('id,league_division_id,u23_league_division_id,junior_league_division_id,is_ai,assistant_autopick_enabled,is_bank,is_frozen,is_test_account,created_at').order('id')),
    fetchAllRows(() => supabase.from('riders').select('id,team_id,squad,is_academy,is_retired,pending_team_id,created_at,acquired_at').eq('is_retired', false).not('team_id', 'is', null).order('id')),
    // pagination-safe: one calendar date; season is filtered inside PostgREST.
    must(supabase.from('race_stage_schedule').select('race_id,stage_number,game_day,scheduled_at,races!inner(season_id)').eq('races.season_id', season.id).gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString()), 'stage schedule'),
    fetchAllRows(() => supabase.from('training_race_loads').select('rider_id,race_id,stage_number,game_day,load').eq('season_id', season.id).eq('tick_date', tickDate).order('rider_id').order('game_day')),
  ]);
  const registered = new Set(registeredTeamIds);
  const teams = allTeams.filter(team => registered.has(team.id) || (!team.is_bank && !team.is_frozen && !team.is_test_account &&
    (!team.created_at || new Date(team.created_at) < end)));
  const stages = stageRows.map(({ races: _joined, ...row }) => row);
  const raceIds = [...new Set(stages.map(row => row.race_id))];
  const pending = stages.filter(stage => {
    const race = races.find(row => row.id === stage.race_id);
    return !race || Number(race.stages_completed) < stage.stage_number || race.finalize_state != null;
  });
  const [runs, entries, spans] = await Promise.all([
    raceIds.length ? fetchAllRows(() => supabase.from('race_simulation_runs').select('race_id,stage_number,entrant_snapshot').in('race_id', raceIds).order('race_id').order('stage_number')) : [],
    raceIds.length ? fetchAllRows(() => supabase.from('race_entries').select('race_id,rider_id,team_id').in('race_id', raceIds).order('race_id').order('rider_id')) : [],
    loadDaySpans({ supabase, raceRows: races, todaysStages: stages, dayStart: start, dayEnd: end, raceDaysPerSeason: () => resolveCalendarRaceDayTarget({ seasonNumber: season.number }) }),
  ]);
  const results = [], incidents = [];
  for (const stage of pending) {
    const [stageResults, stageIncidents] = await Promise.all([
      fetchAllRows(() => supabase.from('race_results').select('race_id,stage_number,rider_id,result_type').eq('race_id', stage.race_id).eq('stage_number', stage.stage_number).in('result_type', ['stage', 'gc']).order('id')),
      fetchAllRows(() => supabase.from('race_incidents').select('race_id,stage_number,rider_id,outcome').eq('race_id', stage.race_id).eq('stage_number', stage.stage_number).eq('outcome', 'abandon').order('id')),
    ]);
    results.push(...stageResults); incidents.push(...stageIncidents);
  }
  const trainNowLockedRiderIds = raceIds.length
    ? (await loadTrainNowLockedRidersByDate({ supabase, dates: [tickDate] })).get(tickDate) ?? new Set() : new Set();
  const candidateRiderIdsByRace = new Map();
  for (const race of races.filter(row => raceIds.includes(row.id))) {
    candidateRiderIdsByRace.set(race.id, trainingAutopickCandidates(race, teams, riders, trainNowLockedRiderIds));
  }
  const riderById = new Map(riders.map(rider => [rider.id, rider]));
  const validEntries = entries.filter(entry => isEligibleRider(riderById.get(entry.rider_id), { teamId: entry.team_id, squad: ANY_SQUAD }));
  return { tickDate, races, teams, riders, stages, runs, entries: validEntries, results, incidents, loads, candidateRiderIdsByRace,
    gameDaysByDivision: new Map([...spans].map(([id, span]) => [id, span.gameDays])) };
}
