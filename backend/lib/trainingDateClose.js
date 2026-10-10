import { copenhagenDateString, copenhagenHour } from './copenhagenTime.js';
import { fetchAllRows } from './supabasePagination.js';
import { refreshRankingsAfterTrainingSettlement } from './refreshRankingMatviews.js';
import { loadTrainingDateContext, nextCivilDate, resolveTrainingDateReadiness, trainingDateDeadline, trainingDateBounds } from './trainingDateReadiness.js';

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function loadTrainingDateIndex({ supabase, now }) {
  const today = copenhagenDateString(now);
  const [active, activation, unfinished] = await Promise.all([
    checked(supabase.from('seasons').select('id,number,start_date,end_date').eq('status', 'active').maybeSingle(), 'active season'),
    checked(supabase.from('app_config').select('value').eq('key', 'training_condition_activation_date').maybeSingle(), 'condition activation date'),
    fetchAllRows(() => supabase.from('training_date_work').select('team_id,season_id,tick_date,status').in('status', ['pending', 'partial']).order('season_id').order('tick_date').order('team_id')),
  ]);
  const jobs = new Map();
  const seasons = new Map(active ? [[active.id, active]] : []);
  for (const id of new Set(unfinished.map(row => row.season_id))) {
    if (!seasons.has(id)) seasons.set(id, await checked(supabase.from('seasons').select('id,number,start_date,end_date').eq('id', id).single(), 'unfinished season'));
  }
  for (const row of unfinished) {
    if (row.tick_date < today || copenhagenHour(now) >= 20) jobs.set(`${row.season_id}:${row.tick_date}`, { season: seasons.get(row.season_id), tickDate: row.tick_date, forceRetry: true });
  }
  if (active) {
    const first = activation?.value;
    if (typeof first !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(first)) throw new Error('Missing authoritative condition activation date');
    const start = [first, String(active.start_date).slice(0, 10)].sort().at(-1);
    const end = copenhagenHour(now) >= 20 ? today : new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    for (let date = start; date <= end && date <= String(active.end_date).slice(0, 10); date = nextCivilDate(date)) {
      if (!jobs.has(`${active.id}:${date}`)) jobs.set(`${active.id}:${date}`, { season: active, tickDate: date });
    }
  }
  return { jobs: [...jobs.values()].sort((a, b) => a.tickDate.localeCompare(b.tickDate)), today, activeSeasonId: active?.id ?? null };
}

export async function registerTrainingDateWork({ supabase, teamId, seasonId, tickDate, gameDays, riderIds, now }) {
  return checked(supabase.rpc('register_training_date_work', {
    p_team_id: teamId, p_season_id: seasonId, p_tick_date: tickDate,
    p_game_days: gameDays, p_expected_rider_ids: riderIds,
    p_deadline_at: trainingDateDeadline(tickDate).toISOString(),
    p_registered_at: now.toISOString(),
  }), 'register training date');
}

async function loadTrainingWorkRows({ supabase, season, tickDate }) {
  return fetchAllRows(() => supabase.from('training_date_work').select('team_id,game_days,expected_rider_ids,status,opening_conditions,quarantined_rider_ids').eq('season_id', season.id).eq('tick_date', tickDate).order('team_id'));
}

async function quarantineTrainingRiders({ supabase, teamId, seasonId, tickDate, riderIds, reason, now }) {
  return checked(supabase.rpc('quarantine_training_date_riders', {
    p_team_id: teamId, p_season_id: seasonId, p_tick_date: tickDate,
    p_rider_ids: riderIds, p_reason: reason, p_now: now.toISOString(),
  }), 'quarantine unprovable training inputs');
}

// #6004: division-less teams settle into one legacy row per (team, tick_date,
// game_day IS NULL). One lookup per date keeps a re-swept date from re-reserving
// those rows (unique-index 409 per team per tick).
async function loadLegacyRunTeamIds({ supabase, tickDate }) {
  const rows = await fetchAllRows(() => supabase.from('training_day_runs').select('team_id').eq('tick_date', tickDate).is('game_day', null).order('team_id'));
  return new Set(rows.map(row => row.team_id));
}

const completedDates = new Set();
// #6004: dates whose full pass already ran in this process without a failure
// outside durable work. A forced retry of such a past date only revisits teams
// with pending/partial work instead of re-sweeping every team each tick.
const fullPassDates = new Set();
export function __resetNormalizedTrainingDateCacheForTests() { completedDates.clear(); fullPassDates.clear(); }

