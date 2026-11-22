// #8580 / #8550 del 3 · Den rullende uge: i dag + 6 dage, pr. dato holdets løb og
// pr. rytter hvilke af datoens fem felter der er løb eller bundet hvile.
//
// Grundlag for dagsvælgeren i I dag R5 (#8580) og Program-fanens uge. Dommer-scenarier:
// docs/audits/7456-program-dommer-scenarier.md §5 (UGE-1..7). Ejeren 22/11 (K-7): ingen
// træthed frem i tiden. Dag 0 er dagens GET /forecast-svar UÆNDRET (UGE-1), så de to aldrig
// kan vise hver sit.
//
// Regler, der genbruges uændret (I5, ingen kopi):
//   · løbsdagsaksen pr. dato: gameDaySpansByDivision (samme hul-udfyldning som sweepen),
//     med forrige datos højeste løbsdag som prior. Ingen forlængelse ved sæsonens sidste
//     løbsdato: en dato, der ikke giver præcis 5 løbsdage, er available:false (UGE-5).
//   · bindinger, etaper og udgang af løb: forecastBindingsFromEntryDays (#5949, UGE-3).
//   · felt pr. løbsdag: programSlotForRaceDay.
// Et løb i divisionen, som rytteren ikke er udtaget til, er ikke hans løbsfelt (UGE-4).
import { gameDaySpansByDivision, loadPriorMaxGameDayByDivision } from "./trainingDayCloseTrigger.js";
import { forecastBindingsFromEntryDays, loadTeamFatigueForecast, FORECAST_SLOTS } from "./trainingWeekPlanForecast.js";
import { loadRaceExitGameDays } from "./trainingRaceDayTick.js";
import { programSlotForRaceDay } from "./trainingPrograms.js";
import { copenhagenDateString, copenhagenMidnightUTC, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_WEEK_FORECAST_FLAG_KEY = "training_week_forecast";
export const WEEK_FORECAST_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Viewerens svar: off | beta (kun beta-testere) | on. Manglende række/fejl = off.
export async function isTrainingWeekForecastEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_WEEK_FORECAST_FLAG_KEY), opts);
}

// "YYYY-MM-DD" + n kalenderdage (UTC-middag, DST-robust som copenhagenWeekdayKey).
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * PUR: løbsdagsaksen for datoerne efter i dag, kædet dato for dato.
 * stagesByDate: Map<date, Array<{race_id, game_day}>> (kun holdets division).
 * basePrior: højeste løbsdag FØR datoen dates[0] (NO_PRIOR_GAME_DAY / null som i sweepen).
 * Returnerer Map<date, number[] | null>; null = aksen giver ikke præcis 5 løbsdage.
 */
export function weekGameDaysByDate({ dates, stagesByDate, divisionId, basePrior }) {
  const out = new Map();
  let prior = basePrior;
  for (const date of dates) {
    const stages = stagesByDate.get(date) ?? [];
    const divisionByRace = new Map(stages.map((row) => [row.race_id, divisionId]));
    const spans = gameDaySpansByDivision(stages, divisionByRace, new Map([[divisionId, prior]]));
    const gameDays = spans.get(divisionId)?.gameDays ?? [];
    out.set(date, gameDays.length === FORECAST_SLOTS ? gameDays : null);
    const maxToday = stages.reduce((max, row) => Math.max(max, Number(row.game_day)), -Infinity);
    if (Number.isFinite(maxToday)) {
      const p = prior === null || prior === undefined ? NaN : Number(prior);
      prior = Number.isFinite(p) ? Math.max(p, maxToday) : maxToday;
    }
  }
  return out;
}

/**
 * PUR: felterne for én dato. Ingen træthed (K-7).
 *   raceSlots: felter med en etape, rytteren er udtaget til.
 *   restSlots: felter hvor rytteren er bundet uden etape (GT-hviledag): hvile, ikke træning.
 * Et felt i ingen af dem er planens pas.
 */
export function weekDateRiderFields({ gameDays, riderIds, plannedStages, boundRiderIdsByGameDay }) {
  const out = {};
  const days = new Set(gameDays.map(Number));
  for (const id of riderIds) {
    const stageDays = new Set(plannedStages.filter((row) => row.rider_id === id && days.has(Number(row.game_day))).map((row) => Number(row.game_day)));
    const raceSlots = [];
    const restSlots = [];
    for (const day of gameDays) {
      const slot = programSlotForRaceDay(day, gameDays);
      if (stageDays.has(Number(day))) raceSlots.push(slot);
      else if (stageDays.size === 0 && boundRiderIdsByGameDay.get(Number(day))?.has(id)) restSlots.push(slot);
    }
    out[id] = { raceSlots, restSlots };
  }
  return out;
}

/**
 * PUR: holdets løb på en dato (UGE-6): navn og etape eller endagsløb.
 * stages: datoens etaper i divisionen; races: Map<race_id, {name, stages}>.
 */
