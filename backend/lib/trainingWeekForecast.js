// #8580 / #8550 del 3 · Den rullende uge: i dag + 7 dage (8 datoer), pr. dato holdets løb og
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
// Et løb, holdet ingen har i endnu, er en løbsdag med auto-udtagelse (UGE-4b).
import { gameDaySpansByDivision, loadPriorMaxGameDayByDivision } from "./trainingDayCloseTrigger.js";
import { catalogV3GateForTeam, forecastBindingsFromEntryDays, loadTeamFatigueForecast, FORECAST_SLOTS } from "./trainingWeekPlanForecast.js";
import { loadRaceExitGameDays } from "./trainingRaceDayTick.js";
import { programForSession, programSlotForRaceDay } from "./trainingPrograms.js";
import { rotationPassAt } from "./trainingRotation.js";
import { loadRotationPlans } from "./trainingRotationProgress.js";
import { applyFatigueRules, loadTeamFatigueRules } from "./trainingFatigueRules.ts";
import { isInjuredOnRaceDay } from "./injuryRaceDays.js";
import { copenhagenDateString, copenhagenMidnightUTC, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_WEEK_FORECAST_FLAG_KEY = "training_week_forecast";
// 8 datoer: dagsvælgeren viser i dag + 7 dage (#8580, wireframe R5 Day); Program-fanens
// ugegitter bruger de første 7 (i dag + 6, UGE-1).
export const WEEK_FORECAST_DAYS = 8;
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
//   Skadet på løbsdagen (isInjuredOnRaceDay, skadens kendte slut-løbsdag) er også hvile.
// Forrang som dagens forecastSlotActivity: etape > skade > bundet hvile > planens pas.
export function weekDateRiderFields({ gameDays, riderIds, plannedStages, boundRiderIdsByGameDay, injuredOn = () => false }) {
  const out = {};
  const days = new Set(gameDays.map(Number));
  for (const id of riderIds) {
    const stageDays = new Set(plannedStages.filter((row) => row.rider_id === id && days.has(Number(row.game_day))).map((row) => Number(row.game_day)));
    const raceSlots = [];
    const restSlots = [];
    for (const day of gameDays) {
      const slot = programSlotForRaceDay(day, gameDays);
      if (stageDays.has(Number(day))) raceSlots.push(slot);
      else if (injuredOn(id, Number(day))) restSlots.push(slot);
      else if (stageDays.size === 0 && boundRiderIdsByGameDay.get(Number(day))?.has(id)) restSlots.push(slot);
    }
    out[id] = { raceSlots, restSlots };
  }
  return out;
}

export function forecastRotationFields({ rotation, startIndex, gameDays, fields, rule, rodeStagePreviousDate, catalogV3 = false }) {
  let index = startIndex % rotation.passes.length;
  const length = rotation.passes.length;
  const recoverySlots = [];
  const rotationSlots = gameDays.map((day) => {
    const slot = programSlotForRaceDay(day, gameDays);
    if (fields.raceSlots.includes(slot) || fields.restSlots.includes(slot)) return null;
    const pass = rotationPassAt(rotation, index);
    const program = programForSession(pass.session, null, { catalogV3 });
    if (!program?.ok) return null;
    if (slot === 0 && rodeStagePreviousDate && rule) {
      if (applyFatigueRules({ program, rule, slotIndex: slot, rodeStagePreviousDate }).stamp) {
        recoverySlots.push(slot);
        return null;
      }
    }
    const preview = { ...pass, index, length };
    index = (index + 1) % length;
    return preview;
  });
  return { ...fields, rotationSlots, recoverySlots, nextRotationIndex: index };
}

/**
 * PUR: holdets løb på en dato (UGE-6): navn og etape eller endagsløb.
 * stages: datoens etaper i divisionen; races: Map<race_id, {name, stages}>.
 */
//   ownRiders: hvor mange af holdets ryttere der kører løbet på datoen. Fund 2 i Fable-dommen 22/11.
//     Et løb med holdets bindinger (race_entry_days) tæller KUN bindingerne efter udgang af løb,
//     så ryttere, der er stået af, aldrig kommer tilbage. Et løb uden bindinger tæller holdets
//     tilmeldinger (race_entries, også assistentens auto-udtagelse) med samme udgangsfilter
//     (exits), så et kørt auto-løb ikke står som træning (#8580-rettelsen, UGE-4b).
//   autoLineup: holdet har ingen i løbet, og løbet er ikke startet (ingen kørt etape). Assistenten
//     udtager kun ved løbsstart (raceRunner: allowAutofill kun på 1. etape), så et igangværende
//     løb uden holdet er ikke holdets dag; et løb, der starter senere, er det på alle sine datoer
//     (UGE-4b).
export function weekDateRaces({ stages, races, plannedStages = [], raceIdByEntry = null, entryRows = [], exits = new Map(), startedRaceIds = new Set() }) {
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
  const days = new Set(stages.map((row) => Number(row.game_day)));
  const ownByRace = new Map();
  for (const row of plannedStages) {
    if (!days.has(Number(row.game_day))) continue;
    const raceId = raceIdByEntry?.get(`${row.rider_id}:${row.game_day}`) ?? null;
    if (!raceId || !byRace.has(raceId)) continue;
    if (!ownByRace.has(raceId)) ownByRace.set(raceId, new Set());
    ownByRace.get(raceId).add(row.rider_id);
  }
  const boundRaceIds = new Set(raceIdByEntry ? raceIdByEntry.values() : []);
  const firstDayOfRace = new Map();
  for (const row of stages) {
    const day = Number(row.game_day);
    if (!(firstDayOfRace.get(row.race_id) <= day)) firstDayOfRace.set(row.race_id, day);
  }
  const entriesByRace = new Map();
  for (const row of entryRows) {
    if (!byRace.has(row.race_id) || boundRaceIds.has(row.race_id)) continue;
    // Samme regel som dropBindingsAfterRaceExit: rytteren kører en etape på datoen, hvis den
    // første ikke ligger efter hans udgangsdag.
    const exitDay = exits.get(`${row.rider_id}:${row.race_id}`);
    if (exitDay !== undefined && firstDayOfRace.get(row.race_id) > exitDay) continue;
    if (!entriesByRace.has(row.race_id)) entriesByRace.set(row.race_id, new Set());
    entriesByRace.get(row.race_id).add(row.rider_id);
  }
  return [...byRace.values()].map((r) => {
    const ownRiders = (boundRaceIds.has(r.raceId) ? ownByRace.get(r.raceId)?.size : entriesByRace.get(r.raceId)?.size) ?? 0;
    const autoLineup = ownRiders === 0 && !boundRaceIds.has(r.raceId) && !startedRaceIds.has(r.raceId)
      && races.get(r.raceId)?.status !== "completed";
    return { ...r, stages: r.stages.sort((a, b) => a - b), ownRiders, autoLineup };
  })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

async function rows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function stripJoin(list) {
  return (list ?? []).map(({ races: _join, ...row }) => row);
}

// ── I/O: hele ugen for ét hold ───────────────────────────────────────────────
// { available, reason?, tickDate, days: [{ date, weekday, available, races, riders }] }
// days[0].today er dagens GET /forecast-svar uændret (UGE-1); days[1..7].riders er
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
  // Midnat efter sidste dato: N døgn plus tre timer, så en DST-uge ikke klipper sidste dag.
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
  const divisionRacesP = rows(supabase.from("races").select("id, name, stages, status").eq("season_id", seasonId).eq("league_division_id", divisionId), "week races");

  // Sidste løbsdag FØR ugen, over alle divisionens løb i sæsonen (samme loader som sweepen).
  // Sendes, så snart løbslisten er der, parallelt med resten (fund 6).
  const priorP = divisionRacesP.then((list) => loadPriorMaxGameDayByDivision({
    supabase, raceIdsByDivision: new Map([[divisionId, list.map((r) => r.id)]]), dayStart: weekStart,
  }));

  const [today, riders, rawStages, divisionRaces, priorMap] = await Promise.all([todayP, ridersP, stagesP, divisionRacesP, priorP]);
  const stages = stripJoin(rawStages);
  const stagesByDate = new Map(dates.map((d) => [d, []]));
  for (const row of stages) {
    const date = copenhagenDateString(new Date(row.scheduled_at));
    stagesByDate.get(date)?.push(row);
  }

  const basePrior = priorMap.get(divisionId) ?? null;
  const gameDaysByDate = weekGameDaysByDate({ dates, stagesByDate, divisionId, basePrior });
  const races = new Map(divisionRaces.map((r) => [r.id, r]));

  const riderIds = riders.map((r) => r.id);
  // Alle ugens løbsdage, også dag 0: dag 0's felter kommer fra /forecast, men dens løb skal
  // også kunne sige, om holdet har ryttere med (ownRiders), så vælgeren viser "Etape" i dag.
  const futureDays = [...new Set(dates.flatMap((d) => gameDaysByDate.get(d) ?? []))];
  // pagination-safe: roster x up to 30 game days, UNIQUE (rider_id, season_id, game_day); chunked by game day.
  const chunks = [];
  if (riderIds.length) for (let i = 0; i < futureDays.length; i += 10) chunks.push(futureDays.slice(i, i + 10));
  // Bindinger (bidder parallelt, fund 6) og trupens skader (fund 1) i samme runde.
  // pagination-safe: one roster's condition rows.
  const [entryChunks, conditions] = await Promise.all([
    Promise.all(chunks.map((part) => rows(supabase.from("race_entry_days").select("rider_id, race_id, game_day")
      .eq("season_id", seasonId).in("game_day", part).in("rider_id", riderIds), "week bindings"))),
    riderIds.length
      ? rows(supabase.from("rider_condition").select("rider_id, injury_end_game_day, injury_season_id, injured_until").in("rider_id", riderIds), "week injuries")
      : Promise.resolve([]),
  ]);
  const entryDays = entryChunks.flat();
  const conditionByRider = new Map(conditions.map((row) => [row.rider_id, row]));
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

  const raceIdByEntry = new Map(entryDays.map((row) => [`${row.rider_id}:${row.game_day}`, row.race_id]));
  // UGE-4b: holdets tilmeldinger til ugens løb (manuelle og assistentens), så et auto-løb
  // tæller med, og et løb uden tilmeldinger kan vises som auto-udtagelse.
  const weekRaceIds = [...new Set(stages.map((row) => row.race_id))];
  // pagination-safe: one roster x the week's division races (a few dozen races x at most ~10 riders).
  const entryRows = weekRaceIds.length && riderIds.length
    ? await rows(supabase.from("race_entries").select("race_id, rider_id").in("race_id", weekRaceIds).in("rider_id", riderIds), "week entries")
    : [];
  // Startede løb (mindst én kørt etape): her fylder assistenten ikke længere op (UGE-4b).
  // pagination-safe: one row per ridden stage of the week's division races (a few dozen races x <= 21 stages).
  const startedRaceIds = new Set(weekRaceIds.length
    ? (await rows(supabase.from("race_simulation_runs").select("race_id").in("race_id", weekRaceIds), "week started races")).map((row) => row.race_id)
    : []);
  // Udgang af løb for tilmeldingerne (samme loader som bindingerne, #5949).
  const entryExits = entryRows.length
    ? await loadRaceExitGameDays({ supabase, rows: entryRows }).then(({ data, error }) => {
      if (error) throw new Error(`week entry exits: ${error.message ?? error}`);
      return data;
    })
    : new Map();
  const rotationStarts = new Map(Object.entries(today.riders ?? {})
    .filter(([, result]) => Number.isInteger(result.nextRotationIndex))
    .map(([id, result]) => [id, result.nextRotationIndex]));
  const rotations = rotationStarts.size ? await loadRotationPlans({
    supabase, teamId: team.id, riderIds: [...rotationStarts.keys()], plans: [],
    // schema-columns-ok: plan_kind was added by the merged #8577 rotation migration.
    weekRows: await rows(supabase.from("training_week_plans").select("rider_id, plan_kind").eq("team_id", team.id), "week rotation plans"),
  }) : new Map();
  const [rotationRules, catalogV3] = rotations.size ? await Promise.all([
    loadTeamFatigueRules(supabase, team.id), catalogV3GateForTeam(supabase, team.id),
  ]) : [null, false];
  const days = dates.map((date, i) => {
    const weekday = copenhagenWeekdayKey(date);
    const dateRaces = weekDateRaces({ stages: stagesByDate.get(date) ?? [], races, plannedStages, raceIdByEntry, entryRows, exits: entryExits, startedRaceIds });
    if (i === 0) {
      return { date, weekday, available: today.available === true, races: dateRaces, today };
    }
    const gameDays = gameDaysByDate.get(date);
    if (!gameDays) return { date, weekday, available: false, races: dateRaces, riders: {} };
    const riderFields = weekDateRiderFields({
      gameDays, riderIds, plannedStages, boundRiderIdsByGameDay,
      injuredOn: (id, gameDay) => isInjuredOnRaceDay({ condition: conditionByRider.get(id), seasonId, gameDay, tickDate: date }),
    });
    for (const [id, rotation] of rotations) {
      const previousDays = gameDaysByDate.get(dates[i - 1]) ?? [];
      const rodeStagePreviousDate = plannedStages.some((stage) => stage.rider_id === id && previousDays.includes(stage.game_day))
        || (i === 1 && (today.riders?.[id]?.raceSlots?.length ?? 0) > 0);
      riderFields[id] = forecastRotationFields({
        rotation, startIndex: rotationStarts.get(id), gameDays, fields: riderFields[id],
        rule: rotationRules?.forRider(id), rodeStagePreviousDate, catalogV3,
      });
      rotationStarts.set(id, riderFields[id].nextRotationIndex);
    }
    return {
      date, weekday, available: true, races: dateRaces,
      riders: riderFields,
    };
  });
  return { ...base, available: true, days };
}