async function sendTrainingOpsAlarm({ tickDate, rows, now }) {
  // Lazy import: tests and ordinary dates never initialise a Discord client.
  const [{ getOpsWebhook }, { attemptWebhookDelivery }, { assertDiscordWebhookUrl }, { withOpsMention }] = await Promise.all([
    import('./discordNotifier.js'), import('./discordWebhookDelivery.js'), import('./urlSafety.js'), import('./opsWebhook.js'),
  ]);
  const url = await getOpsWebhook();
  if (!url) throw new Error('Training reconciliation ops webhook is not configured');
  const result = await attemptWebhookDelivery({ webhookUrl: assertDiscordWebhookUrl(url), payload: withOpsMention({
    embeds: [{ title: 'Training settlement needs reconciliation',
      description: `Date: ${tickDate}. Affected teams: ${rows.length}. Available activity was settled; unavailable riders or missing activity evidence remain queued for review.`,
      timestamp: now.toISOString() }],
  }) });
  if (!result.ok) throw new Error(`Training reconciliation ops delivery failed (${result.status ?? 'network'})`);
}

export async function dispatchTrainingDateAlarms({ supabase, now, onAlarm, sendOps = sendTrainingOpsAlarm, logger = console }) {
  const cutoff = now.toISOString();
  const rows = await fetchAllRows(() => supabase.from('training_condition_timeout_outbox').select('id,tick_date,payload,updated_at').is('delivered_at', null).lte('updated_at', cutoff).order('id'));
  const byDate = new Map();
  for (const row of rows) { if (!byDate.has(row.tick_date)) byDate.set(row.tick_date, []); byDate.get(row.tick_date).push(row); }
  let failed = 0;
  for (const [tickDate, dateRows] of byDate) {
    let failure = null;
    try {
      if (!onAlarm) throw new Error('Training reconciliation Sentry callback is required');
      const pending = dateRows.flatMap(row => row.payload?.missing_evidence ?? []);
      await onAlarm(new Error('Training date requires reconciliation'), {
        tickDate, eventKey: `training-date:${tickDate}`,
        pending,
        // The cron wrapper nests extra fields. A string preserves actual reasons
        // through Sentry's normalization depth instead of becoming [Object].
        pendingEvidence: JSON.stringify(pending.slice(0, 20)),
      });
      await sendOps({ tickDate, rows: dateRows, now });
    } catch (error) {
      // best-effort: retain the durable outbox; alarm transport never rolls training back.
      failure = error.message; failed++;
      logger.error?.('[training-date:alarm] delivery retained for retry', failure);
    }
    await checked(supabase.rpc('mark_training_condition_alert_attempt', {
      p_tick_date: tickDate, p_cutoff: cutoff, p_attempted_at: now.toISOString(),
      p_delivered: failure === null, p_error: failure,
    }), 'training alert receipt');
  }
  return { dates: byDate.size, failed };
}

