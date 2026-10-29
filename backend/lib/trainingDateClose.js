import { trainingDateRpc } from "./trainingDateRpc.js";
import { copenhagenDateString, copenhagenHour } from './copenhagenTime.js';
import { fetchAllRows } from './supabasePagination.js';
import { refreshRankingsAfterTrainingSettlement } from './refreshRankingMatviews.js';
import { loadTrainingDateContext, nextCivilDate, resolveTrainingDateReadiness, trainingDateDeadline, trainingDateBounds } from './trainingDateReadiness.js';
import { loadFinalTrainingDate, TRAINING_DATE_SETTLEMENT_HOUR } from './seasonTransitionReadiness.js';

/**
 * #6536: who gets the division-less calendar-day tick (gameDay null)?
 *
 * Teams without a `league_division_id` (spec §3.2) that are not parked: they have
 * no race-day axis, so one tick on the old calendar-day key keeps them developing. That
 * covers division-less AI teams and the supported fallback where a new human
 * team is created without a division (teamProfileEngine.pickDivisionForNewTeam).
 * A parked team also loses its division (managerParking.js), but parking leaves
 * the team untouched apart from parked_at, so it must not train (#6536). Callers
 * MUST select parked_at; both writers below do, and the per-date context also
 * drops parked teams up front (trainingDateReadiness.isTrainingDateTeam).
 *
 * Both writers use this one rule: buildSweepPlan (trainingDayCloseTrigger.js)
 * and the per-date sweep below.
 *
 * @param {{league_division_id?: string|null, is_ai?: boolean|null, parked_at?: string|null}} team
 * @returns {boolean}
 */
export function isLegacyCalendarTickTeam(team) {
  return !team?.league_division_id && team?.parked_at == null;
}

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

function previousCivilDate(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

// A full timestamp inside the final date (not a planned date-only value).
function instantWithin(value, { start, end }) {
  if (value == null || String(value).length <= 10) return null;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) && at >= start && at < end ? at : null;
}

/**
 * #6924 (owner decision B, 20/10 on #6898): the final training date of a season
 * that has just left `active`. Only the latest completed season, and only while
 * its final date is due and at most one day old: that is the window in which the
 * season-end gate (assessFinalTrainingDateSettlement) lets the season end before
 * the date is settled. Older dates stay historical (quarantined for review).
 *
 * `cutoff` is when the season stopped being the game's season: the season-end
 * claim, else a transition's end_date, else the date's own end. Riders created and
 * teams started or returned after it (new-season intake and teams) belong to the
 * next season, not to this final date.
 */
export async function loadJustCompletedFinalTrainingDate({ supabase, today, dueEnd }) {
  const [season] = await checked(supabase.from('seasons').select('id,number,start_date,end_date,status')
    .eq('status', 'completed').order('number', { ascending: false }).range(0, 0), 'completed season') ?? [];
  if (season?.status !== 'completed') return null;
  const tickDate = await loadFinalTrainingDate({ supabase, seasonId: season.id });
  if (!tickDate || tickDate > dueEnd || tickDate < previousCivilDate(today)) return null;
  const claim = await checked(supabase.from('season_end_claims').select('claimed_at').eq('season_id', season.id).maybeSingle(), 'season end claim');
  const bounds = trainingDateBounds(tickDate);
  const marks = [claim?.claimed_at, season.end_date].map(value => instantWithin(value, bounds)).filter(Boolean);
  const cutoff = marks.length ? new Date(Math.min(...marks.map(Number))) : bounds.end;
  return { season, tickDate, cutoff };
}

// #6924: the team's division during the season. Season-end promotion/relegation
// and parking rewrite teams.league_division_id; the final date's race days belong
// to the pool the team actually raced in.
export async function loadSeasonStandingDivisions({ supabase, seasonId }) {
  const rows = await fetchAllRows(() => supabase.from('season_standings').select('team_id,league_division_id').eq('season_id', seasonId).order('team_id'));
  return new Map(rows.filter(row => row.league_division_id != null).map(row => [row.team_id, row.league_division_id]));
}

// #6924: ordinary teams parked by the season-end parking sweep (after the cutoff).
// On the final date they were still active, so the date counts them.
async function loadTeamsParkedAfter({ supabase, cutoff }) {
  const rows = await fetchAllRows(() => supabase.from('teams').select('id,is_bank,is_frozen,is_test_account')
    .gte('parked_at', cutoff.toISOString()).order('id'));
  return rows.filter(row => !row.is_bank && !row.is_frozen && !row.is_test_account).map(row => row.id);
}

