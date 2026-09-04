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

import { computeSeasonTransitionBoundary, SEASON_TRANSITION_PLANNED_AT_KEY } from "./seasonTransitionBoundary.js";

export const SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS = 7;
export const SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS = 12 * 60 * 60 * 1000;

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
    .select("number, start_date")
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
    return {
      checked: true, drift: true, reason: "diverges",
      seasonNumber: season.number, startDate: season.start_date,
      expected: expected?.toISOString() ?? null, existing: existingRaw, diffMs, daysUntilStart,
    };
  }

  return { checked: true, drift: false, reason: "ok", seasonNumber: season.number, daysUntilStart };
}
