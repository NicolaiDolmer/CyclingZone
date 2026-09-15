// Udloeseren "dagens loebsdage lukker" (#4847, fase B4).
// ============================================================================
// Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md
//       §3.1 ("Udloeser"), §3.2 ("Udloeser og kapacitet"), §7 G6.
// Ejer-beslutninger 15/9: docs/TRAINING_RULES.md §13.3 beslutning 3 + 4.
//
// HVAD DEN ER. EEN samlet sweep pr. KALENDERDAG der koerer ALLE dagens loebsdage i
// ALLE divisioner i EEN koersel. Den erstatter IKKE trainingSweep.js — den loeber
// ved siden af og tager over naar `training_tick_per_race_day` er on (se §"To sweeps"
// nedenfor). Flag off ⇒ den returnerer { ran:false, skipped:"flag_off" } uden et
// eneste DB-kald ud over selve flag-opslaget.
//
// DE TO BETINGELSER (ejer 15/9, beslutning 3+4) — BEGGE skal vaere opfyldt:
//   1. Klokken er mindst 20:00 DANSK tid. Maalt aktivitet: kl. 16 = 218 aktive
//      spillerdage/time, 17-20 ≈ 185-199, 21 = 127. Kl. 20 er "dagens oejeblik":
//      sent nok til at dagens loeb er kaldt hjem, tidligt nok til at rapporten
//      bliver laest samme aften.
//   2. Dagens SIDSTE finalization er faerdig. En etape der stadig afvikles eller
//      sidder i en halv afslutning (races.finalize_state != null, #4147) ville
//      ellers give rytteren en TRAENINGSDAG for en loebsdag han faktisk KOERTE —
//      dailyTrainingEngine.js's racedToday-opslag ville simpelthen ikke se resultatet
//      endnu. Vi UDSKYDER derfor i stedet for at gaette.
//
// MAKS-VENTETID OG ALARM. En etape der haenger maa ikke koste hele bestanden en
// loebsdags udvikling: en udeblevet loebsdag kan ikke hentes igen (noeglen er
// (team, season, game_day), og i morgen er det en anden game_day). Efter
// MAX_WAIT_HOUR koerer sweepen derfor ALLIGEVEL og fyrer en alarm med praecis hvilke
// etaper der stadig var aabne. Byttet er bevidst: en haandfuld ryttere faar en
// traeningsdag hvor de skulle have haft en loebsdag (udbyttet er i samme
// stoerrelsesorden — se dailyTraining.js' RACE_DEV_CONFIG.devMult 1.15), mod at
// HELE bestanden ellers mistede dagen.
//
// IDEMPOTENS. Tre lag, i den raekkefoelge:
//   a) overlap-guard (modul-lokal) — samme moenster som stage-scheduleren fik efter
//      #2090. Sweepen tager 130-150 s i dag og ca. 5x det ved 5 loebsdage/dag; et
//      5-min-tick ville ellers starte tick nr. 2 OVENI.
//   b) dags-claim (modul-lokal) — naar dagen er koert faerdig, springer resten af
//      dagens ticks over uden DB-arbejde.
//   c) det PARTIELLE unikke index paa training_day_runs (team_id, season_id,
//      COALESCE(squad,'senior'), game_day) — den ENESTE af de tre der overlever en
//      proces-genstart, og derfor den der faktisk BAERER idempotensen. a) og b) er
//      kapacitet, ikke korrekthed.
//
// AKSE-FAELDEN (CALENDAR_RULES §0). `game_day` LAESES fra race_stage_schedule.game_day.
// Den udledes ALDRIG af scheduled_at — `scheduled_at` bruges KUN til at afgraense
// hvilke raekker der hoerer til DAGENS danske kalenderdoegn.
//
// Refs #4847 #4846 #4850 #4620 #2090 #4147

import { copenhagenHour, copenhagenDateString, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isTrainingTickPerRaceDayEnabled } from "./trainingTickRaceDayFlag.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";

