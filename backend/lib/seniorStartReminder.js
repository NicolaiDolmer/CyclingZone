import { applyHumanTeamFilter, isHumanTeam } from "./humanTeamFilter.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { teamInRacePool } from "./raceBinding.js";
import { isSeniorSquadRow } from "./squads.js";
import { defaultFetchActiveRiderCounts, SQUAD_BELOW_MINIMUM_TYPE } from "./squadBelowMinimumCheck.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { notifyTeamOwner as defaultNotify } from "./notificationService.js";
import { captureException } from "./sentry.js";

const MS_PER_HOUR = 60 * 60 * 1000;

function firstScheduledStage(rows = []) {
  return rows
    .map((row) => ({ row, startMs: Date.parse(row.scheduled_at) }))
    .filter(({ row, startMs }) => Number.isFinite(startMs) && Number.isInteger(Number(row.game_day)) && Number(row.game_day) >= 1)
    .sort((a, b) => a.startMs - b.startMs)[0] ?? null;
}

/** Pure plan: one nearest senior race per team and true game_day, in one time slot. */
export function planSeniorStartReminders({
  teams = [],
  seniorCountsByTeam = new Map(),
  races = [],
  scheduleByRace = new Map(),
  withdrawnByRace = new Map(),
  now,
  floor = MIN_RACE_ENTRIES,
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Explicit valid now is required");
  const byTeamAndDay = new Map();
  const nowMs = now.getTime();

  for (const team of teams) {
    if (!isHumanTeam(team) || !team.user_id || !team.league_division_id || team.parked_at || team.retired_at) continue;
    const count = Number(seniorCountsByTeam.get(team.id) ?? 0);
    if (!Number.isFinite(count) || count >= floor) continue;

    for (const race of races) {
      if (race?.status !== "scheduled" || Number(race.stages_completed) > 0 || !isSeniorSquadRow(race)) continue;
      if (!teamInRacePool({ teamDivisionId: team.league_division_id, racePoolId: race.league_division_id })) continue;
      if (withdrawnByRace.get(race.id)?.has(team.id)) continue;
      const first = firstScheduledStage(scheduleByRace.get(race.id));
      if (!first) continue;
      const hoursUntil = (first.startMs - nowMs) / MS_PER_HOUR;
      if (hoursUntil <= 0 || hoursUntil > 24) continue;
      const slot = hoursUntil <= 3 ? "3h" : "24h";
      const gameDay = Number(first.row.game_day);
      const key = `${team.id}:${gameDay}`;
      const candidate = {
        teamId: team.id,
        userId: team.user_id,
        seniorCount: count,
        missing: floor - count,
        gameDay,
        slot,
        firstRaceId: race.id,
        scheduledAt: new Date(first.startMs).toISOString(),
      };
      const previous = byTeamAndDay.get(key);
      if (!previous || first.startMs < Date.parse(previous.scheduledAt)) byTeamAndDay.set(key, candidate);
    }
  }

  return [...byTeamAndDay.values()].sort((a, b) =>
    Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.teamId.localeCompare(b.teamId));
}

export function buildSeniorStartNotification({ candidate, seasonNumber }) {
  const hours = candidate.slot === "3h" ? 3 : 24;
  return {
    type: SQUAD_BELOW_MINIMUM_TYPE,
    title: "Senior squad needs riders",
    // Stable per season, game day and slot. The live count belongs in metadata,
    // not this fallback text, so a roster change cannot create a duplicate.
    message: `Season ${seasonNumber}, race day ${candidate.gameDay}: fewer than ${hours} hours remain and your senior squad is below the start minimum. Find riders in the market.`,
    relatedId: null,
    metadata: {
      action: "market",
      gameDay: candidate.gameDay,
      seasonNumber,
      slot: candidate.slot,
      titleCode: "notif.seniorStartReminder.title",
      titleParams: {},
      messageCode: candidate.slot === "3h"
        ? "notif.seniorStartReminder.message3h"
        : "notif.seniorStartReminder.message24h",
      messageParams: {
        count: candidate.seniorCount,
        missing: candidate.missing,
        min: MIN_RACE_ENTRIES,
        gameDay: candidate.gameDay,
      },
    },
  };
}

async function defaultFetchActiveSeason({ supabase }) {
  const { data, error } = await supabase.from("seasons").select("id, number")
    .eq("status", "active").maybeSingle();
  if (error) throw error;
  return data;
}

async function defaultFetchTeams({ supabase }) {
  return fetchAllRows(() => applyHumanTeamFilter(supabase.from("teams")
    .select("id, user_id, league_division_id, is_ai, is_bank, is_frozen, is_test_account, parked_at, retired_at"))
    .not("user_id", "is", null).is("parked_at", null).is("retired_at", null).order("id"));
}

async function defaultFetchRaces({ supabase, seasonId, raceIds }) {
  if (!raceIds.length) return [];
  return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("races")
    .select("id, name, status, stages_completed, league_division_id, squad")
    .in("id", chunk).eq("season_id", seasonId).eq("status", "scheduled").order("id"));
}

