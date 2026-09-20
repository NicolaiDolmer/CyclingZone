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

/**
 * Hvor mange loebsdage én kalenderdags sweep hoejst maa daekke pr. division.
 *
 * #4847 (ejer-regel 4, 18/9): en loebsdag UDEN loeb er en ren traeningsdag og skal
 * have sit tick. Den findes ikke i `race_stage_schedule`, saa den kan kun udledes af
 * HULLET mellem gaarsdagens sidste loebsdag og dagens (se `gameDaySpansByDivision`).
 * Hullet er normalt 0-3 dage. Loftet her er en OPS-sikring, ikke et design-tal: har
 * en division ligget stille laenge (kalender-rebuild, frossen saeson, en sweep der
 * ikke har koert i en uge), maa én aften ikke pludselig skrive tyve loebsdage for
 * hele bestanden. Overskrides loftet, koeres de NYESTE loebsdage og resten
 * rapporteres som `skippedGameDays` — synligt, ikke tavst.
 */
export const MAX_GAME_DAY_CATCH_UP = 8;

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
 * PUR: divisions-id → divisionens loeb-id'er. Input til det per-divisions opslag
 * af "sidste loebsdag foer i dag". Loeb uden division springes over — de hoerer
 * ikke til en akse (samme semantik som `gameDaysByDivision`).
 *
 * @param {Array<{id: string, league_division_id?: string|null}>} raceRows
 * @returns {Map<string, string[]>}
 */
export function groupRaceIdsByDivision(raceRows) {
  const out = new Map();
  for (const row of raceRows ?? []) {
    const divisionId = row?.league_division_id ?? null;
    if (!divisionId || !row.id) continue;
    if (!out.has(divisionId)) out.set(divisionId, []);
    out.get(divisionId).push(row.id);
  }
  return out;
}

/**
 * PUR: divisions-id → ALLE loebsdage denne kalenderdag lukker, stigende.
 *
 * #4847, EJER-REGEL 4 (18/9): "Alle divisioner faar lige mange loebsdage; loebsdage
 * uden loeb er rene traeningsdage." `gameDaysByDivision` ovenfor ser kun de loebsdage
 * der HAR en etape i dag — en ren traeningsdag har ingen raekke i
 * `race_stage_schedule` og fik derfor intet tick. Det var ejerens tredje fund i denne
 * PR 18/9.
 *
 * LOESNINGEN ER AKSENS MONOTONI, ikke et gaet. `game_day` vokser monotont hen over
 * kalenderdatoerne inden for en division. Er divisionens sidste loebsdag FOER i dag
 * nr. P, og dagens hoejeste loebsdag med loeb nr. E, saa er HELE spaendet P+1..E
 * lukket i aften — og de af dem der ikke havde et loeb, er praecis de rene
 * traeningsdage. Ingen loebsdag udledes af `scheduled_at` (akse-faelden,
 * CALENDAR_RULES §0): baade P og E er LAESTE `race_stage_schedule.game_day`-vaerdier,
 * og `scheduled_at` bruges kun til at vaelge HVILKE raekker der er "foer i dag" og
 * "i dag".
 *
 * TO KANTER:
 *   · Ingen tidligere loebsdag (saesonens foerste loebsdato) ⇒ spaendet starter paa
 *     dagens LAVESTE loebsdag. Vi opfinder ikke traeningsdage foer saesonen begyndte.
 *   · Ingen loeb i divisionen i dag ⇒ INTET spaend. E er ukendt, og hvor mange
 *     loebsdage aksen skulle rykke frem paa en helt loebsloes dato staar foerst i
 *     kalenderen naar #5169 lander. Det er den dokumenterede rest af regel 4.
 *
 * @param {Array<{race_id: string, game_day: number}>} todaysStageRows
 * @param {Map<string, string|null>} divisionByRace
 * @param {Map<string, number|null>} priorMaxGameDayByDivision — hoejeste loebsdag
 *   FOER dagens doegn, pr. division. null/ukendt ⇒ saesonens foerste loebsdato.
 * @param {{maxCatchUp?: number}} [opts]
 * @returns {Map<string, {gameDays: number[], skippedGameDays: number[]}>}
 */
