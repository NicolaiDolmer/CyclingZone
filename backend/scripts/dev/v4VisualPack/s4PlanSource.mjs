// backend/scripts/dev/v4VisualPack/s4PlanSource.mjs
// #5804: hvor kommer S4's foerste uge fra? To kilder, i denne raekkefoelge:
//
//   (1) PROD-KALENDEREN, naar den er skrevet (races + race_stage_profiles +
//       race_stage_schedule for saeson 4). Kun SELECT.
//   (2) Ellers TOERKOERSLENS PLAN: materializeTierCalendars({ dryRun: true }) med
//       PRAECIS de argumenter buildSeasonCalendar.js sender for S4
//       (--season 4 --first-day 2026-09-28 --uniform-tilt --target-structure s4).
//       dryRun skriver intet (se tierCalendarMaterializer.js); planen baerer
//       etape-tider og de profiler der ville blive skrevet (#4270).
//
// Begge kilder returnerer den SAMME form, saa resten af pakken ikke ved hvilken
// der blev brugt:
//   { source, races: [{ key, tier, squad, poolId, name, race_class, race_type,
//                        stages: [stage_profile-raekke + scheduled_at + game_day] }] }
//
// 100 % READ-ONLY. Ingen insert/update/delete nogen steder i denne fil.

import { materializeTierCalendars } from "../../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom, resolveSeasonWindow, SEASON_RACE_DAYS_DEFAULT } from "../../../lib/calendarStartDate.js";
import { SEASON_RACE_DAY_TARGET } from "../../../lib/calendarRaceDayTargets.js";
import { resolveEarliestSeasonTransition } from "../../../lib/calendarPlanningWindow.js";
import { SEASON_TRANSITION_PLANNED_AT_KEY } from "../../../lib/seasonTransitionBoundary.js";
import { toStageProfileRow } from "../../../lib/raceStageProfileGenerator.js";
import { resolveTargetStructure } from "../../../lib/calendarTargetStructure.js";
import {
  seasonUuid, quotasForRaceDays, fetchPreviousSeasonLastStages, loadCutoverPoolRetirement,
} from "../../buildSeasonCalendar.js";
import { syntheticRaceId } from "./packCore.js";
import { fetchAllRows } from "../../../lib/supabasePagination.js";

export const S4_SEASON_NUMBER = 4;
export const S4_FIRST_RACE_DAY = "2026-09-28";

/** Planens argumenter, som buildSeasonCalendar.js bygger dem for S4 (dry-run). */
async function s4PlanArgs({ supabase, firstRaceDay, seasonNumber }) {
  const from = resolveCalendarFrom({ firstRaceDate: firstRaceDay });
  const window = resolveSeasonWindow({ firstRaceDay, raceDays: SEASON_RACE_DAYS_DEFAULT[seasonNumber] ?? null });
  const realDays = window.raceDays;
  const { data: plannedAtRow } = await supabase
    .from("app_config").select("value").eq("key", SEASON_TRANSITION_PLANNED_AT_KEY).maybeSingle();
  const previous = await fetchPreviousSeasonLastStages({ supabase, seasonNumber });
  const transition = resolveEarliestSeasonTransition({
    previousSeasonLastStageAt: previous.latestAt,
    plannedAt: plannedAtRow?.value ?? null,
    firstRaceDay,
  });
  return {
    from,
    realDays,
    quotas: quotasForRaceDays(realDays),
    raceDayTarget: SEASON_RACE_DAY_TARGET[seasonNumber] ?? null,
    seasonTransitionAt: transition.at,
    previousSeasonLastStageAtByTier: previous.byTier,
    seasonLastRaceDay: window.lastRaceDay,
  };
}

function racesFromPlan({ plan, tiers, squad, firstPoolOnly = true }) {
  const out = [];
  for (const tierPlan of plan.planTiers ?? []) {
    if (tiers && !tiers.includes(tierPlan.tier)) continue;
    const pools = firstPoolOnly ? (tierPlan.pools ?? []).slice(0, 1) : (tierPlan.pools ?? []);
    const profiles = tierPlan.profilesByPoolRaceId ?? new Map();
    for (const pool of pools) {
      const schedByRace = new Map();
      for (const s of pool.stageRows ?? []) {
        if (!schedByRace.has(s.pool_race_id)) schedByRace.set(s.pool_race_id, new Map());
        schedByRace.get(s.pool_race_id).set(s.stage_number, s);
      }
      for (const r of pool.raceRows ?? []) {
        const id = syntheticRaceId(`${squad}:${pool.leagueDivisionId}:${r.pool_race_id}`);
        const sched = schedByRace.get(r.pool_race_id) ?? new Map();
        const stages = (profiles.get(r.pool_race_id) ?? []).map((p) => ({
          ...toStageProfileRow(id, p),
          scheduled_at: sched.get(p.stage_number)?.scheduled_at ?? null,
          game_day: sched.get(p.stage_number)?.game_day ?? null,
        }));
        out.push({
          key: id, id, tier: tierPlan.tier, squad, poolId: pool.leagueDivisionId,
          name: r.name, race_class: r.race_class, race_type: r.race_type, stages,
        });
      }
    }
  }
  return out;
}

