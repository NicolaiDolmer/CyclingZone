// backend/lib/raceDayCoverageReminder.js
// #7339 (ejer-beslutning 1/11, del 2): en kort besked til manageren før løbsdagen, når
// seniortruppen ikke kan dække alle dagens løb. En rytter kan kun køre ét løb pr.
// løbsdag, og hvert løb kræver gulvet (MIN_RACE_ENTRIES), så 16 raske seniorer over 3
// løb samme dag giver kun 2 løb. Auto-fyldet fordeler nu gulv-bevidst (raceDayFloorPlan),
// og beskeden fortæller manageren det i forvejen, så han selv kan vælge løb eller købe.
//
// Søster til seniorStartReminder.js (#5867), der dækker hold under gulvet i aktive seniorer;
// denne dækker resten, når de raske ikke rækker til alle dagens løb. Kører i samme sweep
// (hvert 5. min, første etape inden for 24 timer) og genbruger dens løb og hold.
//
// Type `selection_warning` (eksisterende, ingen migration; samme valg som
// raceAvailabilityNotifications.js). Uden raceId linker den til kalenderen.
// Dedup: én besked pr. hold pr. løbsdag. EN-teksten (dedup-nøglen i notifyUser, 24t) er
// stabil pr. sæson og løbsdag; de skiftende tal ligger kun i metadata, så en ændret trup
// samme dag aldrig giver en besked mere. Vinduet (24t) er ikke længere end dedup'en.

import { isHumanTeam } from "./humanTeamFilter.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { teamInRacePool } from "./raceBinding.js";
import { isSeniorSquadRow } from "./squads.js";
import { applyRiderEligibilityFilter, applyInjuredFilter } from "./riderEligibility.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { countFieldableRaces } from "./raceDayFloorPlan.js";
import { captureException } from "./sentry.js";

export const RACE_DAY_COVERAGE_TYPE = "selection_warning";
export const RACE_DAY_COVERAGE_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

function firstStage(rows = []) {
  return rows
    .map((row) => ({ row, startMs: Date.parse(row.scheduled_at) }))
    .filter(({ row, startMs }) => Number.isFinite(startMs) && Number.isInteger(Number(row.game_day)) && Number(row.game_day) >= 1)
    .sort((a, b) => a.startMs - b.startMs)[0] ?? null;
}

/**
 * PURE: (hold, løbsdag) med mindst to seniorløb der starter inden for vinduet. Kun
 * menneskehold i løbets pulje; afmeldte løb tæller ikke.
 * @returns {Array<{ teamId, userId, gameDay, raceIds: string[], scheduledAt: string }>}
 */
export function groupTeamRaceDays({
  teams = [], races = [], scheduleByRace = new Map(), withdrawnByRace = new Map(), now, horizonHours = RACE_DAY_COVERAGE_HOURS,
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Explicit valid now is required");
  const nowMs = now.getTime();
  const dueRaces = [];
  for (const race of races) {
    if (race?.status !== "scheduled" || Number(race.stages_completed) > 0 || !isSeniorSquadRow(race)) continue;
    const first = firstStage(scheduleByRace.get(race.id));
    if (!first) continue;
    const hoursUntil = (first.startMs - nowMs) / MS_PER_HOUR;
    if (hoursUntil <= 0 || hoursUntil > horizonHours) continue;
    dueRaces.push({ race, gameDay: Number(first.row.game_day), startMs: first.startMs });
  }
  const groups = new Map();
  for (const team of teams) {
    if (!isHumanTeam(team) || !team.user_id || !team.league_division_id || team.parked_at || team.retired_at) continue;
    for (const { race, gameDay, startMs } of dueRaces) {
      if (!teamInRacePool({ teamDivisionId: team.league_division_id, racePoolId: race.league_division_id })) continue;
      if (withdrawnByRace.get(race.id)?.has(team.id)) continue;
      const key = `${team.id}:${gameDay}`;
      if (!groups.has(key)) groups.set(key, { teamId: team.id, userId: team.user_id, gameDay, raceIds: [], startMs });
      const group = groups.get(key);
      group.raceIds.push(race.id);
      if (startMs < group.startMs) group.startMs = startMs;
    }
  }
  return [...groups.values()]
    .filter((g) => g.raceIds.length >= 2)
    .map(({ startMs, ...g }) => ({ ...g, raceIds: [...g.raceIds].sort(), scheduledAt: new Date(startMs).toISOString() }))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.teamId.localeCompare(b.teamId));
}

/**
 * PURE: de (hold, løbsdag) hvor truppen ikke kan stille op i alle dagens løb.
 * `rosterByTeam` = Map<team_id, Array<injured_until|null>> (én post pr. egnet seniorrytter);
 * skaden vurderes mod løbsdagens danske dato, ikke mod i dag. Hold som seniorStartReminder
 * dækker (under gulvet i aktive seniorer, `seniorCountsByTeam`) springes over; et hold med
 * nok aktive men for få raske får beskeden her, også med 0 løb.
 */
