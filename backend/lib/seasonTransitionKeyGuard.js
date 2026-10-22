// #4129 — forward-guard for season_transition_planned_at.
//
// buildSeasonCalendar.js --apply sætter nu nøglen selv (ensureSeasonTransitionPlannedAt
// i seasonTransitionBoundary.js) når en kommende sæsons kalender oprettes/apply'es.
// Dette er et READ-ONLY sikkerhedsnet for de veje der springer det uden om: en
// manuel SQL-oprettet sæson, en glemt --apply, eller en fremtidig kode-sti der
// indsætter i `seasons` uden at gå via scriptet. Rod-årsagen (#4129) var netop at
// nøglen KUN blev sat manuelt, én gang, på selve cutover-aftenen 23/8 — denne
// vagt sikrer at et tilsvarende hul opdages FØR næste cutover, ikke midt i den.
//
// Alarmerer hvis en 'upcoming' sæson er < 7 dage fra sin start_date, OG nøglen
// enten mangler eller afviger > 12 timer fra den beregnede fallback (samme
// beregning som guarden selv bruger, computeSeasonTransitionBoundary). Pure read
// — ingen DB-writes, ingen risiko for at forstyrre en kørende sæson.
//
// #7022 punkt 2: en nøgle der afviger fra konventionen er IKKE drift, hvis den er
// bevidst planlagt tidligere: sæsonens første etape ligger mindst 24 t efter nøglen
// (planlægningsankeret) og nøglen ligger før første etape. En nøgle efter første etape
// eller under 24 t før den alarmerer stadig.

import { computeSeasonTransitionBoundary, SEASON_TRANSITION_PLANNED_AT_KEY } from "./seasonTransitionBoundary.js";

export const SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS = 7;
export const SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS = 12 * 60 * 60 * 1000;
export const SEASON_TRANSITION_KEY_PLANNED_MIN_LEAD_MS = 24 * 60 * 60 * 1000;

// Slutningen af forrige sæsons sidste dag (end_date + 1 dag, 00:00Z), eller null.
// En planlagt nøgle skal ligge EFTER dette, ellers er den en efterladenskab (codex P2).
async function fetchPreviousSeasonEndedAt(supabase, seasonId) {
  const { data, error } = await supabase
    .from("seasons")
    .select("end_date")
    .neq("id", seasonId)
    .not("end_date", "is", null)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`previous-season lookup failed: ${error.message}`);
  if (!data?.end_date) return null;
  const end = new Date(`${String(data.end_date).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(end.getTime()) ? null : new Date(end.getTime() + 24 * 60 * 60 * 1000);
}

// Tidligste etape-tidspunkt for sæsonen (race_stage_schedule), eller null.
async function fetchFirstStageAt(supabase, seasonId) {
  if (seasonId == null) return null;
  const { data: races, error: racesErr } = await supabase.from("races").select("id").eq("season_id", seasonId);
  if (racesErr) throw new Error(`races-opslag fejlede: ${racesErr.message}`);
  const raceIds = (races ?? []).map((r) => r.id);
  if (raceIds.length === 0) return null;
  const { data: stage, error: stageErr } = await supabase
    .from("race_stage_schedule")
    .select("scheduled_at")
    .in("race_id", raceIds)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (stageErr) throw new Error(`race_stage_schedule-opslag fejlede: ${stageErr.message}`);
  const at = stage?.scheduled_at ? new Date(stage.scheduled_at) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/**
 * @param {{ supabase: object, now?: Date }} args
 * @returns {Promise<{
 *   checked: boolean, drift: boolean, reason: string,
 *   seasonNumber?: number, startDate?: string,
 *   expected?: string|null, existing?: string|null, diffMs?: number, daysUntilStart?: number,
 * }>}
 */
export async function checkSeasonTransitionKeyDrift({ supabase, now = new Date() } = {}) {
  if (!supabase?.from) return { checked: false, drift: false, reason: "no-supabase" };

  const { data: season, error: seasonErr } = await supabase
    .from("seasons")
    .select("id, number, start_date")
    .eq("status", "upcoming")
    .maybeSingle();
  if (seasonErr) throw new Error(`seasons-opslag fejlede: ${seasonErr.message}`);
  if (!season?.start_date) return { checked: true, drift: false, reason: "no-upcoming-season" };

  const startDate = new Date(`${String(season.start_date).slice(0, 10)}T00:00:00Z`);
  const daysUntilStart = (startDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysUntilStart >= SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS) {
    return { checked: true, drift: false, reason: "outside-window", daysUntilStart, seasonNumber: season.number };
  }

  const { data: cfg, error: cfgErr } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", SEASON_TRANSITION_PLANNED_AT_KEY)
    .maybeSingle();
  if (cfgErr) throw new Error(`app_config-opslag fejlede: ${cfgErr.message}`);

  const expected = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: season.start_date });
  const existingRaw = cfg?.value ?? null;
  const existing = existingRaw ? new Date(existingRaw) : null;
  const existingValid = existing && !Number.isNaN(existing.getTime());

  if (!existingValid) {
    return {
      checked: true, drift: true, reason: "missing",
      seasonNumber: season.number, startDate: season.start_date,
      expected: expected?.toISOString() ?? null, existing: existingRaw, daysUntilStart,
    };
  }

  const diffMs = Math.abs(existing.getTime() - (expected?.getTime() ?? existing.getTime()));
  if (diffMs > SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS) {
    const firstStageAt = await fetchFirstStageAt(supabase, season.id);
    if (
      firstStageAt
      && existing.getTime() < firstStageAt.getTime()
      && firstStageAt.getTime() - existing.getTime() >= SEASON_TRANSITION_KEY_PLANNED_MIN_LEAD_MS
    ) {
      const prevEndedAt = await fetchPreviousSeasonEndedAt(supabase, season.id);
      if (prevEndedAt && existing.getTime() < prevEndedAt.getTime()) {
        return {
          checked: true, drift: true, reason: "diverges",
          seasonNumber: season.number, startDate: season.start_date,
          expected: expected?.toISOString() ?? null, existing: existingRaw, diffMs, daysUntilStart,
        };
      }
      return {
        checked: true, drift: false, reason: "planned-earlier",
        seasonNumber: season.number, existing: existingRaw, diffMs, daysUntilStart,
        firstStageAt: firstStageAt.toISOString(),
      };
    }
    return {
      checked: true, drift: true, reason: "diverges",
      seasonNumber: season.number, startDate: season.start_date,
      expected: expected?.toISOString() ?? null, existing: existingRaw, diffMs, daysUntilStart,
    };
  }

  return { checked: true, drift: false, reason: "ok", seasonNumber: season.number, daysUntilStart };
}