/**
 * Proev prod-kalenderen foerst; faldbagud til toerkoerslens plan.
 * @returns {Promise<{source: string, races: Array<object>, notes: string[]}>}
 */
export async function loadS4Races({ supabase, tiers = [1, 4], youth = true, firstRaceDay = S4_FIRST_RACE_DAY, seasonNumber = S4_SEASON_NUMBER, log = () => {} }) {
  const seasonId = seasonUuid(seasonNumber);
  const notes = [];
  const { data: existing, error } = await supabase
    .from("races").select("id, name, race_class, race_type, league_division_id, squad").eq("season_id", seasonId).limit(1);
  if (error) throw new Error(`races (S4 findes?): ${error.message}`);
  if (existing?.length) {
    return { source: "prod", races: await loadProdRaces({ supabase, seasonId, tiers, youth }), notes };
  }

  log("S4-kalenderen er ikke skrevet i prod endnu -> toerkoerslens plan (dryRun, intet skrives).");
  const args = await s4PlanArgs({ supabase, firstRaceDay, seasonNumber });
  const structure = resolveTargetStructure("s4");
  const cutover = await loadCutoverPoolRetirement({ supabase, structure });
  const senior = await materializeTierCalendars({
    supabase, seasonId, seasonStartDate: firstRaceDay, dryRun: true, log: () => {},
    useUniformTierTilt: true, squad: "senior", cutoverRetiredPoolIds: [...cutover.retireIds], ...args,
  });
  const races = racesFromPlan({ plan: senior, tiers, squad: "senior" });
  if (youth) {
    for (const squad of ["u23", "junior"]) {
      try {
        const plan = await materializeTierCalendars({
          supabase, seasonId, seasonStartDate: firstRaceDay, dryRun: true, log: () => {}, squad, ...args,
        });
        races.push(...racesFromPlan({ plan, tiers: null, squad }));
      } catch (err) {
        notes.push(`${squad}-kalenderen kunne ikke planlaegges: ${err.message}`);
      }
    }
  }
  return { source: "dry-run-plan", races, notes };
}

async function loadProdRaces({ supabase, seasonId, tiers, youth }) {
  const { data: divisions, error: dErr } = await supabase.from("league_divisions").select("id, tier, squad");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const divById = new Map((divisions ?? []).map((d) => [d.id, d]));
  const races = await fetchAllRows(() => supabase
    .from("races").select("id, name, race_class, race_type, stages, league_division_id, squad").eq("season_id", seasonId).order("id"));
  // Én repraesentativ pulje pr. (trup, tier): alle puljer i en tier deler kalender (#2276).
  const firstPool = new Map();
  for (const r of races ?? []) {
    const d = divById.get(r.league_division_id);
    if (!d) continue;
    const squad = r.squad ?? "senior";
    if (squad === "senior" && tiers && !tiers.includes(d.tier)) continue;
    if (squad !== "senior" && !youth) continue;
    const k = `${squad}:${d.tier}`;
    if (!firstPool.has(k) || String(r.league_division_id) < String(firstPool.get(k))) firstPool.set(k, r.league_division_id);
  }
  const kept = (races ?? []).filter((r) => {
    const d = divById.get(r.league_division_id);
    return d && firstPool.get(`${r.squad ?? "senior"}:${d.tier}`) === r.league_division_id;
  });
  const out = [];
  for (const r of kept) {
    const [{ data: profs }, { data: sched }] = await Promise.all([
      // pagination-safe: ét loebs etaper (maks en Grand Tours ~21 raekker)
      supabase.from("race_stage_profiles").select("*").eq("race_id", r.id),
      // pagination-safe: ét loebs etaper (maks en Grand Tours ~21 raekker)
      supabase.from("race_stage_schedule").select("stage_number, scheduled_at, game_day").eq("race_id", r.id),
    ]);
    const schedBy = new Map((sched ?? []).map((s) => [s.stage_number, s]));
    out.push({
      key: r.id, id: r.id, tier: divById.get(r.league_division_id).tier, squad: r.squad ?? "senior",
      poolId: r.league_division_id, name: r.name, race_class: r.race_class, race_type: r.race_type,
      stages: (profs ?? []).map((p) => ({ ...p, scheduled_at: schedBy.get(p.stage_number)?.scheduled_at ?? null, game_day: schedBy.get(p.stage_number)?.game_day ?? null })),
    });
  }
  return out;
}
