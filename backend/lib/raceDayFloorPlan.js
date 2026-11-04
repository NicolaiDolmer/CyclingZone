// backend/lib/raceDayFloorPlan.js
// #7339 (ejer-beslutning 1/11): gulv-bevidst fordeling af ét holds ryttere over flere
// løb samme løbsdag. En rytter kan kun køre ét løb pr. løbsdag, og et hold under gulvet
// (MIN_RACE_ENTRIES) stiller ikke op. Den grådige fordeling (hvert løb tager op til sit
// max, det sidste får resten) kunne derfor binde 1-5 ryttere i et løb der aldrig starter,
// mens et andet løb samme dag manglede netop dem. Her bor de rene byggeklodser som
// entry-generatoren (assignTeamAcrossRaces), løbsstart-redningen (raceRunner) og
// løbsdags-beskeden (raceDayCoverageReminder) deler, så de tre steder regner ens.

import { windowsOverlap, raceBindingWindow } from "./raceBinding.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { raceSquadOf } from "./riderEligibility.js";
import { DEFAULT_SQUAD } from "./squads.js";
import { captureException } from "./sentry.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";

function windowPoints(w) {
  if (Array.isArray(w?.days) && w.days.length) return w.days;
  return Number.isFinite(w?.start) ? [w.start] : [];
}

function windowCoversPoint(w, point) {
  if (Array.isArray(w?.days) && w.days.length) return w.days.includes(point);
  return Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.start <= point && point <= w.end;
}

/**
 * Største samtidige behov: for hvert binding-punkt (løbsdag) summen af `need` for de
 * elementer hvis vindue dækker punktet. To løb på hver sin dag deler ryttere og
 * lægges derfor ikke sammen; to løb samme dag gør.
 * @param {Array<{window: {start:number, end:number, days?:number[]}, need: number}>} items
 */
export function peakConcurrentNeed(items = []) {
  let peak = 0;
  for (const item of items) {
    for (const point of windowPoints(item.window)) {
      let sum = 0;
      for (const other of items) if (windowCoversPoint(other.window, point)) sum += other.need;
      if (sum > peak) peak = sum;
    }
  }
  return peak;
}

/**
 * Antal løb der kan stilles op samme dag med `supply` frie ryttere, når hvert løb
 * skal have `floor` ryttere. Ren tælling (truppens kapacitet), ikke en fordeling.
 */
export function countFieldableRaces({ supply = 0, races = 0, floor = MIN_RACE_ENTRIES } = {}) {
  if (!(floor > 0)) return races;
  return Math.max(0, Math.min(races, Math.floor(Math.max(0, supply) / floor)));
}

/**
 * Løbsstart-redningen (raceRunner.fillMissingTeamEntries) for et hold UDEN entries:
 * hvor mange ryttere må dette løb tage, så holdets andre løb samme dag, der endnu
 * ikke er startet, stadig kan nå gulvet? Uden søsterløb (eller når dette løb ikke selv
 * kan nå gulvet) er svaret `max`, altså præcis den gamle adfærd.
 * @param {{ max: number, supply: number, floor?: number,
 *   siblings?: Array<{ window: object, need: number }> }} args
 */
export function floorAwareRescueCap({ max, supply, floor = MIN_RACE_ENTRIES, siblings = [] }) {
  if (!siblings?.length || supply < floor) return max;
  const kept = [];
  for (const sibling of siblings) {
    if (!(sibling.need > 0)) continue;
    if (floor + peakConcurrentNeed([...kept, sibling]) <= supply) kept.push(sibling);
  }
  return Math.max(floor, Math.min(max, supply - peakConcurrentNeed(kept)));
}

/**
 * Tynd I/O til redningen: for hvert hold, holdets ANDRE seniorløb i samme sæson og
 * pulje, der overlapper dette løbs løbsdag, ikke er startet, ikke er afmeldt eller
 * ryddet af holdet, og hvor holdet står under gulvet. `need` = ryttere holdet mangler
 * dér. Fejl-tolerant: en fejl giver et tomt kort (= den gamle adfærd), aldrig en
 * væltet løbsstart.
 * @returns {Promise<Map<string, Array<{ raceId: string, window: object, need: number }>>>}
 */
export async function loadSameDaySiblingNeeds({ supabase, race, thisWindow, teamIds = [], floor = MIN_RACE_ENTRIES }) {
  const out = new Map();
  if (!teamIds.length || !thisWindow || !race?.season_id || raceSquadOf(race) !== DEFAULT_SQUAD) return out;
  try {
    // Paginerede læsninger (PostgREST-loftet på 1000 rækker må ikke afkorte vinduer/tællinger).
    const raceRows = await fetchAllRows(() => {
      const q = supabase.from("races").select("id, squad, stages_completed, league_division_id")
        .eq("season_id", race.season_id).neq("id", race.id);
      return (race.league_division_id == null
        ? q.is("league_division_id", null)
        : q.eq("league_division_id", race.league_division_id)).order("id");
    });
    const candidates = raceRows.filter((r) => raceSquadOf(r) === DEFAULT_SQUAD && !(Number(r.stages_completed) > 0));
    if (!candidates.length) return out;
    const candidateIds = candidates.map((r) => r.id);
    const schedRows = await fetchAllRowsChunkedIn(candidateIds, (chunk) => supabase.from("race_stage_schedule")
      .select("race_id, scheduled_at, game_day").in("race_id", chunk)
      .order("race_id").order("stage_number"));
    const schedByRace = new Map();
    for (const row of schedRows || []) {
      if (!schedByRace.has(row.race_id)) schedByRace.set(row.race_id, []);
      schedByRace.get(row.race_id).push(row);
    }
    const siblings = candidateIds
      .map((id) => ({ raceId: id, window: raceBindingWindow(schedByRace.get(id)) }))
      .filter((s) => s.window && windowsOverlap(thisWindow, s.window));
    if (!siblings.length) return out;
    const siblingIds = siblings.map((s) => s.raceId);
    const byTeams = (table, columns, order) => fetchAllRowsChunkedIn(teamIds, (chunk) =>
      supabase.from(table).select(columns).in("race_id", siblingIds).in("team_id", chunk).order("race_id").order(order));
    const [entries, withdrawals, clears] = await Promise.all([
      byTeams("race_entries", "race_id, team_id, rider_id", "rider_id"),
      byTeams("race_withdrawals", "race_id, team_id", "team_id"),
      byTeams("race_entry_clears", "race_id, team_id", "team_id"),
    ]);
    const countByUnit = new Map();
    for (const e of entries) {
      const key = `${e.race_id}|${e.team_id}`;
      countByUnit.set(key, (countByUnit.get(key) || 0) + 1);
    }
    const skipped = new Set([...withdrawals, ...clears].map((r) => `${r.race_id}|${r.team_id}`));
    for (const teamId of teamIds) {
      const needs = [];
      for (const s of siblings) {
        const key = `${s.raceId}|${teamId}`;
        if (skipped.has(key)) continue;
        const need = floor - (countByUnit.get(key) || 0);
        if (need > 0) needs.push({ raceId: s.raceId, window: s.window, need });
      }
      if (needs.length) out.set(teamId, needs);
    }
    return out;
  } catch (err) {
    console.warn(`  ⚠️  race-start rescue ${race.id}: same-day sibling races unreadable, filling without floor reservation (#7339):`, err?.message || err);
    captureException(err, { tags: { flow: "race-start-autofill", stage: "same-day-siblings" }, raceId: race.id });
    return new Map();
  }
}