/** Tidligste danske klokketime sweepen maa koere (ejer 15/9, beslutning 4). */
export const SWEEP_FROM_HOUR = 20;

/**
 * Efter denne danske klokketime venter vi ikke laengere paa en haengende
 * finalization — vi koerer og alarmerer. Tre timers slack fra kl. 20 er rundhaandet
 * i forhold til den maalte stage-scheduler-kadence (5 min) og #4147-vagtens
 * 10-minutters stuck-marker-graense.
 */
export const MAX_WAIT_HOUR = 23;

/** Standard-truppen. #4620 giver senere U23/junior deres egen loebsdags-akse. */
export const DEFAULT_SQUAD = "senior";

/**
 * Hvor mange hold der traenes samtidig. 1 = sekventielt, praecis som
 * trainingSweep.js koerer i dag. G6-harnessen (backend/scripts/dev/
 * trainingDayCloseCapacity.mjs) maaler hvad tallet betyder for varigheden;
 * vaerdien her er den KONSERVATIVE default, ikke et maal.
 */
export const TEAM_CONCURRENCY = 1;

// ── Modul-lokal tilstand (lag a + b i idempotens-kaskaden) ───────────────────
let sweepRunning = false;
let lastCompletedDate = null;

/** Kun til test: nulstil overlap-guard og dags-claim. */
export function __resetTrainingDayCloseStateForTests() {
  sweepRunning = false;
  lastCompletedDate = null;
}

/** Kun til test/ops: er en sweep i gang lige nu? */
export function isTrainingDayCloseSweepRunning() {
  return sweepRunning;
}

/**
 * PUR: er dansk tid inden for sweep-vinduet?
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

/**
 * PUR: er maks-ventetiden paa en haengende finalization udloebet?
 * @param {Date} [now]
 * @returns {boolean}
 */
export function waitedLongEnough(now = new Date()) {
  return copenhagenHour(now) >= MAX_WAIT_HOUR;
}

/**
 * PUR: hvilke af dagens etaper er endnu IKKE lukket?
 *
 * En etape regnes lukket naar BEGGE holder:
 *   - loebet har afviklet mindst saa mange etaper som etapens nummer
 *     (races.stages_completed >= stage_number), og
 *   - loebet baerer INGEN halv trin-markering (races.finalize_state == null, #4147).
 *
 * Et loeb der slet ikke findes i `raceById` regnes som AABENT — en manglende raekke
 * er en ukendt tilstand, og den fail-safe der udskyder er den rigtige her (vi
 * risikerer hoejst at vente til MAX_WAIT_HOUR).
 *
 * @param {Array<{race_id: string, stage_number: number, game_day: number}>} stageRows
 * @param {Map<string, {stages_completed?: number, finalize_state?: unknown}>} raceById
 * @returns {Array<{race_id: string, stage_number: number, reason: string}>}
 */
export function pendingStagesFor(stageRows, raceById) {
  const pending = [];
  for (const row of stageRows ?? []) {
    const race = raceById.get(row.race_id);
    if (!race) {
      pending.push({ race_id: row.race_id, stage_number: row.stage_number, reason: "race_missing" });
      continue;
    }
    const completed = Number(race.stages_completed ?? 0);
    if (!Number.isFinite(completed) || completed < Number(row.stage_number)) {
      pending.push({ race_id: row.race_id, stage_number: row.stage_number, reason: "stage_not_run" });
      continue;
    }
    if (race.finalize_state != null) {
      pending.push({ race_id: row.race_id, stage_number: row.stage_number, reason: "finalizing" });
    }
  }
  return pending;
}

