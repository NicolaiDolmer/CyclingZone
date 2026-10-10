// backend/lib/selectionWarningSweep.js
// #2180 — "Mangler holdudtagelse"-varsel: en indbakke-notifikation til hold der
// STADIG ikke har en KOMPLET holdudtagelse for et løb der starter inden for 36
// timer, med et link til løbet.
//
// DEFINITION af "mangler udtagelse" (rettet #4038, se filhoved-historik nedenfor):
// truppen er FULD når `race_entries`-antallet (manuelle OG auto-udfyldte,
// samme optælling som løbssidens `getSelectionContext`/`isSquadSelectionMissing`,
// raceSelection.js) når `selectionSizeForRace(race).max`. Kun hold der stadig
// mangler entries op til target-størrelsen tæller som "mangler udtagelse".
//
// #4038-historik (20/8, spiller-rapport): før denne rettelse brugte sweepet
// "ingen MANUEL entry" (is_auto_filled=false findes ikke) som diskriminator —
// samme fejl-klasse som #3042 (Dashboard-nudgen), bare i notifikations-sweepet.
// Prod-verifikation (20/8, ghwvkxzhsbbltzfnuhhz): 26 selection_warning-notifs
// for Tour des Fjords (ProSeries, mål 6/6) — næsten alle med total_entries=6,
// manual_entries=0, dvs. FULDT auto-udfyldte trupper der stadig fik "mangler
// udtagelse"-beskeden. Det matcher spillerens rapport ordret. Beskeden selv
// tilbyder "let the assistant auto-select for you" — når assistenten (eller
// den hver-time-kørende raceEntryGeneratorSweep.js, auto_entry_generator_enabled
// ='on' i prod) allerede HAR fyldt truppen, er den ikke længere "mangler".
//
// Hold ekskluderes hvis de: er AI/bank/frosne/test-konti (humanTeamFilter),
// ikke har en bruger (user_id null — kan ikke notificeres), er UDENFOR løbets
// pulje (samme pulje-filter som resten af selection-motoren), eller har
// meldt sig AF løbet (race_withdrawals — en bevidst fravalg er ikke "mangler").
//
// Idempotens (#5979): det varige bevis er en kvittering i
// selection_warning_receipts pr. (user_id, race_id). Før byggede sweepet kun på
// notifyUser's 24t-dedup mod notifications-rækker — men indbakken sletter
// rækker fysisk, så en slettet besked kom tilbage ved næste tick, og 36t-vinduet
// er længere end 24t-dedup'en. Nu: ét batch-opslag af kvitteringer for løbene i
// vinduet; kendte (manager, løb) springes over; ellers claim-first (insert ON
// CONFLICT DO NOTHING) → notify → fjern kvitteringen igen hvis notify kaster
// eller intet sendte. Kvitteringer slettes ALDRIG når beskeden slettes.
// Antagelse (ejer-default, #5979): et NYT løb giver en ny påmindelse (ny
// race_id); en ændret udtagelse for SAMME løb gør ikke.
// Mangler tabellen (42P01/PGRST205 i auto-migrate-vinduet) eller fejler
// opslaget, falder sweepet tilbage til 24t-dedup'en uden at kaste.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { teamInRacePool } from "./raceBinding.js";
import { selectionSizeForRace, MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { defaultFetchActiveRiderCounts } from "./squadBelowMinimumCheck.js";
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
// har en trup der IKKE er fuld endnu? `entryCountByTeam` = Map<team_id, antal
// race_entries (manuelle+auto) for netop dette løb>. `targetSize` = antal
// ryttere en fuld trup skal have (selectionSizeForRace(race).max). `withdrawnTeamIds`
// = Set af team_id der har meldt sig af. Pure + deterministisk. Samme kontrakt
// som getSelectionContext/isSquadSelectionMissing (#4038 — se filhoved).
export function teamsMissingSelection({ eligibleTeams = [], entryCountByTeam = new Map(), targetSize = Infinity, withdrawnTeamIds = new Set() }) {
  return eligibleTeams.filter((t) => !withdrawnTeamIds.has(t.id) && (entryCountByTeam.get(t.id) || 0) < targetSize);
}

async function defaultFetchUpcomingScheduledRaces({ supabase }) {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) return { seasonId: null, races: [] };

  const races = await fetchAllRows(() =>
    supabase
      .from("races")
      .select("id, name, status, stages_completed, league_division_id, season_id, race_class")
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

// Antal race_entries (manuelle+auto-udfyldte) pr. (løb, hold) — "trup-fylde",
// samme optælling som getSelectionContext (#4038, se filhoved). Map<race_id,
// Map<team_id, count>>.
async function defaultFetchEntryCountsByRace({ supabase, raceIds }) {
  if (!raceIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase
      .from("race_entries").select("race_id, team_id")
      .in("race_id", chunk)
      .order("race_id")
      .order("team_id")
  );
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, new Map());
    const byTeam = byRace.get(row.race_id);
    byTeam.set(row.team_id, (byTeam.get(row.team_id) || 0) + 1);
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

// #6184 · Nøgle for "denne manager har allerede fået netop denne besked for
// netop dette løb" — samme felter som notifyUser's dedup-opslag
// (user_id, type, title, message, related_id), type er fast her.
export function selectionWarningDedupKey({ userId, relatedId, title, message }) {
  return `${userId}\u0000${relatedId}\u0000${title}\u0000${message}`;
}

// #6184 · Ét batch-opslag af de selection_warning-rækker der allerede findes
// inden for dedup-vinduet for de løb der er i vinduet. Før lavede sweepet ét
// notifications-GET (og ét teams-GET for ejeren) PR. (hold, løb) hvert 5. min,
// selv når alle var dedup'et — prod 5/10: ~150 GET'er pr. tick i ét sekund-
// vindue, også om natten. Returnerer Set<dedupKey>.
async function defaultFetchRecentSelectionWarnings({ supabase, raceIds, sinceIso }) {
  if (!raceIds.length) return new Set();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase
      .from("notifications")
      .select("id, user_id, related_id, title, message")
      .eq("type", SELECTION_WARNING_TYPE)
      .in("related_id", chunk)
      .gte("created_at", sinceIso)
      .order("id")
  );
  const keys = new Set();
  for (const row of rows) {
    keys.add(selectionWarningDedupKey({
      userId: row.user_id, relatedId: row.related_id, title: row.title, message: row.message,
    }));
  }
  return keys;
}

const SELECTION_WARNING_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // = notifyUser's RECENT_DUPLICATE_WINDOW_MS

// ─── #5979 · Varige kvitteringer ────────────────────────────────────────────
export const SELECTION_WARNING_RECEIPTS_TABLE = "selection_warning_receipts";

export function selectionWarningReceiptKey({ userId, raceId }) {
  return `${userId}\u0000${raceId}`;
}

// "Tabellen findes ikke endnu" (Postgres 42P01 / PostgREST PGRST205) — reelt i
// vinduet mellem deploy og auto-migrate (#2642). Samme test som
// discordWebhookOutbox.isMissingTableError.
export function isMissingReceiptsTableError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  return /selection_warning_receipts.* does not exist|could not find the table/i.test(String(error.message || ""));
}