export function planRaceDayCoverageReminders({
  groups = [], rosterByTeam = new Map(), seniorCountsByTeam = null, floor = MIN_RACE_ENTRIES,
} = {}) {
  const out = [];
  for (const group of groups) {
    const roster = rosterByTeam.get(group.teamId) ?? [];
    const active = seniorCountsByTeam ? Number(seniorCountsByTeam.get(group.teamId) ?? 0) : roster.length;
    if (!Number.isFinite(active) || active < floor) continue;
    const raceDate = copenhagenDateString(new Date(group.scheduledAt));
    const fit = roster.filter((injuredUntil) => !injuredUntil || injuredUntil < raceDate).length;
    const total = group.raceIds.length;
    const fieldable = countFieldableRaces({ supply: fit, races: total, floor });
    if (fieldable < total) out.push({ ...group, fieldable, total });
  }
  return out;
}

export function buildRaceDayCoverageNotification({ candidate, seasonNumber }) {
  return {
    type: RACE_DAY_COVERAGE_TYPE,
    title: "Not enough riders for every race",
    // Stabil pr. sæson og løbsdag (dedup-nøglen). Tallene står kun i metadata.
    message: `Season ${seasonNumber}, race day ${candidate.gameDay}: your senior squad can't cover every race that day. Pick your races, or find more riders in the market.`,
    relatedId: null,
    metadata: {
      gameDay: candidate.gameDay,
      seasonNumber,
      fieldable: candidate.fieldable,
      total: candidate.total,
      titleCode: "notif.raceDayCoverage.title",
      titleParams: {},
      messageCode: "notif.raceDayCoverage.message",
      messageParams: { gameDay: candidate.gameDay, fieldable: candidate.fieldable, total: candidate.total, min: MIN_RACE_ENTRIES },
    },
  };
}

// Egnede seniorryttere pr. hold (samme filter som auto-fyldet) med deres skadedato.
// Kun skader der rækker til i dag eller senere hentes; planen vurderer dem mod løbsdagen.
export async function defaultFetchSeniorRoster({ supabase, teamIds, today }) {
  if (!teamIds.length) return new Map();
  const riders = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    applyRiderEligibilityFilter(supabase.from("riders").select("id, team_id").in("team_id", chunk)).order("id"));
  const injured = await fetchAllRowsChunkedIn(riders.map((r) => r.id), (chunk) =>
    applyInjuredFilter(supabase.from("rider_condition").select("rider_id, injured_until").in("rider_id", chunk), today).order("rider_id"));
  const injuredUntil = new Map(injured.map((r) => [r.rider_id, r.injured_until]));
  const roster = new Map();
  for (const r of riders) {
    if (!roster.has(r.team_id)) roster.set(r.team_id, []);
    roster.get(r.team_id).push(injuredUntil.get(r.id) ?? null);
  }
  return roster;
}

/**
 * Send løbsdags-beskederne. Kaldes fra seniorStartReminder-sweepen med dens allerede
 * hentede hold, løb og etape-1-tider. Fejl pr. hold isoleres (tælles).
 */
export async function sendRaceDayCoverageReminders({
  supabase, now, season, teams = [], races = [], scheduleByRace = new Map(), withdrawnByRace = new Map(),
  seniorCountsByTeam = null, notify, fetchRoster = defaultFetchSeniorRoster,
}) {
  const stats = { planned: 0, sent: 0, deduped: 0, failed: 0 };
  const groups = groupTeamRaceDays({ teams, races, scheduleByRace, withdrawnByRace, now });
  if (!groups.length) return stats;
  const rosterByTeam = await fetchRoster({
    supabase, teamIds: [...new Set(groups.map((g) => g.teamId))], today: copenhagenDateString(now),
  });
  const planned = planRaceDayCoverageReminders({ groups, rosterByTeam, seniorCountsByTeam });
  stats.planned = planned.length;
  for (const candidate of planned) {
    try {
      const payload = buildRaceDayCoverageNotification({ candidate, seasonNumber: season.number });
      const result = await notify({ supabase, teamId: candidate.teamId, now, ...payload });
      if (result?.delivered) stats.sent++;
      else if (result?.deduped) stats.deduped++;
    } catch (error) {
      stats.failed++;
      console.error(`race-day coverage reminder failed for team ${candidate.teamId}:`, error?.message || error);
      captureException(error, { tags: { flow: "notifications", stage: "race-day-coverage" }, extra: { teamId: candidate.teamId } });
    }
  }
  return stats;
}