/**
 * PUR: divisions-id → dagens loebsdage, stigende.
 *
 * `game_day` LAESES (akse-faelden, CALENDAR_RULES §0). Raekker uden division eller
 * uden et endeligt game_day springes over — de kan ikke placeres paa en akse.
 *
 * @param {Array<{race_id: string, game_day: number}>} stageRows
 * @param {Map<string, string|null>} divisionByRace
 * @returns {Map<string, number[]>}
 */
export function gameDaysByDivision(stageRows, divisionByRace) {
  const byDivision = new Map();
  for (const row of stageRows ?? []) {
    const divisionId = divisionByRace.get(row.race_id) ?? null;
    if (!divisionId) continue;
    const gd = Number(row.game_day);
    if (!Number.isFinite(gd)) continue;
    if (!byDivision.has(divisionId)) byDivision.set(divisionId, new Set());
    byDivision.get(divisionId).add(gd);
  }
  const out = new Map();
  for (const [divisionId, set] of byDivision) {
    out.set(divisionId, [...set].sort((a, b) => a - b));
  }
  return out;
}

/**
 * PUR: hvad skal koeres, for hvem?
 *
 * Bygger den fulde arbejdsliste FOER foerste write, saa kapaciteten (G6) kan maales
 * paa ét tal i stedet for at vokse undervejs.
 *
 * AI-HOLD UDEN `league_division_id` (4 maalt 6/9 blandt 362 berettigede hold) har
 * ingen loebsdags-akse. DE FAAR ET DEFINERET SVAR, ikke en stille stopper: praecis
 * ÉT tick paa den GAMLE kalenderdags-noegle (gameDay = null), som
 * dailyTrainingEngine.js's fail-safe-kaskade i forvejen falder tilbage til. De
 * udvikler sig altsaa videre i samme takt som i dag — de foelger bare ikke
 * loebsdags-aksen, fordi de ikke HAR en.
 *
 * @param {object} args
 * @param {Array<{id: string, league_division_id?: string|null}>} args.teams
 * @param {Map<string, number[]>} args.gameDaysByDivisionMap
 * @param {Set<string>} args.alreadyRanRaceDayKeys  — `${teamId}#${squad}#${gameDay}`
 * @param {Set<string>} args.alreadyRanLegacyTeamIds
 * @param {string} [args.squad]
 * @returns {Array<{teamId: string, gameDay: number|null, squad: string}>}
 */
export function buildSweepPlan({
  teams, gameDaysByDivisionMap, alreadyRanRaceDayKeys, alreadyRanLegacyTeamIds, squad = DEFAULT_SQUAD,
}) {
  const plan = [];
  for (const team of teams ?? []) {
    const divisionId = team.league_division_id ?? null;
    if (!divisionId) {
      if (!alreadyRanLegacyTeamIds.has(team.id)) {
        plan.push({ teamId: team.id, gameDay: null, squad });
      }
      continue;
    }
    for (const gameDay of gameDaysByDivisionMap.get(divisionId) ?? []) {
      if (alreadyRanRaceDayKeys.has(`${team.id}#${squad}#${gameDay}`)) continue;
      plan.push({ teamId: team.id, gameDay, squad });
    }
  }
  return plan;
}

/**
 * Koer den samlede daglige sweep.
 *
 * @param {object} args
 * @param {object} args.supabase      — service-role client
 * @param {Date}   [args.now]
 * @param {Function} [args.runDay]    — DI-hook; default runTeamTrainingDay
 * @param {Function} [args.onAlarm]   — kaldes med (Error, context) ved maks-ventetid
 * @param {object} [args.logger]
 * @returns {Promise<object>}
 */