async function defaultFetchScheduleByRace({ supabase, now }) {
  const rows = await fetchAllRows(() => supabase.from("race_stage_schedule")
    .select("race_id, scheduled_at, game_day")
    .eq("stage_number", 1)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", new Date(now.getTime() + 24 * MS_PER_HOUR).toISOString())
    .order("scheduled_at").order("race_id"));
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(row);
  }
  return byRace;
}

async function defaultFetchWithdrawals({ supabase, raceIds }) {
  if (!raceIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_withdrawals")
    .select("race_id, team_id").in("race_id", chunk)
    .order("race_id").order("team_id"));
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, new Set());
    byRace.get(row.race_id).add(row.team_id);
  }
  return byRace;
}

export async function runSeniorStartReminderSweep({
  supabase,
  now,
  notify = defaultNotify,
  fetchActiveSeason = defaultFetchActiveSeason,
  fetchTeams = defaultFetchTeams,
  fetchRaces = defaultFetchRaces,
  fetchScheduleByRace = defaultFetchScheduleByRace,
  fetchSeniorCounts = defaultFetchActiveRiderCounts,
  fetchWithdrawals = defaultFetchWithdrawals,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Explicit valid now is required");
  const stats = { planned: 0, sent: 0, deduped: 0, failed: 0 };
  const season = await fetchActiveSeason({ supabase });
  if (!season) return stats;
  const scheduleByRace = await fetchScheduleByRace({ supabase, now });
  const raceIds = [...scheduleByRace.keys()];
  if (!raceIds.length) return stats;
  const [teams, races] = await Promise.all([
    fetchTeams({ supabase }),
    fetchRaces({ supabase, seasonId: season.id, raceIds }),
  ]);
  if (!teams.length || !races.length) return stats;
  const [seniorCountsByTeam, withdrawnByRace] = await Promise.all([
    fetchSeniorCounts({ supabase, teamIds: teams.map((t) => t.id) }),
    fetchWithdrawals({ supabase, raceIds }),
  ]);
  const planned = planSeniorStartReminders({ teams, seniorCountsByTeam, races, scheduleByRace, withdrawnByRace, now });
  stats.planned = planned.length;
  for (const candidate of planned) {
    try {
      const payload = buildSeniorStartNotification({ candidate, seasonNumber: season.number });
      const result = await notify({ supabase, teamId: candidate.teamId, now, ...payload });
      if (result?.delivered) stats.sent++;
      else if (result?.deduped) stats.deduped++;
    } catch (error) {
      stats.failed++;
      console.error(`senior-start reminder failed for team ${candidate.teamId}:`, error?.message || error);
      captureException(error, { tags: { flow: "notifications", stage: "senior-start-reminder" }, extra: { teamId: candidate.teamId } });
    }
  }
  return stats;
}
