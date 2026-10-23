// backend/lib/raceStartLock.js
// #6959: EN delt laaseregel for taktik OG trup.
//
// Foer lod taktikken (raceTeamOrdersApi.isStageLocked) en etape laase naar dens
// planlagte start var passeret, mens truppen (raceActiveGuard.isRaceLineupFrozen,
// raceSelection) foerst frøs naar en etape faktisk var KOERT (stages_completed>0).
// Under en motor-pause var starttiden passeret uden at etapen var koert: taktikken
// var laast, truppen aaben, og en manager kunne saette en rytter ind som han ikke
// kunne give taktik.
//
// Reglen nu:
//   - Et tidspunkt er "passeret" naar scheduled_at <= nu (hasScheduledStartPassed).
//   - Etape N's TAKTIK er laast naar etapen er koert eller dens start er passeret.
//   - LOEBETS TRUP er laast naar loebet er afsluttet, en etape er koert, eller
//     ETAPE 1's start er passeret. Det er praecis taktik-reglen for etape 1, saa de
//     to laaser falder sammen i samme oejeblik, pause eller ej.
//   - Mangler scheduled_at (schedule-hul) er den AABEN indtil stages_completed siger
//     andet: en manglende raekke maa aldrig fastlaase et helt loeb.
//   - Flyttes scheduled_at (planlagt pause), aabner begge dele igen.
//
// Ren logik (ingen sentry/DB-import) saa den kan bruges fra raceTeamOrdersApi.js,
// raceSelection.js og kalender-/board-stierne. Loaderen tager supabase som argument.
// Frontend spejler reglen i frontend/src/lib/racePageTabs.js (kan ikke importere backend).

import { fetchAllRowsChunkedIn } from "./supabasePagination.js";

// AGENTS hard rule 16: laasebeslutninger laeser aldrig vaeguret selv. Kalderen (ruten,
// request-graensen) injicerer `now`; mangler det, er det en programfejl, ikke "aaben".
/**
 * @param {unknown} now
 * @returns {asserts now is Date}
 */
function assertNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("raceStartLock: now (Date) skal injiceres");
  }
}

/**
 * Er et planlagt tidspunkt passeret? Ugyldigt/manglende tidspunkt => false (aaben).
 * @param {string|null|undefined} scheduledAt ISO-tidspunkt
 * @param {Date} now injiceret ur (hard rule 16)
 */
export function hasScheduledStartPassed(scheduledAt, now) {
  assertNow(now);
  if (!scheduledAt) return false;
  const startMs = Date.parse(scheduledAt);
  return Number.isFinite(startMs) && now.getTime() >= startMs;
}

/**
 * T2: er en ETAPE laast for taktik-writes? Ren. Se filhovedet.
 *
 * @param {{stageNumber: number, stagesCompleted: number, scheduledAt: string|null|undefined, now: Date}} args
 */
export function isStageLocked({ stageNumber, stagesCompleted = 0, scheduledAt, now }) {
  if (stageNumber <= stagesCompleted) return true;
  return hasScheduledStartPassed(scheduledAt, now);
}

/**
 * Er LOEBETS trup laast? Ren. Samme regel som taktikken for etape 1.
 *
 * @param {{status?: string|null, stagesCompleted?: number|null, firstStageScheduledAt?: string|null, now: Date}} args
 */
export function isRaceLineupLocked({ status = null, stagesCompleted = 0, firstStageScheduledAt = null, now }) {
  if (status === "completed") return true;
  return isStageLocked({ stageNumber: 1, stagesCompleted: Number(stagesCompleted) || 0, scheduledAt: firstStageScheduledAt, now });
}

/**
 * Etape 1's planlagte start pr. loeb. Kun loeb der ikke allerede er laast af
 * status/stages_completed slaas op (resten er afgjort uden schedule).
 *
 * @param {{supabase: any, races: Array<{id: string, status?: string|null, stages_completed?: number|null}>}} args
 * @returns {Promise<Map<string, string|null>>} raceId -> scheduled_at (kun loeb med en raekke)
 */