// Ét batch-opslag: Set<receiptKey> for alle kvitteringer på løbene i vinduet.
async function defaultFetchKnownReceipts({ supabase, raceIds }) {
  if (!raceIds.length) return new Set();
  const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase
      .from(SELECTION_WARNING_RECEIPTS_TABLE)
      .select("user_id, race_id")
      .in("race_id", chunk)
      .order("race_id")
      .order("user_id")
  );
  const keys = new Set();
  for (const row of rows) keys.add(selectionWarningReceiptKey({ userId: row.user_id, raceId: row.race_id }));
  return keys;
}

// Claim-first: true = denne kørsel skrev kvitteringen (og må sende); false =
// den fandtes allerede (en samtidig sweep kom først). ON CONFLICT DO NOTHING.
async function defaultClaimReceipt({ supabase, userId, raceId, sentAtIso }) {
  const { data, error } = await supabase
    .from(SELECTION_WARNING_RECEIPTS_TABLE)
    .upsert({ user_id: userId, race_id: raceId, sent_at: sentAtIso }, { onConflict: "user_id,race_id", ignoreDuplicates: true })
    .select("user_id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

// Rul en claim tilbage (notify kastede/sendte intet). sent_at matcher kun
// denne kørsels egen claim, så en anden kørsels kvittering aldrig fjernes.
async function defaultReleaseReceipt({ supabase, userId, raceId, sentAtIso }) {
  const { error } = await supabase
    .from(SELECTION_WARNING_RECEIPTS_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("race_id", raceId)
    .eq("sent_at", sentAtIso);
  if (error) throw error;
}

export const defaultSelectionWarningReceipts = Object.freeze({
  fetchKnown: defaultFetchKnownReceipts,
  claim: defaultClaimReceipt,
  release: defaultReleaseReceipt,
});

// "claimed" | "exists" | "unavailable". En claim-fejl må aldrig koste
// manageren påmindelsen: "unavailable" = send som før #5979 (24t-dedup).
async function claimReceiptSafely(receipts, args, teamId, raceId) {
  try {
    return (await receipts.claim(args)) ? "claimed" : "exists";
  } catch (err) {
    if (isMissingReceiptsTableError(err)) {
      // best-effort: forventet i auto-migrate-vinduet (#2642), ingen Sentry.
      console.warn(`  ⚠️  selection-warning: receipts table missing at claim (team ${teamId}, race ${raceId})`);
    } else {
      console.error(`  ⚠️  selection-warning: receipt claim failed (team ${teamId}, race ${raceId}):`, err?.message || err);
      captureException(err, {
        tags: { flow: "notifications", stage: "selection-warning-receipt-claim" },
        extra: { teamId, raceId },
      });
    }
    return "unavailable";
  }
}

// Fejler tilbagerulningen, står kvitteringen tilbage: manageren får så ikke
// påmindelsen for dette løb (fail-quiet frem for spam) — derfor Sentry.
async function releaseReceiptSafely(receipts, args, teamId, raceId) {
  try {
    await receipts.release(args);
  } catch (err) {
    console.error(`  ❌ selection-warning: receipt release failed (team ${teamId}, race ${raceId}):`, err?.message || err);
    captureException(err, {
      tags: { flow: "notifications", stage: "selection-warning-receipt-release" },
      extra: { teamId, raceId },
    });
  }
}

/**
 * #2180 · Kør 36t-varsel-sweepet for den aktive sæson. Additiv + read-mostly:
 * eneste writes er notifications-rækkerne (via notify, dedup'et 24t) og
 * kvitteringerne i selection_warning_receipts (#5979, se filhoved).
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
 * @param {Function} [args.fetchEntryCountsByRace]
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
  fetchEntryCountsByRace = defaultFetchEntryCountsByRace,
  fetchWithdrawnTeamIdsByRace = defaultFetchWithdrawnTeamIdsByRace,
  suppressLowRoster = false,
  fetchSeniorCounts = defaultFetchActiveRiderCounts,
  // #6184 · Forhånds-dedup. Kun aktiv som default når den rigtige notify
  // bruges (dens dedup er det batch-opslaget spejler); en injiceret notify i
  // tests ejer selv sin dedup. null = slået fra (alle kandidater går til notify).
  fetchRecentWarnings = notify === defaultNotifyTeamOwner ? defaultFetchRecentSelectionWarnings : null,
  // #5979 · Varige kvitteringer ({ fetchKnown, claim, release }). Samme
  // default-regel som fetchRecentWarnings: kun aktiv med den rigtige notify;
  // tests injicerer en store. null = slået fra (adfærden før #5979).
  receipts = notify === defaultNotifyTeamOwner ? defaultSelectionWarningReceipts : null,
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
  const [humanTeams, entryCountsByRace, withdrawnByRace] = await Promise.all([
    fetchHumanTeams({ supabase }),
    fetchEntryCountsByRace({ supabase, raceIds: dueRaceIds }),
    fetchWithdrawnTeamIdsByRace({ supabase, raceIds: dueRaceIds }),
  ]);
  // #5867: the selection message offers assistant help with entries, which
  // cannot create riders for a club below the participation floor. The new
  // roster reminder owns that case; retain old behavior for direct callers.
  const seniorCounts = suppressLowRoster
    ? await fetchSeniorCounts({ supabase, teamIds: humanTeams.map((t) => t.id) })
    : null;
  let recentWarningKeys = null;
  if (fetchRecentWarnings) {
    try {
      recentWarningKeys = await fetchRecentWarnings({
        supabase,
        raceIds: dueRaceIds,
        sinceIso: new Date(now.getTime() - SELECTION_WARNING_DEDUP_WINDOW_MS).toISOString(),
      });
    } catch (err) {
      // Forhånds-dedup er kun en optimering: fejler den, går alle kandidater
      // til notify, som selv dedup'er pr. række (adfærden før #6184).
      console.error("  ⚠️  selection-warning: batch dedup prefetch failed, falling back to per-team dedup:", err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "selection-warning-prefetch" } });
      recentWarningKeys = null;
    }
  }
  // #5979 · null = kvitteringer ikke tilgængelige i denne kørsel → 24t-dedup'en
  // (notifyUser + forhånds-opslaget ovenfor) er eneste værn, som før.
  let receiptKeys = null;
  if (receipts) {
    try {
      receiptKeys = await receipts.fetchKnown({ supabase, raceIds: dueRaceIds });
    } catch (err) {
      receiptKeys = null;
      if (isMissingReceiptsTableError(err)) {
        // best-effort: forventet i auto-migrate-vinduet (#2642); én log-linje, ingen Sentry.
        console.warn("  ⚠️  selection-warning: receipts table missing, falling back to 24h dedup");
      } else {
        console.error("  ⚠️  selection-warning: receipts prefetch failed, falling back to 24h dedup:", err?.message || err);
        captureException(err, { tags: { flow: "notifications", stage: "selection-warning-receipts" } });
      }
    }
  }
  const sentAtIso = now.toISOString();

  for (const race of dueRaces) {
    const eligibleTeams = humanTeams.filter((t) =>
      teamInRacePool({ teamDivisionId: t.league_division_id, racePoolId: race.league_division_id ?? null })
      && (!seniorCounts || (seniorCounts.get(t.id) || 0) >= MIN_RACE_ENTRIES)
    );
    stats.teamsChecked += eligibleTeams.length;
    const missing = teamsMissingSelection({
      eligibleTeams,
      entryCountByTeam: entryCountsByRace.get(race.id) || new Map(),
      targetSize: selectionSizeForRace(race).max,
      withdrawnTeamIds: withdrawnByRace.get(race.id) || new Set(),
    });
    if (!missing.length) continue;

    const payload = buildSelectionWarningNotification({ raceId: race.id, raceName: race.name });
    for (const team of missing) {
      // #5979 · Kvitteringer gælder kun når ejeren er kendt (nøglen er user_id).
      const useReceipt = Boolean(receiptKeys && team.user_id);
      const receiptArgs = { supabase, userId: team.user_id, raceId: race.id, sentAtIso };
      // #5979 · Allerede sendt til denne manager for dette løb → aldrig igen,
      // heller ikke efter at beskeden er slettet.
      if (useReceipt && receiptKeys.has(selectionWarningReceiptKey({ userId: team.user_id, raceId: race.id }))) {
        stats.deduped += 1;
        continue;
      }
      // #6184 · Allerede varslet inden for vinduet → ingen kald overhovedet.
      // Ukendt ejer (user_id mangler i team-rækken) går stadig gennem notify.
      if (recentWarningKeys && team.user_id && recentWarningKeys.has(selectionWarningDedupKey({
        userId: team.user_id, relatedId: payload.relatedId, title: payload.title, message: payload.message,
      }))) {
        stats.deduped += 1;
        // #5979 · Beskeden findes (fx sendt før kvitteringerne fandtes) → skriv
        // kvitteringen alligevel, så en senere sletning ikke giver gensending.
        if (useReceipt) await claimReceiptSafely(receipts, receiptArgs, team.id, race.id);
        continue;
      }
      let claimed = false;
      if (useReceipt) {
        const claim = await claimReceiptSafely(receipts, receiptArgs, team.id, race.id);
        if (claim === "exists") {
          // En samtidig sweep (eller en kvittering skrevet efter opslaget) kom først.
          stats.deduped += 1;
          continue;
        }
        claimed = claim === "claimed";
      }
      try {
        const res = await notify({ supabase, teamId: team.id, now, ...payload });
        if (res?.delivered) stats.warned += 1;
        else if (res?.deduped) stats.deduped += 1; // beskeden findes allerede → kvitteringen bliver
        else if (claimed) await releaseReceiptSafely(receipts, receiptArgs, team.id, race.id); // intet sendt
      } catch (err) {
        if (claimed) await releaseReceiptSafely(receipts, receiptArgs, team.id, race.id);
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