export function gameDaySpansByDivision(
  todaysStageRows, divisionByRace, priorMaxGameDayByDivision, { maxCatchUp = MAX_GAME_DAY_CATCH_UP } = {},
) {
  const todaysByDivision = gameDaysByDivision(todaysStageRows, divisionByRace);
  const out = new Map();
  for (const [divisionId, todaysDays] of todaysByDivision) {
    if (!todaysDays.length) continue;
    const end = todaysDays[todaysDays.length - 1];
    // `Number(null)` er 0, ikke NaN — en division UDEN tidligere loebsdag ville
    // derfor blive laest som "sidste loebsdag var 0" og traekke hele spaendet fra
    // loebsdag 1 med. null/undefined skal vaere NaN her.
    const priorRaw = priorMaxGameDayByDivision?.get(divisionId);
    const prior = priorRaw === null || priorRaw === undefined ? NaN : Number(priorRaw);
    // Hullet aabner ved prior+1. `Math.min` mod dagens foerste loebsdag holder
    // spaendet korrekt ogsaa hvis prior af en eller anden grund ligger EFTER dagens
    // egne loebsdage (kalender-rebuild, omlagt schedule): saa falder vi tilbage til
    // dagens egne dage i stedet for at producere et tomt eller bagvendt spaend.
    const start = Number.isFinite(prior) ? Math.min(prior + 1, todaysDays[0]) : todaysDays[0];
    const full = [];
    for (let gd = start; gd <= end; gd += 1) full.push(gd);
    // Ops-loft: koer de NYESTE, rapportér resten frem for at skrive dem tavst.
    const skippedGameDays = full.length > maxCatchUp ? full.slice(0, full.length - maxCatchUp) : [];
    const gameDays = full.length > maxCatchUp ? full.slice(full.length - maxCatchUp) : full;
    out.set(divisionId, { gameDays, skippedGameDays });
  }
  return out;
}

/**
 * I/O: hoejeste loebsdag FOER dagens danske kalenderdoegn, pr. division.
 *
 * Een lille query pr. division (fire i prod), hver bounded af `.limit(1)` paa en
 * `order by game_day desc`. `game_day` LAESES; `scheduled_at` bruges kun som filter.
 *
 * FAIL-SAFE: en fejlet/tom division giver `null`, hvilket i
 * `gameDaySpansByDivision` betyder "ingen tidligere loebsdag" ⇒ kun dagens EGNE
 * loebsdage tickes. Vi mister i vaerste fald en ren traeningsdag; vi opfinder aldrig
 * en loebsdag paa et gaet.
 *
 * @param {{supabase: object, raceIdsByDivision: Map<string, string[]>, dayStart: Date}} args
 * @returns {Promise<Map<string, number|null>>}
 */
