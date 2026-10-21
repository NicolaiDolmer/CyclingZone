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
// mangler eller ikke passer til det skifte sæsonen er planlagt mod. Pure read
// — ingen DB-writes, ingen risiko for at forstyrre en kørende sæson.
//
// #7022: siden #5592 planlægges kalenderen mod det TIDLIGST MULIGE skifte (den
// afsluttende sæsons seneste etape + buffer), ikke mod konventionen "aftenen før
// start_date kl. 18". Nøglen ligger derfor legitimt dage før konventionen (S5: skiftet
// lørdag 25/10 kl. 20:30, start 28/10), og vagten alarmerede dagligt på en korrekt nøgle.
// Er den kommende sæsons kalender bygget, dømmes nøglen nu mod KALENDEREN:
//   - "too-early": nøglen ligger før den afsluttende sæsons seneste etape + buffer
//     (skiftet kan ikke ske så tidligt; sæsonafslutningen er spærret til sidste løb).
//   - "too-late":  under PLANNING_WINDOW_HOURS fra nøglen til den nye sæsons første
//     etape (managerne mister planlægningstiden, #5592).
// Uden etaper (kalenderen er ikke bygget, fx glemt --apply) gælder konventionen som før.

import { computeSeasonTransitionBoundary, SEASON_TRANSITION_PLANNED_AT_KEY } from "./seasonTransitionBoundary.js";
import { PLANNING_WINDOW_HOURS, SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES } from "./calendarPlanningWindow.js";

export const SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS = 7;
export const SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS = 12 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

// Første (ascending) eller seneste etape i en sæson, på tværs af alle divisioner.
async function fetchSeasonStageEdge(supabase, seasonId, { ascending }) {
  const { data, error } = await supabase
    .from("race_stage_schedule")
    .select("scheduled_at, races!inner(season_id)")
    .eq("races.season_id", seasonId)
    .order("scheduled_at", { ascending })
    .limit(1);
  if (error) throw new Error(`race_stage_schedule-opslag fejlede: ${error.message}`);
  const raw = data?.[0]?.scheduled_at ?? null;
  const at = raw ? new Date(raw) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/**
 * @param {{ supabase: object, now?: Date }} args
 * @returns {Promise<{
 *   checked: boolean, drift: boolean, reason: string,
 *   seasonNumber?: number, startDate?: string,
 *   expected?: string|null, existing?: string|null, diffMs?: number, daysUntilStart?: number,
 *   earliestAllowed?: string|null, latestAllowed?: string|null,
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

  // #7022: kalenderen er dommeren, når den findes.
  const firstStageAt = season.id ? await fetchSeasonStageEdge(supabase, season.id, { ascending: true }) : null;
  if (firstStageAt) {
    const { data: active, error: activeErr } = await supabase
      .from("seasons")
      .select("id")
      .eq("status", "active")
      .maybeSingle();
    if (activeErr) throw new Error(`seasons-opslag (active) fejlede: ${activeErr.message}`);
    const lastStageAt = active?.id ? await fetchSeasonStageEdge(supabase, active.id, { ascending: false }) : null;

    const earliestAllowed = lastStageAt
      ? new Date(lastStageAt.getTime() + SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES * 60_000)
      : null;
    const latestAllowed = new Date(firstStageAt.getTime() - PLANNING_WINDOW_HOURS * HOUR_MS);
    const base = {
      checked: true, seasonNumber: season.number, startDate: season.start_date,
      expected: expected?.toISOString() ?? null, existing: existingRaw, daysUntilStart,
      earliestAllowed: earliestAllowed?.toISOString() ?? null, latestAllowed: latestAllowed.toISOString(),
    };
    if (earliestAllowed && existing.getTime() < earliestAllowed.getTime()) return { ...base, drift: true, reason: "too-early" };
    if (existing.getTime() > latestAllowed.getTime()) return { ...base, drift: true, reason: "too-late" };
    return { checked: true, drift: false, reason: "ok-calendar", seasonNumber: season.number, daysUntilStart };
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
