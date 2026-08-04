// backend/lib/selectionWarningSweep.js
// #2180 — "Mangler holdudtagelse"-varsel: en indbakke-notifikation til hold der
// STADIG ikke har en MANUEL holdudtagelse for et løb der starter inden for 36
// timer, med et link til løbet.
//
// DEFINITION af "mangler udtagelse" (vigtig, empirisk grundlag 4/8): den
// hver-time-kørende entry-generator (raceEntryGeneratorSweep.js,
// auto_entry_generator_enabled='on' i prod) fylder proaktivt ALLE holds
// manglende entries med is_auto_filled=true LÆNGE før 36t-mærket — en
// prod-stikprøve (races der starter inden for 36t, 4/8) viste rigtige
// menneske-hold med 0 manuelle ryttere men 6 auto-udfyldte. "Mangler
// udtagelse" kan derfor IKKE betyde "0 race_entries-rækker" (det ville
// stort set aldrig ramme) — det betyder "ingen MANUEL entry" (is_auto_filled
// = false findes ikke for holdet på dette løb), samme diskriminator som
// regenerate-endpointets `manualRaceIds` (routes/api.js, mode=missing).
//
// Hold ekskluderes hvis de: er AI/bank/frosne/test-konti (humanTeamFilter),
// ikke har en bruger (user_id null — kan ikke notificeres), er UDENFOR løbets
// pulje (samme pulje-filter som resten af selection-motoren), eller har
// meldt sig AF løbet (race_withdrawals — en bevidst fravalg er ikke "mangler").
//
// Idempotens: notifyUser dedup'er på (type, title, message, related_id)
// inden for 24t (samme mønster som contractExpiring/raceResult). Beskeden er
// STATISK pr. løb (intet live-nedtællings-tal), så gentagne sweep-ticks inden
// for det 36t-vindue kun sender ÉN reel notifikation pr. (hold, løb).

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { teamInRacePool } from "./raceBinding.js";
import { notifyTeamOwner as defaultNotifyTeamOwner } from "./notificationService.js";
import { captureException } from "./sentry.js";

export const SELECTION_WARNING_TYPE = "selection_warning";
export const SELECTION_WARNING_HOURS = 36;

/**
 * #2180 · Byg payloaden for "din trup mangler stadig udtagelse"-notifikationen.
 * EN-first fallback (#1068); locale-aware rendering via metadata-koderne (#666).
 * related_id = race.id (dedup-nøglen, se filhoved).
 */
export function buildSelectionWarningNotification({ raceId, raceName }) {
  const name = raceName || "Your race";
  return {
    type: SELECTION_WARNING_TYPE,
    title: "Squad selection needed",
    message: `${name} starts within 36 hours and you haven't picked your squad yet. Select your riders, or let the assistant auto-select for you.`,
    relatedId: raceId ?? null,
    metadata: {
      raceId: raceId ?? null,
      titleCode: "notif.selectionWarning.title",
      titleParams: {},
      messageCode: "notif.selectionWarning.message",
      messageParams: { race: name },
    },
  };
}

// Ren tidsvindue-logik: hvilke løb (status='scheduled', ikke gået i gang) har
// deres TIDLIGSTE etape-tidspunkt inden for [now, now+windowHours]? scheduleByRace
// = Map<race_id, Array<{scheduled_at}>> (race_stage_schedule-rækker). Løb uden
// (fundet) schedule kan ikke vurderes og springes over. Pure + deterministisk.
export function racesNeedingSelectionWarning({
  races = [],
  scheduleByRace,
  now = new Date(),
  windowHours = SELECTION_WARNING_HOURS,
}) {
  const nowMs = now.getTime();
  const windowMs = windowHours * 3600 * 1000;
  const due = [];
  for (const race of races) {
    if (race?.status !== "scheduled") continue; // afsluttet/uden for selection-vinduet
    if ((race?.stages_completed ?? 0) > 0) continue; // allerede i gang ("live") — låst felt
    const sched = scheduleByRace?.get?.(race.id);
    if (!sched?.length) continue;
    const times = sched.map((s) => Date.parse(s.scheduled_at)).filter((t) => Number.isFinite(t));
    if (!times.length) continue;
    const startMs = Math.min(...times);
    if (startMs <= nowMs) continue; // allerede startet (defensivt — status burde have fanget det)
    if (startMs - nowMs > windowMs) continue; // mere end vinduet væk endnu
    due.push({ ...race, startMs });
  }
  return due;
}

// Blandt `eligibleTeams` (allerede pulje-/menneske-filtreret for løbet), hvilke
// mangler en MANUEL entry? `enteredTeamIds` = Set af team_id med is_auto_filled=false
// for netop dette løb. `withdrawnTeamIds` = Set af team_id der har meldt sig af.
// Pure + deterministisk.
export function teamsMissingSelection({ eligibleTeams = [], enteredTeamIds = new Set(), withdrawnTeamIds = new Set() }) {
  return eligibleTeams.filter((t) => !enteredTeamIds.has(t.id) && !withdrawnTeamIds.has(t.id));
}

async function defaultFetchUpcomingScheduledRaces({ supabase }) {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) return { seasonId: null, races: [] };

  const races = await fetchAllRows(() =>
    supabase
      .from("races")
      .select("id, name, status, stages_completed, league_division_id, season_id")
      .eq("season_id", season.id)
      .eq("status", "scheduled")
      .order("id")
  );
  return { seasonId: season.id, races };
}