// #6924: a team that only started (or came back) after the cutoff was not in this season.
function existedAt(row, cutoff, keys) {
  return keys.every(key => !row?.[key] || new Date(row[key]) < cutoff);
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
  const due = copenhagenHour(now) >= TRAINING_DATE_SETTLEMENT_HOUR;
  for (const row of unfinished) {
    if (row.tick_date < today || due) jobs.set(`${row.season_id}:${row.tick_date}`, { season: seasons.get(row.season_id), tickDate: row.tick_date, forceRetry: true });
  }
  const end = due ? today : previousCivilDate(today);
  if (active) {
    const first = activation?.value;
    if (typeof first !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(first)) throw new Error('Missing authoritative condition activation date');
    // #7282: no season break. The dates after the previous season's last date are this
    // season's bridge dates (trainingDateReadiness.bridgeGameDays), so they start the range.
    const previous = Number(active.number) > 1
      ? await checked(supabase.from('seasons').select('end_date').eq('number', Number(active.number) - 1).maybeSingle(), 'previous season end')
      : null;
    active.previous_end_date = previous?.end_date ?? null;
    const seasonStart = String(active.start_date).slice(0, 10);
    const bridgeStart = active.previous_end_date ? nextCivilDate(String(active.previous_end_date).slice(0, 10)) : seasonStart;
    const start = [first, [bridgeStart, seasonStart].sort()[0]].sort().at(-1);
    for (let date = start; date <= end && date <= String(active.end_date).slice(0, 10); date = nextCivilDate(date)) {
      if (!jobs.has(`${active.id}:${date}`)) jobs.set(`${active.id}:${date}`, { season: active, tickDate: date });
    }
  }
  // #6924: the last date of a season that has just left `active` is still settled
  // as an ordinary date, not quarantined as historical. Exactly once is the durable
  // work's job (complete/needs_reconciliation are skipped, receipts per race day).
  const final = await loadJustCompletedFinalTrainingDate({ supabase, today, dueEnd: end });
  if (final && final.season.id !== active?.id) {
    const key = `${final.season.id}:${final.tickDate}`;
    const job = jobs.get(key) ?? { season: final.season, tickDate: final.tickDate };
    jobs.set(key, { ...job, finalSeasonDate: { cutoff: final.cutoff } });
  }
  return { jobs: [...jobs.values()].sort((a, b) => a.tickDate.localeCompare(b.tickDate)), today, activeSeasonId: active?.id ?? null };
}

export async function registerTrainingDateWork({ supabase, teamId, seasonId, tickDate, gameDays, riderIds, now, nonBlocking = false, lateBridge = false }) {
  const args = {
    p_team_id: teamId, p_season_id: seasonId, p_tick_date: tickDate,
    p_game_days: gameDays, p_expected_rider_ids: riderIds,
    p_deadline_at: trainingDateDeadline(tickDate).toISOString(),
    p_registered_at: now.toISOString(),
  };
  // #7282: a bridge date caught up after its deadline needs the bridge RPC, which keeps
  // the opening snapshot when nothing has trained the riders since. Before auto-migrate
  // has created it, return null: the caller waits instead of freezing the date empty.
  if (lateBridge) {
    const { data, error } = await supabase.rpc('register_training_bridge_date_work', args);
    if (error?.code === 'PGRST202' || error?.code === '42883') return null;
    if (error) throw new Error(`register training bridge date: ${error.message}`);
    return data;
  }
  return checked(trainingDateRpc(supabase, 'register_training_date_work', args, nonBlocking), 'register training date');
}

async function loadTrainingWorkRows({ supabase, season, tickDate }) {
  return fetchAllRows(() => supabase.from('training_date_work').select('team_id,game_days,expected_rider_ids,status,opening_conditions,quarantined_rider_ids').eq('season_id', season.id).eq('tick_date', tickDate).order('team_id'));
}