export async function runNormalizedTrainingDateSweep({
  supabase, now, runDay, loadDaySpans, onAlarm, logger = console,
  loadIndex = loadTrainingDateIndex, loadContext = loadTrainingDateContext,
  registerWork = registerTrainingDateWork, dispatchAlarms = dispatchTrainingDateAlarms,
  loadWorkRows = loadTrainingWorkRows, quarantineRiders = quarantineTrainingRiders,
  loadLegacyRuns = loadLegacyRunTeamIds,
  refreshRankings = refreshRankingsAfterTrainingSettlement,
  elapsedClock = () => performance.now(),
}) {
  const startedAt = elapsedClock();
  const index = await loadIndex({ supabase, now });
  const summary = { ran: false, tickDate: index.today, gameDays: [], divisions: 0, planned: 0, swept: 0, alreadyRan: 0, failed: 0, failures: [], pending: 0, quarantined: 0, durationMs: 0 };
  const allDays = new Set(), divisions = new Set();
  let settledToday = false;
  for (const job of index.jobs) {
    const dateKey = `${job.season.id}:${job.tickDate}`;
    if (completedDates.has(dateKey) && !job.forceRetry) continue;
    const failuresBeforeDate = summary.failed, sweptBeforeDate = summary.swept;
    let waitingForDate = false, untrackedFailure = false, legacyRan = null;
    // #6004: a forced retry of a past, already fully swept date is retry-only:
    // just the teams whose durable work is still pending/partial.
    const retryOnly = Boolean(job.forceRetry) && job.tickDate < index.today && fullPassDates.has(dateKey);
    const workRows = await loadWorkRows({ supabase, ...job });
    const context = await loadContext({ supabase, ...job, loadDaySpans, registeredTeamIds: workRows.map(row => row.team_id) });
    const workByTeam = new Map(workRows.map(row => [row.team_id, row]));
    const riderById = new Map((context.riders ?? []).map(rider => [rider.id, rider]));
    for (const team of context.teams) {
      const unsafeSeason = index.activeSeasonId !== undefined && index.activeSeasonId !== job.season.id;
      if (unsafeSeason && !workByTeam.has(team.id)) continue;
      if (retryOnly && !['pending', 'partial'].includes(workByTeam.get(team.id)?.status)) continue;
      if (['complete', 'needs_reconciliation'].includes(workByTeam.get(team.id)?.status)) continue;
      const dateEnd = trainingDateBounds(job.tickDate).end;
      const currentIds = context.riders.filter(rider => rider.team_id === team.id &&
        (!rider.created_at || new Date(rider.created_at) < dateEnd) &&
        (!rider.acquired_at || new Date(rider.acquired_at) < dateEnd)).map(rider => rider.id);
      if (!currentIds.length && !workByTeam.has(team.id)) continue;
      const days = workByTeam.get(team.id)?.game_days ?? context.gameDaysByDivision.get(team.league_division_id);
      // Division-less teams retain their existing calendar-day fallback.
      if (!team.league_division_id && !workByTeam.has(team.id)) {
        try {
          legacyRan ??= await loadLegacyRuns({ supabase, tickDate: job.tickDate });
          if (legacyRan.has(team.id)) continue;
          const result = await runDay({ supabase, teamId: team.id, seasonId: job.season.id, seasonNumber: job.season.number, now, tickDateOverride: job.tickDate, gameDay: null, executedBy: 'assistant' });
          summary.ran = true; summary.planned++; if (result?.alreadyRan) summary.alreadyRan++; else summary.swept++;
        } catch (error) {
          // best-effort per team: failures are returned for cron.js's aggregated Sentry capture.
          summary.failed++; summary.failures.push({ teamId: team.id, tickDate: job.tickDate, message: error.message });
          untrackedFailure = true;
        }
        continue;
      }
      if (!days?.length) continue;
      let tracked = workByTeam.has(team.id);
      try {
        const work = workByTeam.get(team.id) ?? await registerWork({ supabase, teamId: team.id, seasonId: job.season.id, tickDate: job.tickDate, gameDays: days, riderIds: currentIds, now });
        tracked = true;
        const remaining = work.expected_rider_ids.filter(id => !(work.quarantined_rider_ids ?? []).includes(id));
        // #6439 (owner 10/10): training follows the rider. A rider who changed team
        // after this date opened keeps his slot in the frozen roster and settles the
        // remaining race days here, from the date's opening condition, instead of
        // stopping at 4 of 5. Registration never hands him to the new team for the
        // same date (register_training_date_work), so only one team settles him.
        const followsRider = id => currentIds.includes(id) ||
          (riderById.get(id)?.team_id != null && work.opening_conditions?.[id] != null);
        const unavailable = remaining.filter(id => unsafeSeason || team.is_bank || team.is_frozen || team.is_test_account ||
          !followsRider(id) || (work.opening_conditions !== undefined && !work.opening_conditions[id]));
        if (unavailable.length) {
          await quarantineRiders({ supabase, teamId: team.id, seasonId: job.season.id, tickDate: job.tickDate,
            riderIds: unavailable, reason: unsafeSeason ? 'historical_season_requires_review' : 'roster_or_opening_evidence_unavailable', now });
          summary.quarantined += unavailable.length;
        }
        const available = remaining.filter(id => !unavailable.includes(id));
        const readiness = resolveTrainingDateReadiness({ ...context, tickDate: job.tickDate, now, riderIds: available });
        summary.pending += Object.keys(readiness.unresolvedSlotsByRider).length;
        if (!readiness.deadlineReached && Object.keys(readiness.unresolvedSlotsByRider).length) waitingForDate = true;
        if (!readiness.eligibleRiderIds.length) continue;
        if (team.league_division_id) divisions.add(team.league_division_id);
        for (const gameDay of work.game_days) {
          allDays.add(gameDay); summary.planned++;
          const result = await runDay({
            supabase, teamId: team.id, seasonId: job.season.id, seasonNumber: job.season.number,
            now, tickDateOverride: job.tickDate, gameDay, dateGameDays: work.game_days, executedBy: 'assistant',
            eligibleRiderIds: readiness.eligibleRiderIds, unresolvedSlotsByRider: readiness.unresolvedSlotsByRider,
            deadlineAt: readiness.deadlineAt.toISOString(), deadlineReached: readiness.deadlineReached,
          });
          summary.ran = true;
          if (result?.alreadyRan) summary.alreadyRan++; else summary.swept++;
        }
      } catch (error) {
        // best-effort per team: retain durable work and continue unaffected teams.
        summary.failed++; summary.failures.push({ teamId: team.id, tickDate: job.tickDate, message: error.message });
        if (!tracked) untrackedFailure = true;
        logger.error?.('[training-date] team retained for retry', team.id, error.message);
      }
    }
    // Capacity only: persisted unfinished work always bypasses this cache.
    if (!waitingForDate && summary.failed === failuresBeforeDate) completedDates.add(dateKey);
    // Failures without durable work are only found again by a full pass.
    if (!untrackedFailure) fullPassDates.add(dateKey);
    if (job.tickDate === index.today && summary.swept > sweptBeforeDate) settledToday = true;
  }
  // #5911: one ranking refresh once today's last team has settled (best-effort).
  if (settledToday) await refreshRankings({ supabase, now, logger });
  summary.gameDays = [...allDays].sort((a, b) => a - b);
  summary.divisions = divisions.size;
  summary.alarms = await dispatchAlarms({ supabase, now, onAlarm, logger });
  summary.durationMs = Math.max(0, elapsedClock() - startedAt);
  return summary;
}