export async function loadFirstStageStarts({ supabase, races = [] }) {
  const ids = races
    .filter((r) => r && r.id && r.status !== "completed" && (r.stages_completed ?? 0) === 0)
    .map((r) => r.id);
  const out = new Map();
  if (!ids.length) return out;
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) => supabase
    .from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at")
    .eq("stage_number", 1)
    .in("race_id", chunk)
    .order("race_id"));
  for (const row of rows) out.set(row.race_id, row.scheduled_at ?? null);
  return out;
}

/**
 * Etape 1's start pr. loeb ud fra schedule-raekker en kalder allerede har indlaest
 * (board, regenerer, kalender), saa de ikke koster en ekstra query. Ren.
 *
 * @param {Array<{race_id: string, stage_number: number, scheduled_at?: string|null}>} scheduleRows
 * @returns {Map<string, string|null>}
 */
export function firstStageStartsFromSchedule(scheduleRows = []) {
  const out = new Map();
  for (const row of scheduleRows || []) {
    if (row && row.stage_number === 1) out.set(row.race_id, row.scheduled_at ?? null);
  }
  return out;
}

/**
 * Staempler `lineup_locked` paa hvert loeb (ny array, raekkerne kopieres). Ren naar
 * `starts` er givet; ellers slaas etape 1's start op med een schedule-query for hele
 * saettet. Bruges af board-/kalender-/regenerer-/ryd-stierne saa de ikke hver
 * genopfinder reglen.
 *
 * @param {{supabase?: any, races: Array<{id: string, status?: string|null, stages_completed?: number|null}>, starts?: Map<string, string|null>|null, now: Date}} args
 */
export async function withLineupLocked({ supabase, races = [], starts = null, now }) {
  assertNow(now);
  starts = starts ?? await loadFirstStageStarts({ supabase, races });
  return races.map((race) => ({
    ...race,
    lineup_locked: isRaceLineupLocked({
      status: race.status,
      stagesCompleted: race.stages_completed,
      firstStageScheduledAt: starts.get(race.id) ?? null,
      now,
    }),
  }));
}

/**
 * Friske laase for en liste loeb, laest LIGE NU fra DB (status, stages_completed og
 * etape 1's start). Til skrive-graensen (regenerer) og konflikt-klassifikationen
 * (auto-frigivelse), hvor et tidligere snapshot kan vaere foraeldet.
 *
 * @param {{supabase: any, raceIds: string[], now: Date}} args
 * @returns {Promise<Set<string>>} id'er paa laaste loeb
 */
export async function loadLockedRaceIds({ supabase, raceIds = [], now }) {
  assertNow(now);
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const locked = new Set();
  if (!ids.length) return locked;
  const races = await fetchAllRowsChunkedIn(ids, (chunk) => supabase
    .from("races")
    .select("id, status, stages_completed")
    .in("id", chunk)
    .order("id"));
  const starts = await loadFirstStageStarts({ supabase, races });
  for (const race of races) {
    if (isRaceLineupLocked({
      status: race.status,
      stagesCompleted: race.stages_completed,
      firstStageScheduledAt: starts.get(race.id) ?? null,
      now,
    })) locked.add(race.id);
  }
  return locked;
}

/**
 * Enkelt-loeb-variant til skrive-stierne (PUT /selection, auto, afmeld).
 * @param {{supabase: any, race: {id: string, status?: string|null, stages_completed?: number|null}, now: Date}} args
 * @returns {Promise<boolean>}
 */
export async function isRaceLineupLockedNow({ supabase, race, now }) {
  assertNow(now);
  if (!race) return false;
  if (race.status === "completed" || (race.stages_completed ?? 0) > 0) return true;
  const starts = await loadFirstStageStarts({ supabase, races: [race] });
  return isRaceLineupLocked({
    status: race.status,
    stagesCompleted: race.stages_completed,
    firstStageScheduledAt: starts.get(race.id) ?? null,
    now,
  });
}
