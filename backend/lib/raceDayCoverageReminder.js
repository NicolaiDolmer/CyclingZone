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
import { indexGeneratorBindings } from "./raceEntryGeneratorBindings.ts";
import { overlapRuleApplies, overlapStartsShort } from "./raceFieldIntegrity.js";

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
 * PURE: (hold, løbsdag) med seniorløb der starter inden for vinduet. Kun menneskehold i
 * løbets pulje; afmeldte løb tæller ikke. #7339 A (3/11): også dage med ét løb, for et
 * langt etapeløb kan binde så mange ryttere, at selv det ene løb ikke kan nå gulvet.
 * Planen afgør, om der er grund til en besked.
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
    .map(({ startMs, ...g }) => ({ ...g, raceIds: [...g.raceIds].sort(), scheduledAt: new Date(startMs).toISOString() }))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.teamId.localeCompare(b.teamId));
}

// En rosterpost er enten bare skadedatoen (injured_until|null) eller
// { injuredUntil, bindings: [{ race_id, window: { start, end } }] }.
const asRosterRider = (entry) => (entry && typeof entry === "object"
  ? { injuredUntil: entry.injuredUntil ?? null, bindings: entry.bindings ?? [] }
  : { injuredUntil: entry ?? null, bindings: [] });

// #7339 A: rytteren er bundet på løbsdagen i et løb uden for gruppen (fx et igangværende
// etapeløb). Bindinger i gruppens egne løb tæller ikke: dem kan fordelingen flytte rundt på.
function boundElsewhere(rider, group) {
  return rider.bindings.some((b) => !group.raceIds.includes(b.race_id)
    && Number(b.window?.start) <= group.gameDay && group.gameDay <= Number(b.window?.end));
}

/**
 * PURE: de (hold, løbsdag) hvor truppen ikke kan stille op i alle dagens løb.
 * `rosterByTeam` = Map<team_id, Array<post>> (én post pr. egnet seniorrytter, se
 * asRosterRider); skaden vurderes mod løbsdagens danske dato, ikke mod i dag, og en rytter
 * bundet i et andet løb på løbsdagen er ikke ledig (#7339 A). Hold som seniorStartReminder
 * dækker (under gulvet i aktive seniorer, `seniorCountsByTeam`) springes over; et hold med
 * nok aktive men for få ledige raske får beskeden her, også med 0 løb.
 * `stageRaceIds` (Codex P2): er dagens eneste løb et etapeløb, og er holdet kun kort fordi
 * ryttere kører et andet løb på startdagen, må det starte kort (#6739 regel A,
 * overlapStartsShort). Så er der ingen grund til en besked.
 */
export function planRaceDayCoverageReminders({
  groups = [], rosterByTeam = new Map(), seniorCountsByTeam = null, floor = MIN_RACE_ENTRIES, stageRaceIds = new Set(),
} = {}) {
  const out = [];
  for (const group of groups) {
    const roster = (rosterByTeam.get(group.teamId) ?? []).map(asRosterRider);
    const active = seniorCountsByTeam ? Number(seniorCountsByTeam.get(group.teamId) ?? 0) : roster.length;
    if (!Number.isFinite(active) || active < floor) continue;
    const raceDate = copenhagenDateString(new Date(group.scheduledAt));
    let fit = 0; let overlap = 0; let injured = 0;
    for (const r of roster) {
      if (boundElsewhere(r, group)) overlap += 1;
      else if (r.injuredUntil && r.injuredUntil >= raceDate) injured += 1;
      else fit += 1;
    }
    const total = group.raceIds.length;
    const fieldable = countFieldableRaces({ supply: fit, races: total, floor });
    if (fieldable >= total) continue;
    if (total === 1 && stageRaceIds.has(group.raceIds[0])
      && overlapStartsShort({ starters: fit, overlap, injured, minEntries: floor })) continue;
    out.push({ ...group, fieldable, total });
  }
  return out;
}

// #6739-reglens løbsform (overlapRuleApplies) for de løb der er dagens eneste start.
export async function defaultFetchStageRaceIds({ supabase, raceIds }) {
  if (!raceIds.length) return new Set();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("races").select("id, race_type, stages").in("id", chunk).order("id"));
  return new Set(rows.filter(overlapRuleApplies).map((r) => r.id));
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