async function defaultFetchScheduleByRace({ supabase, raceIds }) {
  if (!raceIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase
      .from("race_stage_schedule").select("race_id, scheduled_at")
      .in("race_id", chunk)
      .order("race_id")
      .order("stage_number")
  );
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(row);
  }
  return byRace;
}

async function defaultFetchHumanTeams({ supabase }) {
  return fetchAllRows(() =>
    applyHumanTeamFilter(supabase.from("teams").select("id, name, user_id, league_division_id"))
      .not("user_id", "is", null)
      .order("id")
  );
}

// team_id-sæt MED mindst én MANUEL entry, pr. løb ("mangler udtagelse" — se filhoved).
async function defaultFetchManualEntryTeamIdsByRace({ supabase, raceIds }) {
  if (!raceIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase
      .from("race_entries").select("race_id, team_id")
      .in("race_id", chunk)
      .eq("is_auto_filled", false)
      .order("race_id")
      .order("team_id")
  );
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, new Set());
    byRace.get(row.race_id).add(row.team_id);
  }
  return byRace;
}

async function defaultFetchWithdrawnTeamIdsByRace({ supabase, raceIds }) {
  if (!raceIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase
      .from("race_withdrawals").select("race_id, team_id")
      .in("race_id", chunk)
      .order("race_id")
      .order("team_id")
  );
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, new Set());
    byRace.get(row.race_id).add(row.team_id);
  }
  return byRace;
}

/**
 * #2180 · Kør 36t-varsel-sweepet for den aktive sæson. Additiv + read-mostly:
 * eneste writes er notifications-rækkerne (via notify, dedup'et 24t).
 *
 * Fejl pr. notifikation isoleres (tælles, stopper ikke resten) — samme A2-lære
 * som resten af notificationService.js/squadBelowMinimumCheck.js.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {Date} [args.now]
 * @param {number} [args.windowHours]
 * @param {typeof defaultNotifyTeamOwner} [args.notify]
 * @param {Function} [args.fetchUpcomingScheduledRaces]
 * @param {Function} [args.fetchScheduleByRace]
 * @param {Function} [args.fetchHumanTeams]
 * @param {Function} [args.fetchManualEntryTeamIdsByRace]
 * @param {Function} [args.fetchWithdrawnTeamIdsByRace]
 * @returns {Promise<{racesChecked:number, racesDue:number, teamsChecked:number, warned:number, deduped:number, failed:number}>}
 */
export async function runSelectionWarningSweep({
  supabase,
  now = new Date(),
  windowHours = SELECTION_WARNING_HOURS,
  notify = defaultNotifyTeamOwner,
  fetchUpcomingScheduledRaces = defaultFetchUpcomingScheduledRaces,
  fetchScheduleByRace = defaultFetchScheduleByRace,
  fetchHumanTeams = defaultFetchHumanTeams,
  fetchManualEntryTeamIdsByRace = defaultFetchManualEntryTeamIdsByRace,
  fetchWithdrawnTeamIdsByRace = defaultFetchWithdrawnTeamIdsByRace,
}) {
  const stats = { racesChecked: 0, racesDue: 0, teamsChecked: 0, warned: 0, deduped: 0, failed: 0 };
  if (!supabase?.from) throw new Error("Supabase client required");

  const { races } = await fetchUpcomingScheduledRaces({ supabase });
  stats.racesChecked = races.length;
  if (!races.length) return stats;

  const scheduleByRace = await fetchScheduleByRace({ supabase, raceIds: races.map((r) => r.id) });
  const dueRaces = racesNeedingSelectionWarning({ races, scheduleByRace, now, windowHours });
  stats.racesDue = dueRaces.length;
  if (!dueRaces.length) return stats;

  const dueRaceIds = dueRaces.map((r) => r.id);
  const [humanTeams, manualByRace, withdrawnByRace] = await Promise.all([
    fetchHumanTeams({ supabase }),
    fetchManualEntryTeamIdsByRace({ supabase, raceIds: dueRaceIds }),
    fetchWithdrawnTeamIdsByRace({ supabase, raceIds: dueRaceIds }),
  ]);

  for (const race of dueRaces) {
    const eligibleTeams = humanTeams.filter((t) =>
      teamInRacePool({ teamDivisionId: t.league_division_id, racePoolId: race.league_division_id ?? null })
    );
    stats.teamsChecked += eligibleTeams.length;
    const missing = teamsMissingSelection({
      eligibleTeams,
      enteredTeamIds: manualByRace.get(race.id) || new Set(),
      withdrawnTeamIds: withdrawnByRace.get(race.id) || new Set(),
    });
    if (!missing.length) continue;

    const payload = buildSelectionWarningNotification({ raceId: race.id, raceName: race.name });
    for (const team of missing) {
      try {
        const res = await notify({ supabase, teamId: team.id, now, ...payload });
        if (res?.delivered) stats.warned += 1;
        else if (res?.deduped) stats.deduped += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`  ❌ selection-warning notification failed (team ${team.id}, race ${race.id}):`, err?.message || err);
        captureException(err, {
          tags: { flow: "notifications", stage: "selection-warning" },
          extra: { teamId: team.id, raceId: race.id },
        });
      }
    }
  }

  return stats;
}