export async function loadPriorMaxGameDayByDivision({ supabase, raceIdsByDivision, dayStart }) {
  const out = new Map();
  for (const [divisionId, raceIds] of raceIdsByDivision) {
    if (!raceIds.length) { out.set(divisionId, null); continue; }
    try {
      const { data, error } = await supabase
        .from("race_stage_schedule")
        .select("game_day")
        // pagination-safe: limit(1) paa ÉN divisions loeb i ÉN saeson.
        .in("race_id", raceIds)
        .lt("scheduled_at", dayStart.toISOString())
        .order("game_day", { ascending: false })
        .limit(1);
      const gd = error ? null : Number(data?.[0]?.game_day);
      out.set(divisionId, Number.isFinite(gd) ? gd : null);
    } catch {
      // best-effort: "sidste loebsdag foer i dag" er en BERIGELSE, ikke en
      // regel-gate. Kan den ikke besvares, tickes divisionens EGNE loebsdage som
      // hidtil — vi taber i vaerste fald en ren traeningsdag, og vi opfinder
      // aldrig en loebsdag paa et gaet. En fejl her maa derfor ikke vaelte
      // aftenens sweep for hele bestanden.
      out.set(divisionId, null);
    }
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
 * Slaa dagens LUKKE-TILSTAND op — den betingelse BAADE sweepen og den frivillige
 * knap "Koer dagens traening nu" haenger paa (ejer 15/9, beslutning 3: "samme
 * betingelse som sweepen"). Een sandhed, to forbrugere.
 *
 * `divisionId` afgraenser til EEN divisions loebsdage (knappen: holdets egne).
 * Udeladt ⇒ hele bestanden (sweepen).
 *
 * FAIL-SAFE: kaster aldrig. Alt der ikke kan besvares giver closed:false med en
 * `reason` — en ukendt tilstand maa ikke kunne AABNE knappen.
 *
 * @param {{supabase: object, seasonId: string, now?: Date, divisionId?: string|null}} args
 * @returns {Promise<{closed: boolean, reason: string, gameDays: number[], pending: number}>}
 */
export async function resolveDayCloseStatus({ supabase, seasonId, now = new Date(), divisionId = null }) {
  const empty = { closed: false, reason: "unknown", gameDays: [], pending: 0 };
  if (!supabase?.from || !seasonId) return { ...empty, reason: "bad_args" };
  try {
    let racesQuery = supabase
      .from("races")
      // schema-columns-ok: finalize_state tilfoejes af database/2026-08-23-4147-*.sql
      .select("id, league_division_id, stages_completed, finalize_state")
      .eq("season_id", seasonId);
    if (divisionId) racesQuery = racesQuery.eq("league_division_id", divisionId);
    const { data: races, error: racesError } = await racesQuery;
    if (racesError) return { ...empty, reason: "races_error" };
    const raceRows = races ?? [];
    if (!raceRows.length) return { closed: true, reason: "no_races", gameDays: [], pending: 0 };

    const raceById = new Map(raceRows.map((r) => [r.id, r]));
    const divisionByRace = new Map(raceRows.map((r) => [r.id, r.league_division_id ?? null]));

    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    // pagination-safe: afgraenset til ÉT dansk kalenderdoegn, og naar `divisionId`
    // er sat endda til ÉN division. D1 koerer 5 slots/dag, saa raekkerne er i
    // titals-, ikke tusindtals-omraadet (PostgREST's loft er 1000).
    const { data: stageRows, error: stageError } = await supabase
      .from("race_stage_schedule")
      .select("race_id, stage_number, game_day, scheduled_at")
      .in("race_id", [...raceById.keys()])
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString());
    if (stageError) return { ...empty, reason: "stages_error" };

    const todaysStages = stageRows ?? [];
    const pending = pendingStagesFor(todaysStages, raceById);
    // #4847 (ejer-regel 4): knappen skal vise SAMME loebsdage som sweepen vil koere,
    // inklusive de rene traeningsdage i hullet — ellers ville fladen love faerre dage
    // end den faktisk kunne koere. Een sandhed, to forbrugere (ejer 15/9, beslutning 3).
    const raceIdsByDivision = groupRaceIdsByDivision(raceRows);
    const priorMaxByDivision = await loadPriorMaxGameDayByDivision({
      supabase, raceIdsByDivision, dayStart,
    });
    const spansByDivision = gameDaySpansByDivision(todaysStages, divisionByRace, priorMaxByDivision);
    const gameDays = [...new Set(
      [...spansByDivision.values()].flatMap((s) => s.gameDays),
    )].sort((a, b) => a - b);

    if (pending.length > 0) {
      return { closed: false, reason: "awaiting_finalization", gameDays, pending: pending.length };
    }
    return { closed: true, reason: "closed", gameDays, pending: 0 };
  } catch {
    // best-effort: en netvaerks-/synkron fejl maa ALDRIG kunne AABNE knappen eller
    // sweepen. En ukendt tilstand svarer "ikke lukket"; naeste cron-tick (5 min)
    // spoerger igen. Fejlen er derfor selv-helbredende og ikke Sentry-vaerdig.
    return { ...empty, reason: "exception" };
  }
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

    // ── #4847, ejer-regel 4 (18/9): rene traeningsdage tickes ogsaa ───────────
    // Ikke kun de loebsdage der HAR en etape i dag, men hele det spaend aftenen
    // lukker: fra divisionens sidste loebsdag foer i dag til dagens hoejeste. De
    // loebsdage i spaendet der ingen etape har, ER de rene traeningsdage.
    const raceIdsByDivision = groupRaceIdsByDivision(raceRows);
    const priorMaxByDivision = await loadPriorMaxGameDayByDivision({
      supabase, raceIdsByDivision, dayStart,
    });
    const spansByDivision = gameDaySpansByDivision(todaysStages, divisionByRace, priorMaxByDivision);
    const byDivision = new Map(
      [...spansByDivision].map(([divisionId, span]) => [divisionId, span.gameDays]),
    );
    const todaysGameDays = [...new Set([...byDivision.values()].flat())].sort((a, b) => a - b);
    const skippedGameDays = [...spansByDivision]
      .filter(([, span]) => span.skippedGameDays.length)
      .map(([divisionId, span]) => ({ divisionId, gameDays: span.skippedGameDays }));
    if (skippedGameDays.length) {
      // Synligt, ikke tavst (se MAX_GAME_DAY_CATCH_UP). ASCII-only: ops-log.
      logger.warn?.(
        `  ⚠️ Traenings-lukning: ${skippedGameDays.length} division(er) havde flere end ${MAX_GAME_DAY_CATCH_UP} uafviklede loebsdage - de aeldste springes over`,
      );
    }

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
      } catch {
        // best-effort: en fejlende alarm (Sentry nede, DNS-fejl) maa ALDRIG vaelte
        // sweepen — dagens traening er vigtigere end notifikationen om at den er sen.
      }
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
        // schema-columns-ok: `game_day`/`season_id` tilfoejes af database/
        // 2026-09-14-4846-training-tick-game-day.sql og `squad` af database/
        // 2026-09-15-4847-training-day-close-trigger.sql i denne PR. Snapshottet er
        // fra 10/9 og kender dem derfor ikke endnu (refresh kraever prod-adgang og
        // koeres post-merge af ejer/orkestrator).
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
          // best-effort PR. HOLD: ét holds fejl maa aldrig stoppe de oevrige 361
          // (samme per-team-isolation som trainingSweep.js). Fejlen sluges IKKE —
          // den taelles i `failed` og returneres i `failures`, og cron.js laver ÉN
          // aggregeret sentryCapture pr. tick af dem (#2389 A2-moenstret). En
          // capture pr. hold ville give 362 Sentry-issues af én systemisk aarsag.
          failed += 1;
          failures.push({ teamId: item.teamId, gameDay: item.gameDay, message: err.message });
          logger.error?.(`  ❌ Traenings-lukning fejlede for hold ${item.teamId} (loebsdag ${item.gameDay}):`, err.message);
        }
      }));
    }

    // Dags-claimen saettes KUN naar HELE planen gik igennem uden fejl.
    //
    // Hvorfor ikke ubetinget: en Phase 1-fejl i motoren SLETTER reservationen igen
    // (dailyTrainingEngine.js's catch), saa netop det (hold, loebsdag) ville staa
    // paa planen igen ved naeste tick — men en claim ville forhindre naeste tick i
    // overhovedet at kigge. Den gamle trainingSweep.js er ingen bagstopper: den
    // filtrerer paa (team_id, tick_date), saa en ANDEN vellykket loebsdag samme dato
    // faar den til at springe holdet over. Uden guarden her ville en forbigaaende
    // netvaerksfejl altsaa koste netop det hold netop den loebsdag, permanent.
    //
    // BEGRAENSNING (bevidst): en Phase 2-fejl BEVARER reservationen med vilje (en
    // blokeret dag er sikrere end et dobbelt-tick efter delvise evne-writes), og
    // buildSweepPlan laeser enhver eksisterende raekke som "koert". Retry-forsoeget
    // her hjaelper derfor kun Phase 1-fejl. AEgte pending/completed-semantik paa
    // training_day_runs er et selvstaendigt stykke arbejde — se PR-body.
    if (failed === 0) {
      lastCompletedDate = tickDate;
    }

    return {
      ran: true,
      tickDate,
      seasonId: season.id,
      gameDays: todaysGameDays,
      skippedGameDays,
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