// #7339 A: rytternes bindinger på de berørte løbsdage, fra samme kilde som entry-
// generatoren (race_entries.binding_span + race_day_participation, sæson-scopet, samlet i
// raceEntryGeneratorBindings). Kun bindinger der rører [firstDay, lastDay] hentes.
async function fetchRiderBindings({ supabase, riderIds, seasonId, firstDay, lastDay }) {
  if (!riderIds.length || !seasonId || !Number.isInteger(firstDay) || !Number.isInteger(lastDay)) return new Map();
  const spans = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("race_entries")
    .select("race_id, rider_id, team_id, binding_span, races!inner(season_id)")
    .eq("races.season_id", seasonId).not("binding_span", "is", null)
    .overlaps("binding_span", `[${firstDay},${lastDay}]`)
    .in("rider_id", chunk).order("race_id").order("rider_id"));
  const participation = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("race_day_participation")
    .select("race_id, rider_id, game_day")
    .eq("season_id", seasonId).gte("game_day", firstDay).lte("game_day", lastDay)
    .in("rider_id", chunk).order("rider_id").order("game_day").order("race_id"));
  return indexGeneratorBindings(
    spans.map(({ race_id, rider_id, team_id, binding_span }) => ({ race_id, rider_id, team_id, binding_span })),
    participation.map(({ race_id, rider_id, game_day }) => ({ race_id, rider_id, game_day })),
  );
}

// Egnede seniorryttere pr. hold (samme filter som auto-fyldet) med deres skadedato og
// bindinger på løbsdagene. Kun skader der rækker til i dag eller senere hentes; planen
// vurderer dem mod løbsdagen.
export async function defaultFetchSeniorRoster({ supabase, teamIds, today, seasonId = null, gameDays = [] }) {
  if (!teamIds.length) return new Map();
  const riders = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    applyRiderEligibilityFilter(supabase.from("riders").select("id, team_id").in("team_id", chunk)).order("id"));
  const riderIds = riders.map((r) => r.id);
  const injured = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    applyInjuredFilter(supabase.from("rider_condition").select("rider_id, injured_until").in("rider_id", chunk), today).order("rider_id"));
  const injuredUntil = new Map(injured.map((r) => [r.rider_id, r.injured_until]));
  const days = gameDays.filter(Number.isInteger);
  const bindings = await fetchRiderBindings({
    supabase, riderIds, seasonId, firstDay: days.length ? Math.min(...days) : null, lastDay: days.length ? Math.max(...days) : null,
  });
  const roster = new Map();
  for (const r of riders) {
    if (!roster.has(r.team_id)) roster.set(r.team_id, []);
    roster.get(r.team_id).push({
      injuredUntil: injuredUntil.get(r.id) ?? null,
      bindings: (bindings.get(r.id) ?? []).map(({ race_id, window }) => ({ race_id, window })),
    });
  }
  return roster;
}

/**
 * Send løbsdags-beskederne. Kaldes fra seniorStartReminder-sweepen med dens allerede
 * hentede hold, løb og etape-1-tider. Fejl pr. hold isoleres (tælles).
 */
export async function sendRaceDayCoverageReminders({
  supabase, now, season, teams = [], races = [], scheduleByRace = new Map(), withdrawnByRace = new Map(),
  seniorCountsByTeam = null, notify, fetchRoster = defaultFetchSeniorRoster, fetchStageRaceIds = defaultFetchStageRaceIds,
}) {
  const stats = { planned: 0, sent: 0, deduped: 0, failed: 0 };
  const groups = groupTeamRaceDays({ teams, races, scheduleByRace, withdrawnByRace, now });
  if (!groups.length) return stats;
  const rosterByTeam = await fetchRoster({
    supabase, teamIds: [...new Set(groups.map((g) => g.teamId))], today: copenhagenDateString(now),
    seasonId: season?.id ?? null, gameDays: [...new Set(groups.map((g) => g.gameDay))],
  });
  let planned = planRaceDayCoverageReminders({ groups, rosterByTeam, seniorCountsByTeam });
  // Codex P2: kun kandidater med ét løb kan falde ind under regel A; deres løbsform hentes.
  const soloRaceIds = [...new Set(planned.filter((p) => p.total === 1).map((p) => p.raceIds[0]))];
  if (soloRaceIds.length) {
    const stageRaceIds = await fetchStageRaceIds({ supabase, raceIds: soloRaceIds });
    planned = planRaceDayCoverageReminders({ groups, rosterByTeam, seniorCountsByTeam, stageRaceIds });
  }
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