// #6504: a rider who has provably left the team (team_id is null now) is taken out
// of the date without alarm. The RPC re-checks team_id server-side and returns only
// the riders it accepted; the rest are quarantined by the caller as before.
// In the deploy window before auto-migrate has created the function (PGRST202),
// nobody is departed: the caller quarantines them exactly as before #6504.
export async function departTrainingDateRiders({ supabase, teamId, seasonId, tickDate, riderIds, now }) {
  const { data, error } = await supabase.rpc('depart_training_date_riders', {
    p_team_id: teamId, p_season_id: seasonId, p_tick_date: tickDate,
    p_rider_ids: riderIds, p_now: now.toISOString(),
  });
  if (error?.code === 'PGRST202' || error?.code === '42883') return [];
  if (error) throw new Error(`depart released riders from training date: ${error.message}`);
  return data?.departed_rider_ids ?? [];
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

// #5911: run `fn` over `items` with at most `limit` in flight. limit 1 is the old
// sequential loop, in the same order. Teams are independent (disjoint frozen
// rosters, per-team rows), so each team's own call sequence is identical at any
// limit. A throw outside a team's own try stops new teams, lets the started ones
// finish, then rethrows, the same as the sequential loop aborting the sweep.
export async function forEachTeamBounded(items, limit, fn) {
  const width = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 1, items.length));
  let next = 0, failure = null;
  const worker = async () => {
    while (failure === null && next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch (error) {
        // best-effort: not swallowed, rethrown below once the started teams finish.
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  if (failure) throw failure.error;
}

export async function runNormalizedTrainingDateSweep({
  supabase, now, runDay, loadDaySpans, onAlarm, logger = console,
  loadIndex = loadTrainingDateIndex, loadContext = loadTrainingDateContext,
  registerWork = registerTrainingDateWork, dispatchAlarms = dispatchTrainingDateAlarms,
  loadWorkRows = loadTrainingWorkRows, quarantineRiders = quarantineTrainingRiders, departRiders = departTrainingDateRiders,
  loadLegacyRuns = loadLegacyRunTeamIds,
  loadSeasonDivisions = loadSeasonStandingDivisions, loadParkedTeams = loadTeamsParkedAfter,
  refreshRankings = refreshRankingsAfterTrainingSettlement,
  elapsedClock = () => performance.now(),
  // #5911: how many teams settle at once. 1 = the old sequential sweep.
  teamConcurrency = 1,
}) {
  const startedAt = elapsedClock();
  const index = await loadIndex({ supabase, now });
  const summary = { ran: false, tickDate: index.today, gameDays: [], divisions: 0, planned: 0, swept: 0, alreadyRan: 0, failed: 0, failures: [], pending: 0, quarantined: 0, departed: 0, durationMs: 0 };
  const allDays = new Set(), divisions = new Set();
  // #7282: a team whose late bridge date waits for the bridge RPC registers no later
  // date in this pass; a later row would stop the bridge RPC from keeping its snapshot.
  const deferredBridgeTeams = new Set();
  let settledToday = false;
  for (const job of index.jobs) {
    const dateKey = `${job.season.id}:${job.tickDate}`;
    if (completedDates.has(dateKey) && !job.forceRetry) continue;
    const failuresBeforeDate = summary.failed, sweptBeforeDate = summary.swept;
    let waitingForDate = false, untrackedFailure = false, legacyRanPromise = null;
    // One lookup per date even when teams run in parallel; a failed lookup is
    // retried by the next division-less team, as in the sequential loop.
    const loadLegacyRan = () => (legacyRanPromise ??= Promise.resolve()
      .then(() => loadLegacyRuns({ supabase, tickDate: job.tickDate }))
      .catch((error) => { legacyRanPromise = null; throw error; }));
    // #6004: a forced retry of a past, already fully swept date is retry-only:
    // just the teams whose durable work is still pending/partial.
    const retryOnly = Boolean(job.forceRetry) && job.tickDate < index.today && fullPassDates.has(dateKey);
    const workRows = await loadWorkRows({ supabase, ...job });
    // #6924: a final date settled after season-end sees the season as it was at
    // the cutoff: the pools the teams raced in, and teams the season-end parking
    // sweep parked afterwards (their work is registered like any other team's).
    const final = job.finalSeasonDate ?? null;
    const [seasonDivisions, parkedAfterCutoff] = final
      ? await Promise.all([loadSeasonDivisions({ supabase, seasonId: job.season.id }), loadParkedTeams({ supabase, cutoff: final.cutoff })])
      : [new Map(), []];
    const registeredTeamIds = [...new Set([...workRows.map(row => row.team_id), ...parkedAfterCutoff])];
    const context = await loadContext({ supabase, ...job, loadDaySpans, registeredTeamIds });
    const workByTeam = new Map(workRows.map(row => [row.team_id, row]));
    const riderById = new Map((context.riders ?? []).map(rider => [rider.id, rider]));
    await forEachTeamBounded(context.teams, teamConcurrency, async (team) => {
      const unsafeSeason = !final && index.activeSeasonId !== undefined && index.activeSeasonId !== job.season.id;
      if (unsafeSeason && !workByTeam.has(team.id)) return;
      if (retryOnly && !['pending', 'partial'].includes(workByTeam.get(team.id)?.status)) return;
      if (['complete', 'needs_reconciliation'].includes(workByTeam.get(team.id)?.status)) return;
      if (final && !workByTeam.has(team.id) && !existedAt(team, final.cutoff, ['created_at', 'comeback_at'])) return;
      const dateEnd = trainingDateBounds(job.tickDate).end;
      // #6924: riders created after the cutoff (the new season's intake) did not
      // exist in this season. A trade on the date still follows the usual rule.
      const createdBy = final?.cutoff ?? dateEnd;
      const currentIds = context.riders.filter(rider => rider.team_id === team.id &&
        (!rider.created_at || new Date(rider.created_at) < createdBy) &&
        (!rider.acquired_at || new Date(rider.acquired_at) < dateEnd)).map(rider => rider.id);
      if (!currentIds.length && !workByTeam.has(team.id)) return;
      const divisionId = final ? (seasonDivisions.get(team.id) ?? team.league_division_id) : team.league_division_id;
      const days = workByTeam.get(team.id)?.game_days ?? context.gameDaysByDivision.get(divisionId);
      // Division-less AI teams retain their existing calendar-day fallback. A
      // division-less human team is parked (#6536) and gets no tick at all.
      if (!divisionId && !workByTeam.has(team.id)) {
        if (!isLegacyCalendarTickTeam(team)) return;
        try {
          const legacyRan = await loadLegacyRan();
          if (legacyRan.has(team.id)) return;
          const result = await runDay({ supabase, teamId: team.id, seasonId: job.season.id, seasonNumber: job.season.number, now, tickDateOverride: job.tickDate, gameDay: null, executedBy: 'assistant' });
          summary.ran = true; summary.planned++; if (result?.alreadyRan) summary.alreadyRan++; else summary.swept++;
        } catch (error) {
          // best-effort per team: failures are returned for cron.js's aggregated Sentry capture.
          summary.failed++; summary.failures.push({ teamId: team.id, tickDate: job.tickDate, message: error.message });
          untrackedFailure = true;
        }
        return;
      }
      if (!days?.length) return;
      if (deferredBridgeTeams.has(team.id) && !workByTeam.has(team.id)) { waitingForDate = true; return; }
      let tracked = workByTeam.has(team.id);
      // #6609: failure identity carries the race day being settled (or the date race days when it fails before the loop).
      let failingGameDay = null;
      try {
        const lateBridge = !workByTeam.has(team.id) && days.every(day => day < 0) && now >= trainingDateDeadline(job.tickDate);
        const work = workByTeam.get(team.id) ?? await registerWork({ supabase, teamId: team.id, seasonId: job.season.id, tickDate: job.tickDate, gameDays: days, riderIds: currentIds, now, lateBridge });
        if (!work) { deferredBridgeTeams.add(team.id); waitingForDate = true; return; }
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
        // #6504: a rider who left the team (released, retired, graduated) is not a
        // reconciliation finding. Only for an ordinary team in the active season;
        // riderById may not hold a released rider, so unknown counts as a candidate
        // and the RPC decides from riders.team_id.
        const ordinaryTeam = !unsafeSeason && !team.is_bank && !team.is_frozen && !team.is_test_account;
        const leftTeam = ordinaryTeam
          ? unavailable.filter(id => !currentIds.includes(id) && riderById.get(id)?.team_id == null)
          : [];
        const departed = leftTeam.length
          ? await departRiders({ supabase, teamId: team.id, seasonId: job.season.id, tickDate: job.tickDate, riderIds: leftTeam, now })
          : [];
        summary.departed += departed.length;
        const toQuarantine = unavailable.filter(id => !departed.includes(id));
        if (toQuarantine.length) {
          await quarantineRiders({ supabase, teamId: team.id, seasonId: job.season.id, tickDate: job.tickDate,
            riderIds: toQuarantine, reason: unsafeSeason ? 'historical_season_requires_review' : 'roster_or_opening_evidence_unavailable', now });
          summary.quarantined += toQuarantine.length;
        }
        const available = remaining.filter(id => !unavailable.includes(id));
        const readiness = resolveTrainingDateReadiness({ ...context, tickDate: job.tickDate, now, riderIds: available });
        summary.pending += Object.keys(readiness.unresolvedSlotsByRider).length;
        if (!readiness.deadlineReached && Object.keys(readiness.unresolvedSlotsByRider).length) waitingForDate = true;
        if (!readiness.eligibleRiderIds.length) return;
        if (divisionId) divisions.add(divisionId);
        for (const gameDay of work.game_days) {
          failingGameDay = gameDay;
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
        summary.failed++; summary.failures.push({ teamId: team.id, tickDate: job.tickDate, gameDay: failingGameDay ?? (days.length === 1 ? days[0] : days.join(",")), message: error.message });
        if (!tracked) untrackedFailure = true;
        logger.error?.('[training-date] team retained for retry', team.id, error.message);
      }
    });
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
