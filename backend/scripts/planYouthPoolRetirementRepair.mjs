#!/usr/bin/env node
// #4753: read-only, targeted preview for the two AI youth-pool retirements.
// No apply option exists. Exact IDs and output are private owner evidence.
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { copenhagenDateString } from "../lib/copenhagenTime.js";
import { isRiderInjured } from "../lib/riderEligibility.js";
import { planYouthPoolReplacements } from "../lib/youthPoolReplacementPlan.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const [flag, value] = arg.split("=", 2);
    if (flag === "--retired-team-id" || flag === "--pending-team-id") {
      if (!UUID.test(value ?? "")) throw new Error(`${flag} requires a UUID`);
      options[flag.slice(2)] = value;
    } else {
      throw new Error(`Unknown option: ${flag}. This script has no apply mode.`);
    }
  }
  if (!options["retired-team-id"] || !options["pending-team-id"])
    throw new Error("Both --retired-team-id and --pending-team-id are required");
  if (options["retired-team-id"] === options["pending-team-id"])
    throw new Error("Targets must be different teams");
  return options;
}

export async function readYouthPoolRepairPlan({ supabase, retiredTeamId, pendingTeamId, now }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Explicit valid now required");
  const today = copenhagenDateString(now);
  const teams = await fetchAllRows(() => supabase.from("teams")
    .select("id, name, is_ai, user_id, is_bank, is_frozen, is_test_account, parked_at, retired_at, pending_removal_at, league_division_id, u23_league_division_id, junior_league_division_id")
    .order("id"));
  const ids = [retiredTeamId, pendingTeamId];
  const targets = ids.map((id) => teams.find((team) => team.id === id));
  if (targets.some((team) => !team)) throw new Error("One or both target teams disappeared; rerun discovery");
  const candidates = teams.filter((team) => team.is_ai && team.id !== retiredTeamId && team.id !== pendingTeamId
    && team.u23_league_division_id == null && team.junior_league_division_id == null);
  const candidateIds = candidates.map((team) => team.id);
  const inspectedIds = [...ids, ...candidateIds];
  const riders = await fetchAllRowsChunkedIn(inspectedIds, (chunk) => supabase.from("riders")
    .select("id, team_id, squad, is_academy, is_retired, pending_team_id").in("team_id", chunk).order("id"));
  const conditions = await fetchAllRowsChunkedIn(riders.map((rider) => rider.id), (chunk) => supabase.from("rider_condition")
    .select("rider_id, injured_until").in("rider_id", chunk).order("rider_id"));
  const injuredUntilByRider = new Map(conditions.map((condition) => [condition.rider_id, condition.injured_until]));
  // An old entry can have a null/stale team_id but still bind this club's rider.
  // Mirror ai_team_retirement_reason and the replacement SQL: inspect both keys.
  const [entriesByTeamRows, entriesByRiderRows] = await Promise.all([
    fetchAllRowsChunkedIn(inspectedIds, (chunk) => supabase.from("race_entries")
      .select("team_id, race_id, rider_id").in("team_id", chunk)
      .order("team_id").order("race_id").order("rider_id")),
    fetchAllRowsChunkedIn(riders.map((rider) => rider.id), (chunk) => supabase.from("race_entries")
      .select("team_id, race_id, rider_id").in("rider_id", chunk)
      .order("race_id").order("rider_id")),
  ]);
  const entries = [...new Map([...entriesByTeamRows, ...entriesByRiderRows]
    .map((entry) => [`${entry.race_id}:${entry.rider_id}`, entry])).values()];
  const raceIds = [...new Set(entries.map((entry) => entry.race_id))];
  const races = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("races")
    .select("id, name, squad, status, stages_completed").in("id", chunk).order("id"));
  const raceById = new Map(races.map((race) => [race.id, race]));
  const countsByTeam = new Map();
  for (const rider of riders) {
    if (rider.is_academy !== true || rider.is_retired !== false || rider.pending_team_id != null
      || isRiderInjured(injuredUntilByRider.get(rider.id) ?? null, today)) continue;
    if (!countsByTeam.has(rider.team_id)) countsByTeam.set(rider.team_id, { u23: 0, junior: 0 });
    if (rider.squad === "u23" || rider.squad === "junior") countsByTeam.get(rider.team_id)[rider.squad]++;
  }
  const riderTeamById = new Map(riders.map((rider) => [rider.id, rider.team_id]));
  const entriesByTeam = new Map();
  for (const entry of entries) {
    for (const teamId of new Set([entry.team_id, riderTeamById.get(entry.rider_id)])) {
      if (!teamId) continue;
      if (!entriesByTeam.has(teamId)) entriesByTeam.set(teamId, []);
      entriesByTeam.get(teamId).push(entry);
    }
  }
  const targetRaceIds = [...new Set(ids.flatMap((id) => (entriesByTeam.get(id) ?? [])
    .map((entry) => entry.race_id)))];
  const schedule = await fetchAllRowsChunkedIn(targetRaceIds, (chunk) => supabase.from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at").in("race_id", chunk).order("race_id").order("stage_number"));
  const lastScheduledByRace = new Map();
  for (const row of schedule) {
    const previous = lastScheduledByRace.get(row.race_id);
    if (!previous || row.scheduled_at > previous) lastScheduledByRace.set(row.race_id, row.scheduled_at);
  }
  const groupCounts = new Map();
  for (const target of targets) {
    for (const [column, id] of [["u23_league_division_id", target.u23_league_division_id],
      ["junior_league_division_id", target.junior_league_division_id]]) {
      if (id == null) continue;
      groupCounts.set(id, teams.filter((team) => team[column] === id && team.is_bank !== true).length);
    }
  }
  const candidateRows = candidates.map((team) => ({
    ...team,
    u23Riders: countsByTeam.get(team.id)?.u23 ?? 0,
    juniorRiders: countsByTeam.get(team.id)?.junior ?? 0,
    futureYouthEntries: (entriesByTeam.get(team.id) ?? []).filter((entry) => {
      const race = raceById.get(entry.race_id);
      return race && race.status !== "completed" && ["u23", "junior"].includes(race.squad);
    }).length,
  }));
  const targetRows = targets.map((team) => {
    const unfinished = (entriesByTeam.get(team.id) ?? []).map((entry) => raceById.get(entry.race_id))
      .filter((race) => race && race.status !== "completed");
    const unique = [...new Map(unfinished.map((race) => [race.id, race])).values()];
    return {
      ...team,
      futureEntries: unfinished.length,
      blockingRaces: unique.map((race) => ({
        raceId: race.id, raceName: race.name, squad: race.squad,
        stagesCompleted: race.stages_completed,
        lastScheduledAt: lastScheduledByRace.get(race.id) ?? null,
      })),
    };
  });
  const plan = planYouthPoolReplacements({ targets: targetRows, candidates: candidateRows, groupCounts });
  return {
    readOnly: true,
    asOf: now.toISOString(),
    eligibilityDate: today,
    groupCounts: Object.fromEntries(groupCounts),
    targets: targetRows.map(({ id, name, retired_at, pending_removal_at, blockingRaces, futureEntries }) =>
      ({ id, name, retired_at, pending_removal_at, blockingRaces, futureEntries })),
    ...plan,
  };
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("/planYouthPoolRetirementRepair.mjs")) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY required in the local environment");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } });
    const plan = await readYouthPoolRepairPlan({ supabase,
      retiredTeamId: args["retired-team-id"], pendingTeamId: args["pending-team-id"], now: new Date() });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (plan.blockers.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Read-only youth repair plan failed: ${error.message}`);
    process.exitCode = 1;
  }
}