export function weekDateRaces({ stages, races }) {
  const byRace = new Map();
  for (const row of stages) {
    const race = races.get(row.race_id);
    if (!race) continue;
    const kind = Number(race.stages) > 1 ? "stage" : "oneday";
    const prev = byRace.get(row.race_id);
    const stageNumber = Number(row.stage_number);
    if (!prev) byRace.set(row.race_id, { raceId: row.race_id, name: race.name ?? null, kind, stages: [stageNumber] });
    else if (!prev.stages.includes(stageNumber)) prev.stages.push(stageNumber);
  }
  return [...byRace.values()].map((r) => ({ ...r, stages: r.stages.sort((a, b) => a - b) }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

async function rows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function stripJoin(list) {
  return (list ?? []).map(({ races, ...row }) => row);
}

// ── I/O: hele ugen for ét hold ───────────────────────────────────────────────
// { available, reason?, tickDate, days: [{ date, weekday, available, races, riders }] }
// days[0].riders er dagens GET /forecast-svar uændret (UGE-1); days[1..6].riders er
// { raceSlots, restSlots } pr. rytter.
// loadToday: dagens svar, som GET /forecast giver det (routen sender sin egen gate med, UGE-1).
export async function loadTeamWeekForecast({ supabase, team, seasonId, now = new Date(), loadToday = () => loadTeamFatigueForecast({ supabase, team, seasonId, now }) }) {
  const tickDate = copenhagenDateString(now);
  const base = { tickDate, days: [] };
  if (!seasonId) return { ...base, available: false, reason: "no_active_season" };
  const divisionId = team?.league_division_id ?? null;
  if (!divisionId) return { ...base, available: false, reason: "no_division" };

  const dates = Array.from({ length: WEEK_FORECAST_DAYS }, (_, i) => addDays(tickDate, i));
  const weekStart = copenhagenMidnightUTC(now);
  // Seneste midnat efter dag 6: 7 døgn plus et kvarter, så en DST-uge ikke klipper sidste dag.
  const weekEnd = copenhagenMidnightUTC(new Date(weekStart.getTime() + WEEK_FORECAST_DAYS * DAY_MS + 3 * 60 * 60 * 1000));

  const todayP = loadToday();
  // pagination-safe: one roster (senior + academy), far below the 1000-row cap.
  const ridersP = rows(supabase.from("riders").select("id").eq("team_id", team.id).eq("is_retired", false), "week riders");
  // pagination-safe: one division, seven Danish calendar days, 5 stages a date (~35 rows).
  const stagesP = rows(supabase.from("race_stage_schedule")
    .select("race_id, stage_number, game_day, scheduled_at, races!inner(season_id, league_division_id)")
    .eq("races.season_id", seasonId).eq("races.league_division_id", divisionId)
    .gte("scheduled_at", weekStart.toISOString()).lt("scheduled_at", weekEnd.toISOString()), "week stages");

  // pagination-safe: one division's races in one season (well below 1000).
  const divisionRacesP = rows(supabase.from("races").select("id, name, stages").eq("season_id", seasonId).eq("league_division_id", divisionId), "week races");

  const [today, riders, rawStages, divisionRaces] = await Promise.all([todayP, ridersP, stagesP, divisionRacesP]);
  const stages = stripJoin(rawStages);
  const stagesByDate = new Map(dates.map((d) => [d, []]));
  for (const row of stages) {
    const date = copenhagenDateString(new Date(row.scheduled_at));
    stagesByDate.get(date)?.push(row);
  }

  // Sidste løbsdag FØR ugen, over alle divisionens løb i sæsonen (samme loader som sweepen).
  const divisionRaceIds = divisionRaces.map((r) => r.id);
  const priorMap = await loadPriorMaxGameDayByDivision({ supabase, raceIdsByDivision: new Map([[divisionId, divisionRaceIds]]), dayStart: weekStart });
  const basePrior = priorMap.get(divisionId) ?? null;
  const gameDaysByDate = weekGameDaysByDate({ dates, stagesByDate, divisionId, basePrior });
  const races = new Map(divisionRaces.map((r) => [r.id, r]));

  const riderIds = riders.map((r) => r.id);
  const futureDays = [...new Set(dates.slice(1).flatMap((d) => gameDaysByDate.get(d) ?? []))];
  // pagination-safe: roster x up to 30 game days, UNIQUE (rider_id, season_id, game_day); chunked by game day.
  const entryDays = [];
  if (riderIds.length && futureDays.length) {
    for (let i = 0; i < futureDays.length; i += 10) {
      entryDays.push(...await rows(supabase.from("race_entry_days").select("rider_id, race_id, game_day")
        .eq("season_id", seasonId).in("game_day", futureDays.slice(i, i + 10)).in("rider_id", riderIds), "week bindings"));
    }
  }
  const boundRaceIds = [...new Set(entryDays.map((row) => row.race_id))];
  const [schedule, exits] = boundRaceIds.length
    ? await Promise.all([
      // pagination-safe: a few bound races, at most 21 stages each.
      rows(supabase.from("race_stage_schedule").select("race_id, stage_number, game_day").in("race_id", boundRaceIds), "week schedule"),
      loadRaceExitGameDays({ supabase, rows: entryDays }).then(({ data, error }) => {
        if (error) throw new Error(`week race exits: ${error.message ?? error}`);
        return data;
      }),
    ])
    : [[], new Map()];
  // Profilerne bruges ikke uden træthed (K-7); en tom liste giver samme bindinger.
  const { plannedStages, boundRiderIdsByGameDay } = forecastBindingsFromEntryDays({ entryDays, schedule, profiles: [], exits });

  const days = dates.map((date, i) => {
    const weekday = copenhagenWeekdayKey(date);
    const dateRaces = weekDateRaces({ stages: stagesByDate.get(date) ?? [], races });
    if (i === 0) {
      return { date, weekday, available: today.available === true, races: dateRaces, today };
    }
    const gameDays = gameDaysByDate.get(date);
    if (!gameDays) return { date, weekday, available: false, races: dateRaces, riders: {} };
    return {
      date, weekday, available: true, races: dateRaces,
      riders: weekDateRiderFields({ gameDays, riderIds, plannedStages, boundRiderIdsByGameDay }),
    };
  });
  return { ...base, available: true, days };
}