export async function runTrainingDayCloseSweep({
  supabase,
  now = new Date(),
  runDay = runTeamTrainingDay,
  onAlarm = null,
  logger = console,
} = {}) {
  // ── a) Overlap-guard (#2090-moenstret, G6-krav) ─────────────────────────────
  // Kode-invariant: to sweeps kan ALDRIG vaere i luften samtidig i samme proces.
  if (sweepRunning) {
    return { ran: false, skipped: "overlap" };
  }

  const tickDate = copenhagenDateString(now);

  // ── b) Dags-claim ───────────────────────────────────────────────────────────
  if (lastCompletedDate === tickDate) {
    return { ran: false, skipped: "already_done_today", tickDate };
  }

  // ── Flag ────────────────────────────────────────────────────────────────────
  // `engineWrite` fordi en cron ingen viewer har (featureStage.js' skrive-gate).
  const raceDayTickOn = await isTrainingTickPerRaceDayEnabled(supabase, { engineWrite: true });
  if (!raceDayTickOn) return { ran: false, skipped: "flag_off" };

  const trainingOn = await isDailyTrainingEnabled(supabase);
  if (!trainingOn) return { ran: false, skipped: "daily_training_off" };

  // ── Betingelse 1: dansk tid >= kl. 20 ───────────────────────────────────────
  if (!shouldSweepNow(now)) return { ran: false, skipped: "before_window", tickDate };

  sweepRunning = true;
  const startedAt = Date.now();
  try {
    // ── Aktiv saeson ──────────────────────────────────────────────────────────
    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, number")
      .eq("status", "active")
      .maybeSingle();
    if (seasonError) throw new Error(`seasons: ${seasonError.message}`);
    if (!season) return { ran: false, skipped: "no_active_season", tickDate };

    // ── Dagens loeb + etaper ──────────────────────────────────────────────────
    // schema-columns-ok: finalize_state tilfoejes af database/2026-08-23-4147-*.sql
    const { data: races, error: racesError } = await supabase
      .from("races")
      .select("id, league_division_id, stages_completed, finalize_state")
      .eq("season_id", season.id);
    if (racesError) throw new Error(`races: ${racesError.message}`);
    const raceRows = races ?? [];
    if (!raceRows.length) return { ran: false, skipped: "no_races", tickDate };

    const raceById = new Map(raceRows.map((r) => [r.id, r]));
    const divisionByRace = new Map(raceRows.map((r) => [r.id, r.league_division_id ?? null]));

    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    // pagination-safe: afgraenset til ÉT dansk kalenderdoegn paa tvaers af fire
    // divisioner — D1 koerer 5 slots/dag, saa raekkerne er i titals-, ikke
    // tusindtals-omraadet (PostgREST's loft er 1000).
    const { data: stageRows, error: stageError } = await supabase
      .from("race_stage_schedule")
      .select("race_id, stage_number, game_day, scheduled_at")
      .in("race_id", [...raceById.keys()])
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString());
    if (stageError) throw new Error(`race_stage_schedule: ${stageError.message}`);
    const todaysStages = stageRows ?? [];

    const byDivision = gameDaysByDivision(todaysStages, divisionByRace);
    const todaysGameDays = [...new Set(todaysStages
      .map((r) => Number(r.game_day))
      .filter((n) => Number.isFinite(n)))];

    // ── Betingelse 2: er dagens sidste finalization faerdig? ──────────────────
    const pending = pendingStagesFor(todaysStages, raceById);
    let ranDespitePending = false;
    if (pending.length > 0) {
      if (!waitedLongEnough(now)) {
        return {
          ran: false, skipped: "awaiting_finalization", tickDate,
          pending: pending.length, pendingStages: pending,
        };
      }
      // Maks-ventetid udloebet: koer alligevel + alarmér (se hoved-docblokken).
      ranDespitePending = true;
      const err = new Error(
        `training day-close sweep ran with ${pending.length} stage(s) still open after ${MAX_WAIT_HOUR}:00 Europe/Copenhagen`,
      );
      logger.error?.(`  ⚠️ Traenings-lukning: ${pending.length} etape(r) stadig aabne efter kl. ${MAX_WAIT_HOUR} — koerer alligevel (alarm sendt)`);
      try {
        await onAlarm?.(err, { tickDate, pending });
      } catch { /* en fejlende alarm maa aldrig vaelte sweepen */ }
    }

    // ── Hold ──────────────────────────────────────────────────────────────────
    // Samme hold-diskriminator som trainingSweep.js (kanonik for "rigtige hold").
    // #3459 D4: race_day_engine_enabled fjerner is_ai-filteret.
    const raceDayEngineOn = await isRaceDayEngineEnabled(supabase);
    let teamsQuery = supabase
      .from("teams")
      .select("id, league_division_id")
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false);
    if (!raceDayEngineOn) teamsQuery = teamsQuery.eq("is_ai", false);
    const { data: teams, error: teamsError } = await teamsQuery;
    if (teamsError) throw new Error(`teams: ${teamsError.message}`);
    if (!teams) throw new Error("teams query returned null (unexpected)");

    // ── Allerede koerte ticks ─────────────────────────────────────────────────
    // To akser, to opslag: loebsdags-noeglen for hold MED division, den gamle
    // kalenderdags-noegle for de division-loese AI-hold.
    const [raceDayRunsRes, legacyRunsRes] = await Promise.all([
      todaysGameDays.length
        ? supabase
          .from("training_day_runs")
          .select("team_id, game_day, squad")
          .eq("season_id", season.id)
          .in("game_day", todaysGameDays)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("training_day_runs")
        .select("team_id")
        .eq("tick_date", tickDate)
        .is("game_day", null),
    ]);
    if (raceDayRunsRes.error) throw new Error(`training_day_runs (race day): ${raceDayRunsRes.error.message}`);
    if (legacyRunsRes.error) throw new Error(`training_day_runs (legacy): ${legacyRunsRes.error.message}`);

    const alreadyRanRaceDayKeys = new Set(
      (raceDayRunsRes.data ?? []).map((r) => `${r.team_id}#${r.squad ?? DEFAULT_SQUAD}#${r.game_day}`),
    );
    const alreadyRanLegacyTeamIds = new Set((legacyRunsRes.data ?? []).map((r) => r.team_id));

    const plan = buildSweepPlan({
      teams,
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys,
      alreadyRanLegacyTeamIds,
    });

    // ── Eksekvering ───────────────────────────────────────────────────────────
    // Sekventielt pr. default (TEAM_CONCURRENCY = 1), praecis som trainingSweep.js:
    // én fejl maa aldrig stoppe resten, og skrivetrykket skal vaere forudsigeligt.
    let swept = 0;
    let alreadyRan = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < plan.length; i += TEAM_CONCURRENCY) {
      const slice = plan.slice(i, i + TEAM_CONCURRENCY);
      await Promise.all(slice.map(async (item) => {
        try {
          const result = await runDay({
            supabase,
            teamId: item.teamId,
            seasonId: season.id,
            seasonNumber: season.number,
            executedBy: "assistant",
            now,
            gameDay: item.gameDay,
            squad: item.squad,
          });
          if (result?.alreadyRan) alreadyRan += 1;
          else swept += 1;
        } catch (err) {
          failed += 1;
          failures.push({ teamId: item.teamId, gameDay: item.gameDay, message: err.message });
          logger.error?.(`  ❌ Traenings-lukning fejlede for hold ${item.teamId} (loebsdag ${item.gameDay}):`, err.message);
        }
      }));
    }

    // Dags-claimen saettes KUN naar hele planen er gennemloebet uden at vaere
    // afbrudt — ellers ville en enkelt exception laase dagen ude for resten af
    // aftenens ticks.
    lastCompletedDate = tickDate;

    return {
      ran: true,
      tickDate,
      seasonId: season.id,
      gameDays: todaysGameDays.sort((a, b) => a - b),
      divisions: byDivision.size,
      planned: plan.length,
      swept,
      alreadyRan,
      failed,
      failures,
      ranDespitePending,
      pending: pending.length,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    sweepRunning = false;
  }
}
