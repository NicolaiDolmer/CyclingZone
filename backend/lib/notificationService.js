import { isKnownNotificationType } from "./notificationTypes.js";
import { captureException } from "./sentry.js";
import { SUPABASE_IN_CHUNK_SIZE, fetchAllRows } from "./supabasePagination.js";

const RECENT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function buildRecentDuplicateLookup({
  supabase,
  userId,
  type,
  title,
  message,
  relatedId,
  sinceIso,
}) {
  let query = supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq("title", title)
    .eq("message", message)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  query = relatedId ? query.eq("related_id", relatedId) : query.is("related_id", null);

  return query.limit(1);
}

/**
 * Deliver a notification. Caller can pass either:
 *   - title + message (legacy, formatted strings — sufficient on its own)
 *   - title + message + metadata.{titleCode, titleParams, messageCode, messageParams}
 *     for #666 locale-aware rendering (frontend prefers metadata via i18next).
 *
 * Dedup uses (type, title, message, related_id) — backend should keep title/message
 * informative enough (typically an EN fallback) that distinct events produce
 * distinct rows.
 */
export async function notifyUser({
  supabase,
  userId,
  type,
  title,
  message,
  relatedId = null,
  metadata = null,
  dedupeWindowMs = RECENT_DUPLICATE_WINDOW_MS,
  now = new Date(),
}) {
  if (!userId) {
    return { delivered: false, deduped: false, reason: "missing_user" };
  }

  // #3016: en type uden for notifications_type_check afvises tavst af Postgres
  // (per-item try/catch hos kalderne). Gør det højlydt ved kilden — insert
  // forsøges stadig, så adfærden er uændret hvis constrainten er nyere end listen.
  if (!isKnownNotificationType(type)) {
    captureException(new Error(
      `Ukendt notifikationstype "${type}" — mangler i NOTIFICATION_TYPES/notifications_type_check (#3016)`,
    ));
  }

  const sinceIso = new Date(now.getTime() - dedupeWindowMs).toISOString();
  const { data: existing, error: lookupError } = await buildRecentDuplicateLookup({
    supabase,
    userId,
    type,
    title,
    message,
    relatedId,
    sinceIso,
  });

  if (lookupError) {
    throw lookupError;
  }

  if (existing?.length) {
    return { delivered: false, deduped: true, reason: "recent_duplicate" };
  }

  const insertRow = {
    user_id: userId,
    type,
    title,
    message,
    related_id: relatedId,
  };
  if (metadata && typeof metadata === "object") {
    insertRow.metadata = metadata;
  }

  const { error } = await supabase.from("notifications").insert(insertRow);

  if (error) {
    throw error;
  }

  return { delivered: true, deduped: false };
}

export async function notifyTeamOwner({
  supabase,
  teamId,
  type,
  title,
  message,
  relatedId = null,
  metadata = null,
  dedupeWindowMs = RECENT_DUPLICATE_WINDOW_MS,
  now = new Date(),
}) {
  if (!teamId) {
    return { delivered: false, deduped: false, reason: "missing_team" };
  }

  const { data: team, error } = await supabase
    .from("teams")
    .select("user_id")
    .eq("id", teamId)
    .single();

  if (error) {
    throw error;
  }

  return notifyUser({
    supabase,
    userId: team?.user_id ?? null,
    type,
    title,
    message,
    relatedId,
    metadata,
    dedupeWindowMs,
    now,
  });
}

// ─── #1836 · Kontraktudløb-notifikation ───────────────────────────────────────

export const CONTRACT_EXPIRING_TYPE = "contract_expiring";

/**
 * #1836 · Byg payloaden for en "kontrakt udløber"-notifikation (tone:danger i UI).
 * Én kilde til ordlyd + metadata-koder + dedup-nøgle, så de tre triggere
 * (sæsonskift, auktion-køb, transfer-køb) producerer identiske rækker.
 *
 * Idempotens: related_id = riderId, og sæson-nummeret indgår i fallback-message
 * (#666-dedup matcher på type+title+message+related_id), så samme rytter i samme
 * sæson dedup'es, men en ny sæson giver en ny række.
 *
 * EN-first fallback (#1068: ingen rå dansk i backend). Locale-aware rendering
 * sker via backendMessages-koderne i metadata (#666).
 */
export function buildContractExpiringNotification({ riderName, riderId, seasonNumber }) {
  return {
    type: CONTRACT_EXPIRING_TYPE,
    title: "Contract expiring",
    message: `${riderName}'s contract expires at the end of season ${seasonNumber}.`,
    relatedId: riderId ?? null,
    metadata: {
      riderId: riderId ?? null,
      titleCode: "notif.contractExpiring.title",
      titleParams: {},
      messageCode: "notif.contractExpiring.message",
      messageParams: { rider: riderName, season: seasonNumber },
    },
  };
}

/**
 * #1836 · Sæsonskift-trigger: for hver ejet rytter hvis contract_end_season =
 * den kommende sæson, send en kontraktudløb-notifikation til ejeren.
 *
 * Samme menneske-manager-diskriminator som resten af motoren (is_ai=false,
 * is_frozen=false; akademi-/free-agent-ryttere har team_id der ikke matcher et
 * menneske-hold og udelukkes via joinen). notifyUser dedup'er per (manager,
 * rytter, sæson) inden for 24t. Fejl pr. notifikation isoleres (tælles, stopper
 * ikke resten). `notify` + `fetchOwnedExpiringRiders` er injicerbare for test.
 */
export async function emitContractExpiringNotifications({
  supabase,
  seasonNumber,
  notify = notifyUser,
  fetchOwnedExpiringRiders = defaultFetchOwnedExpiringRiders,
}) {
  const stats = { eligible: 0, delivered: 0, deduped: 0, failed: 0 };
  const riders = await fetchOwnedExpiringRiders({ supabase, seasonNumber });
  const eligible = (riders || []).filter((r) => r.user_id && r.id);
  stats.eligible = eligible.length;

  for (const rider of eligible) {
    const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
    const payload = buildContractExpiringNotification({
      riderName,
      riderId: rider.id,
      seasonNumber,
    });
    try {
      const res = await notify({ supabase, userId: rider.user_id, ...payload });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      // #2389 A2: var 100% stille (end ikke logget) — et systemisk problem kunne
      // kun ses som faldende delivered-tal, som ingen overvåger.
      stats.failed += 1;
      console.error(`  ❌ contract-expiring-notifikation fejlede (rytter ${rider.id}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "contract-expiring" }, riderId: rider.id });
    }
  }
  return stats;
}

/**
 * Hent ejede ryttere hvis kontrakt udløber i `seasonNumber`, joinet med ejerens
 * user_id (kun menneske-, ikke-frosne hold). Standard-implementering; injicérbar
 * i test for at undgå DB.
 */
async function defaultFetchOwnedExpiringRiders({ supabase, seasonNumber }) {
  const { data, error } = await supabase
    .from("riders")
    .select("id, firstname, lastname, team:team_id!inner(user_id, is_ai, is_frozen)")
    .eq("contract_end_season", seasonNumber)
    .not("team_id", "is", null)
    .eq("team.is_ai", false)
    .eq("team.is_frozen", false);
  if (error) {
    throw new Error(`Could not load owned expiring-contract riders: ${error.message}`);
  }
  return (data || []).map((r) => ({
    id: r.id,
    firstname: r.firstname,
    lastname: r.lastname,
    user_id: r.team?.user_id ?? null,
  }));
}

// ─── #1952 · Resultat-notifikation når et løb er kørt ─────────────────────────

export const RACE_RESULT_TYPE = "race_result";

/**
 * #1952 · Indsæt in-app "et af dine løb er kørt"-notifikationer til hver
 * menneske-manager der deltog i det netop afviklede løb.
 *
 * Deltager-sættet udledes via race_results -> riders -> teams (samme menneske-
 * manager-diskriminator som resten af motoren: is_ai=false, is_frozen=false), og
 * vi notificerer DISTINCT teams.user_id — én notifikation pr. manager, ikke pr.
 * rytter/etape. related_id = race.id, og metadata deep-linker til løbets resultat
 * (#666 locale-aware rendering via backendMessages-koderne).
 *
 * Idempotens: notifyUser dedup'er på (type, title, message, related_id) inden for
 * 24t, så en gen-finalisering eller recovery-genkørsel ikke dublerer. Fejl pr.
 * manager isoleres (tælles, stopper ikke resten). `notify` +
 * `fetchParticipatingManagers` er injicerbare for test.
 */
export async function emitRaceResultNotifications({
  supabase,
  race,
  notify = notifyUser,
  fetchParticipatingManagers = defaultFetchParticipatingManagers,
  fetchFirstTimeManagers = defaultFetchFirstTimeManagers,
}) {
  const stats = { eligible: 0, delivered: 0, deduped: 0, failed: 0 };
  if (!race?.id) return stats;

  const userIds = await fetchParticipatingManagers({ supabase, raceId: race.id });
  const eligible = [...new Set((userIds || []).filter(Boolean))];
  stats.eligible = eligible.length;

  const raceName = race.name ?? "your race";
  // #3310 comeback-buen: managere der får deres FØRSTE resultat her får en
  // varmere copy-variant på SAMME notifikationstype (ingen ny type). Forskellig
  // title/message kolliderer ikke med standard-raden i (type,title,message,
  // related_id)-dedup'en (24t, notifyUser).
  const firstTimers = await fetchFirstTimeManagers({ supabase, race, userIds: eligible });
  for (const userId of eligible) {
    const isFirst = firstTimers.has(userId);
    try {
      const res = await notify({
        supabase,
        userId,
        type: RACE_RESULT_TYPE,
        title: isFirst ? "Your first race is in the books" : "Race result is in",
        message: isFirst
          ? `${raceName} has been run. See how your riders did.`
          : `${raceName} has been run. View the result.`,
        relatedId: race.id,
        metadata: {
          raceId: race.id,
          titleCode: isFirst ? "notif.firstRaceResult.title" : "notif.raceResult.title",
          titleParams: {},
          messageCode: isFirst ? "notif.firstRaceResult.message" : "notif.raceResult.message",
          messageParams: { race: raceName },
        },
      });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      // #2389 A2: var 100% stille — spillere mistede "dit løb er kørt"-beskeden
      // uden noget logspor overhovedet.
      stats.failed += 1;
      console.error(`  ❌ race-result-notifikation fejlede (race ${race?.id}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "race-result" }, raceId: race?.id });
    }
  }
  return stats;
}

/**
 * Hent DISTINCT menneske-manager-user_ids der deltog i løbet, via
 * race_results -> riders -> teams (kun menneske-, ikke-frosne hold). Bruger
 * rytter-joinet (riders.team_id) som specificeret; FK-hints disambiguerer
 * riders' flere team-relationer. Standard-implementering; injicérbar i test.
 */
async function defaultFetchParticipatingManagers({ supabase, raceId }) {
  // #3331: large stage races produce 1000+ race_results rows (up to ~17k for
  // the biggest grand tours) — a naive unpaginated select here would silently
  // drop some human managers' "your race finished" notification. fetchAllRows
  // pages via .range(); .order("id") keeps pages stable.
  let data;
  try {
    data = await fetchAllRows(() => supabase
      .from("race_results")
      .select("rider:rider_id!inner(team:team_id!inner(user_id, is_ai, is_frozen))")
      .eq("race_id", raceId)
      .eq("rider.team.is_ai", false)
      .eq("rider.team.is_frozen", false)
      .order("id", { ascending: true }));
  } catch (error) {
    throw new Error(`Could not load participating managers for race ${raceId}: ${error.message}`, { cause: error });
  }
  return (data || []).map((row) => row.rider?.team?.user_id ?? null);
}

// #3310 comeback-buen: hvilke af løbets deltagende managere fik her deres
// FØRSTE resultat? Første = holdets eneste race_results-løb er netop dette.
// Fejl (inkl. et supabase-stub uden .from, fx i tests der ikke bruger denne
// sti) degraderer til tomt sæt: alle får standard-copy, ingen notifikation
// tabes. Standard-implementering; injicérbar i test.
export async function defaultFetchFirstTimeManagers({ supabase, race, userIds }) {
  if (!userIds?.length) return new Set();
  try {
    const { data: teams, error: teamsError } = await supabase
      .from("teams")
      .select("id, user_id")
      .in("user_id", userIds);
    if (teamsError) {
      // #2389 A2: var 100% stille — en fejlende first-timer-lookup degraderer
      // hele #3310-featurens varmere copy tavst til standard for alle, uden
      // noget logspor overhovedet.
      console.error(`  ❌ first-time-manager-lookup fejlede (teams, race ${race?.id}):`, teamsError?.message || teamsError);
      captureException(teamsError, { tags: { flow: "notifications", stage: "first-time-managers-teams" }, raceId: race?.id });
      return new Set();
    }
    if (!teams?.length) return new Set();
    // #3331: a team can accumulate 1000+ race_results rows over several
    // seasons (max observed ~5.1k) — an unpaginated select here would falsely
    // mark veteran teams as "first-timer" once truncation kicks in.
    let other;
    try {
      other = await fetchAllRows(() => supabase
        .from("race_results")
        .select("team_id")
        .in("team_id", teams.map((t) => t.id))
        .neq("race_id", race.id)
        .order("id", { ascending: true }));
    } catch (otherError) {
      console.error(`  ❌ first-time-manager-lookup fejlede (race_results, race ${race?.id}):`, otherError?.message || otherError);
      captureException(otherError, { tags: { flow: "notifications", stage: "first-time-managers-race-results" }, raceId: race?.id });
      return new Set();
    }
    const veteranTeamIds = new Set((other ?? []).map((r) => r.team_id));
    return new Set(teams.filter((t) => !veteranTeamIds.has(t.id)).map((t) => t.user_id));
  } catch (err) {
    console.error(`  ❌ first-time-manager-lookup fejlede (race ${race?.id}):`, err?.message || err);
    captureException(err, { tags: { flow: "notifications", stage: "first-time-managers" }, raceId: race?.id });
    return new Set();
  }
}

// ─── #2524 · Watchlist-notifikation ved rytter-sletning/-udgang ───────────────
//
// PROBLEM (#2524): rider_watchlist har INGEN FK-cascade til riders (bevidst —
// en managers ønskeliste er en ren brugerfacing bekvemmelighed, ikke en
// spil-invariant), så en slettet rytter efterlod en orphaned watchlist-række.
// Frontend filtrerede den tavst væk (WatchlistPage.jsx, #1918) — rytteren
// forsvandt uden forklaring. #2456-oprydningen (usolgte ungdomsryttere) var
// den konkrete hændelse der eksponerede det: spillere måtte have det forklaret
// manuelt på Discord.
//
// ÉN delt funktion, kaldt fra ALLE kendte rytter-sletnings-stier (se
// callsites: auctionFinalization.deleteUnsoldYouthRider,
// aiTeamGenerator.deleteAiTeamById/removeAiTeams/clearAllAiTeams), så en
// fremtidig sletnings-sti (fx pension #2218) ikke kan glemme det — kald denne
// funktion umiddelbart EFTER en bekræftet rytter-DELETE, aldrig før (ellers
// notificeres/ryddes der for ryttere der reelt IKKE blev slettet, fx en
// TOCTOU-guard der rammer 0 rækker).
export const WATCHLIST_DEPARTED_TYPE = "watchlist_departed";

/**
 * Notificér enhver bruger der har en af `riders` på sin ønskeliste ("X has
 * left the game"), og ryd derefter deres rider_watchlist-rækker for netop de
 * ryttere. Kaldes med ryttere der ALLEREDE er bekræftet slettet fra `riders`
 * (caller leverer id+navn, da rytter-rækken typisk er væk på kald-tidspunktet).
 *
 * Idempotent/no-op for ryttere uden ønskeliste-rækker. Fejl pr. bruger isoleres
 * (samme mønster som resten af filen) — én fejlende notifikation stopper
 * hverken de øvrige eller selve oprydningen. `notify` injicérbar for test.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {Array<{id:string, firstname?:string, lastname?:string}>} args.riders
 * @param {typeof notifyUser} [args.notify]
 * @returns {Promise<{riders:number, watchers:number, delivered:number, deduped:number, failed:number, cleared:number}>}
 */
export async function notifyAndClearWatchlistForRiders({ supabase, riders, notify = notifyUser }) {
  const stats = { riders: 0, watchers: 0, delivered: 0, deduped: 0, failed: 0, cleared: 0 };
  const list = (riders || []).filter((r) => r?.id);
  if (!list.length || !supabase?.from) return stats;
  stats.riders = list.length;

  const riderIds = list.map((r) => r.id);
  // #3030-klassen: riderIds er ubunden (AI-trim af en hel pulje ≈ 576 ryttere)
  // — rå .in() sprænger gateway-URL-grænsen (~16 KB). Chunket (ramte 26/7).
  const watchRows = [];
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const chunk = riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("rider_watchlist")
      .select("id, user_id, rider_id")
      .in("rider_id", chunk);
    if (error) {
      throw new Error(`notifyAndClearWatchlistForRiders lookup: ${error.message}`);
    }
    watchRows.push(...(data || []));
  }

  const byRiderId = new Map(list.map((r) => [r.id, r]));
  for (const row of watchRows || []) {
    const rider = byRiderId.get(row.rider_id);
    if (!rider || !row.user_id) continue;
    stats.watchers += 1;
    const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim() || "Rider";
    try {
      const res = await notify({
        supabase,
        userId: row.user_id,
        type: WATCHLIST_DEPARTED_TYPE,
        title: "Rider has left the game",
        message: `${riderName} has left the game and was removed from your watchlist.`,
        relatedId: rider.id,
        metadata: {
          riderId: rider.id,
          titleCode: "notif.watchlistDeparted.title",
          titleParams: {},
          messageCode: "notif.watchlistDeparted.message",
          messageParams: { rider: riderName },
        },
      });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      // Samme A2-lære som contract-expiring/race-result: må ALDRIG være 100%
      // stille (#2389) — log + Sentry, isolér, fortsæt.
      stats.failed += 1;
      console.error(`  ❌ watchlist-departure-notifikation fejlede (rytter ${rider.id}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "watchlist-departure" }, riderId: rider.id });
    }
  }

  // Samme URL-grænse gælder delete-filteret — chunket manuelt (#3030-klassen).
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const chunk = riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
    const { data: cleared, error: delErr } = await supabase
      .from("rider_watchlist")
      .delete()
      .in("rider_id", chunk)
      .select("id");
    if (delErr) {
      throw new Error(`notifyAndClearWatchlistForRiders cleanup: ${delErr.message}`);
    }
    stats.cleared += (cleared ?? []).length;
  }

  return stats;
}

// ─── #2523 · Per-etape-notifikation (undgår "der sker ikke noget" i etapeløb) ─

export const STAGE_RESULT_TYPE = "stage_result";

/**
 * #2523 · Indsæt in-app "din etape er kørt"-notifikationer til hver menneske-
 * manager der havde mindst én rytter med et 'stage'-resultat i DENNE etape.
 *
 * Problem: raceRunner.simulateStageByIndex notificerer historisk KUN på
 * final-etapen (#1952), så spillere oplevede 2+ dages stilhed under et
 * etapeløb (@smukkethomsen, #2523). Denne funktion suppleres per etape —
 * final-etapens samlede klassements-notifikation (emitRaceResultNotifications)
 * består uændret; raceRunner kalder KUN denne funktion for ikke-final-etaper
 * (se simulateStageByIndex's mellem-etape-gren) for at undgå dobbelt-besked.
 *
 * Manager uden ryttere i DENNE etape (fx eneste rytter DNF'et tidligere) har
 * ingen 'stage'-række og optræder derfor slet ikke i fetchStageParticipants'
 * resultat — ingen fejl, ingen tom/misvisende notifikation.
 *
 * Bedste resultat pr. manager: har et hold flere ryttere i etapen, vises
 * rytteren med LAVEST rank (bedste placering) — samme "bedste-rytter"-logik
 * spillere kender fra resultatsider.
 *
 * Idempotens: notifyUser dedup'er på (type, title, message, related_id) inden
 * for 24t — message bærer etape-nummer + rytternavn + placering, så to
 * forskellige etaper for samme løb aldrig kolliderer. `notify` +
 * `fetchStageParticipants` er injicerbare for test.
 */
export async function emitStageResultNotifications({
  supabase,
  race,
  stageNumber,
  totalStages,
  notify = notifyUser,
  fetchStageParticipants = defaultFetchStageParticipants,
}) {
  const stats = { eligible: 0, delivered: 0, deduped: 0, failed: 0 };
  if (!race?.id || !stageNumber) return stats;

  const rows = await fetchStageParticipants({ supabase, raceId: race.id, stageNumber });
  const bestByManager = new Map();
  for (const row of rows || []) {
    if (!row?.userId) continue;
    const existing = bestByManager.get(row.userId);
    if (!existing || (row.rank != null && (existing.rank == null || row.rank < existing.rank))) {
      bestByManager.set(row.userId, row);
    }
  }
  stats.eligible = bestByManager.size;

  const raceName = race.name ?? "your race";
  for (const [userId, best] of bestByManager) {
    const riderName = best.riderName ?? "your rider";
    const position = best.rank ?? null;
    try {
      const res = await notify({
        supabase,
        userId,
        type: STAGE_RESULT_TYPE,
        title: "Stage result is in",
        message: position != null
          ? `Stage ${stageNumber} of ${raceName} is done. Your best: ${riderName}, position ${position}.`
          : `Stage ${stageNumber} of ${raceName} is done.`,
        relatedId: race.id,
        metadata: {
          raceId: race.id,
          stageNumber,
          totalStages: totalStages ?? null,
          titleCode: "notif.stageResult.title",
          titleParams: {},
          messageCode: position != null ? "notif.stageResult.message" : "notif.stageResult.messageNoResult",
          messageParams: { stage: stageNumber, race: raceName, rider: riderName, position },
        },
      });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ stage-result-notifikation fejlede (race ${race?.id}, etape ${stageNumber}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "stage-result" }, raceId: race?.id, stageNumber });
    }
  }
  return stats;
}

/**
 * Hent 'stage'-resultatrækker for DENNE etape, kun for menneske-, ikke-frosne
 * hold. race_results.team_id peger direkte på teams (ingen riders-mellemled
 * nødvendigt, jf. makeResultRowPushers i raceRunner.js). Standard-
 * implementering; injicérbar i test.
 */
async function defaultFetchStageParticipants({ supabase, raceId, stageNumber }) {
  // pagination-safe: one (race_id, stage_number, result_type="stage") slice is
  // bounded by that race's field size — verified max 192 rows repo-wide
  // (#3331 audit, 2026-08-05), well under the 1000-row PostgREST cap.
  const { data, error } = await supabase
    .from("race_results")
    .select("rank, rider_name, team:team_id!inner(user_id, is_ai, is_frozen)")
    .eq("race_id", raceId)
    .eq("stage_number", stageNumber)
    .eq("result_type", "stage")
    .eq("team.is_ai", false)
    .eq("team.is_frozen", false);
  if (error) {
    throw new Error(`Could not load stage participants for race ${raceId} stage ${stageNumber}: ${error.message}`);
  }
  return (data || []).map((row) => ({
    userId: row.team?.user_id ?? null,
    rank: row.rank ?? null,
    riderName: row.rider_name ?? null,
  }));
}

// ─── #2945 · Scouting-rapport klar-notifikation ───────────────────────────
//
// PROBLEM (#2945): scout_assignments modner ad to stier — lazy-finalisering
// ved visning (#2644, scoutAssignmentService.getScoutState → ~30 min for
// 'target') og den natlige sweep (scoutSweep.js: backstop for 'target', eneste
// sti for 'mission') — men ingen af dem fortalte spilleren at rapporten var
// klar. Man skulle selv huske at åbne /scouting igen (spiller-ønske, #2945).
//
// ÉN delt notifikationstype dækker begge scout_assignments-kinds, så frontend
// kun har ét TYPE_CONFIG-opslag (NotificationsPage.jsx): 'target' sætter
// metadata.riderId og deep-linker (via den EKSISTERENDE #1486-riderId-regel)
// direkte til rytterprofilens Scouting-fane; 'mission' har intet riderId og
// falder tilbage til config.link = /scouting (ShortlistFeed).
//
// Idempotens: related_id = assignment.id. Hver assignment fuldføres netop ÉN
// gang (claim-first UPDATE i scoutTargetMaturation.js's lazy-sti, team-dags-
// mutex i scoutSweep.js), så related_id alene garanterer unikhed pr. rapport
// — notifyUser/notifyTeamOwner's (type,title,message,related_id) 24t-dedup
// (#666) er dermed et rent defensivt andet lag, testet eksplicit nedenfor.
export const SCOUT_REPORT_READY_TYPE = "scout_report_ready";

/**
 * Hent rytternavn til target-besked-teksten. scout_assignments-rækken bærer
 * kun rider_id, ikke navn. Standard-implementering; injicérbar i test.
 */
async function defaultFetchScoutRiderName({ supabase, riderId }) {
  if (!riderId) return null;
  const { data, error } = await supabase
    .from("riders")
    .select("firstname, lastname")
    .eq("id", riderId)
    .maybeSingle();
  if (error || !data) return null;
  return `${data.firstname ?? ""} ${data.lastname ?? ""}`.trim() || null;
}

/**
 * #2945 · Byg payloaden for "din scouting-rapport er klar"-notifikationen for
 * én fuldført scout_assignments-række. Dækker begge kinds:
 *   target  — enkelt-rytter-undersøgelse, riderName forventes leveret af kalderen.
 *   mission — shortlist-mission, ingen enkelt-rytter at linke til.
 */
export function buildScoutReportReadyNotification({ assignment, riderName }) {
  if (assignment.kind === "target") {
    const level = assignment.target_level ?? assignment.result?.level ?? null;
    const name = riderName || "the rider";
    return {
      type: SCOUT_REPORT_READY_TYPE,
      title: "Scouting report ready",
      message: level != null
        ? `Your level ${level} investigation of ${name} is ready. View the report.`
        : `Your investigation of ${name} is ready. View the report.`,
      relatedId: assignment.id,
      metadata: {
        riderId: assignment.rider_id ?? null,
        kind: "target",
        level,
        titleCode: "notif.scoutReportReady.target.title",
        titleParams: {},
        messageCode: "notif.scoutReportReady.target.message",
        messageParams: { rider: name, level },
      },
    };
  }

  const shortlistCount = assignment.result?.shortlist?.length ?? 0;
  return {
    type: SCOUT_REPORT_READY_TYPE,
    title: "Scouting mission ready",
    message: shortlistCount > 0
      ? `Your scouting mission found ${shortlistCount} rider${shortlistCount === 1 ? "" : "s"}. View the shortlist.`
      : "Your scouting mission is complete. No matching riders were found this time.",
    relatedId: assignment.id,
    metadata: {
      kind: "mission",
      shortlistCount,
      titleCode: "notif.scoutReportReady.mission.title",
      titleParams: {},
      // Single/multi/empty-varianter valgt server-side (samme mønster som
      // tx.squadFineSingle/-Multi) i stedet for ICU-plural — {count}-parametret
      // gennemgår formatBackendParams' RAW_KEYS-stringifikation (frontend/src/lib/
      // backendMessage.js), som ikke er et sikkert input til {count, plural, ...}.
      messageCode: shortlistCount === 0
        ? "notif.scoutReportReady.mission.messageEmpty"
        : shortlistCount === 1
          ? "notif.scoutReportReady.mission.messageSingle"
          : "notif.scoutReportReady.mission.messageMulti",
      messageParams: { count: shortlistCount },
    },
  };
}

/**
 * #2945 · Notificér holdejeren om en netop fuldført scout_assignments-række.
 * Kaldes EFTER assignment-status allerede er sat til 'completed' (begge
 * modnings-stier: scoutTargetMaturation.js's lazy+sweep-completion,
 * scoutSweep.js's completeMissionAssignment) — en notifikationsfejl må derfor
 * ALDRIG kunne vælte selve rapport-fuldførelsen. Samme A2-lære som resten af
 * filen (#2389): isolér, log, Sentry, fortsæt (returnér et fejl-resultat i
 * stedet for at kaste).
 *
 * `notify` + `fetchRiderName` er injicérbare for test.
 */
export async function notifyScoutReportReady({
  supabase,
  assignment,
  notify = notifyTeamOwner,
  fetchRiderName = defaultFetchScoutRiderName,
  now = new Date(),
}) {
  if (!assignment?.id || !assignment?.team_id) {
    return { delivered: false, deduped: false, reason: "missing_assignment" };
  }
  try {
    const riderName = assignment.kind === "target"
      ? await fetchRiderName({ supabase, riderId: assignment.rider_id })
      : null;
    const payload = buildScoutReportReadyNotification({ assignment, riderName });
    return await notify({ supabase, teamId: assignment.team_id, now, ...payload });
  } catch (err) {
    console.error(`  ❌ scout-report-ready-notifikation fejlede (assignment ${assignment?.id}):`, err?.message || err);
    captureException(err, { tags: { flow: "notifications", stage: "scout-report-ready" }, assignmentId: assignment?.id });
    return { delivered: false, deduped: false, reason: "error" };
  }
}

// ─── Gab 2 (docs/audits/2026-08-03-product-gap-review.md, #2822) · Velkomst-
// notifikation ved holdoprettelse ──────────────────────────────────────────
//
// PROBLEM: en ny konto havde INGEN notifikation før det første tilfældige
// event (bud/overbudt/løb/board) ramte den — for konti oprettet mellem to
// events kan det være dage, og nogle forlader spillet før noget som helst
// trigger'er. Rod-årsags-analyse mod prod (ghwvkxzhsbbltzfnuhhz, 4/8) af
// "13% af aktive brugere har 0 notifikationer" (23/7-målingen) fandt INGEN
// dæknings-/RLS-/opt-in-bug i den eksisterende trigger-kæde: hvert aktivt
// hold der reelt har budt/vundet/tabt HAR fået sine notifikationer (fx et
// hold med 120 bud og 52 bud på to andre konti krydsverificeret mod
// notifications.related_id — auction_outbid/auction_won lander korrekt for
// ALLE andre bydere på samme auktioner). Nul-tilfældene i det aktuelle
// snapshot var enten (a) et hold der aldrig blev oprettet (9/14 undersøgte
// nul-konti havde ingen teams-række, nogle en måned gamle) eller (b) egen
// sletning via NotificationsPage's "slet læste"/enkelt-sletning (RLS-policy
// "Users can delete own notifications" tillader det, ingen backend-oprydning
// findes — et bevidst brugervalg, ikke en fejl).
//
// FIX (fremadrettet, ingen backfill): giv hvert NYT hold én garanteret
// notifikation ved oprettelse, så indbakken aldrig er strukturelt tom fra dag
// 1 — uafhængigt af om et auktions-/løbs-/board-event tilfældigvis rammer
// tidligt. Afsendes fra backend/routes/api.js (PUT /api/teams/my,
// result.created === true) — IKKE herfra, for at holde
// teamProfileEngine.upsertOwnTeamProfile fri for notifikations-ansvar (samme
// adskillelse som #679-attribution og #3132-identity-event, som også
// afsendes fra route-handleren, fire-and-forget, må ALDRIG blokere signup).
export const WELCOME_TYPE = "welcome";

/**
 * Byg payloaden for velkomst-notifikationen. Ingen related_id (ikke knyttet
 * til nogen specifik entitet) og ingen dedup-risiko i praksis (én pr. konto,
 * afsendt præcis når holdet oprettes — men notifyUser's almindelige
 * type+title+message-dedup gælder stadig som defensivt andet lag).
 */
export function buildWelcomeNotification() {
  return {
    type: WELCOME_TYPE,
    title: "Welcome to Cycling Zone",
    message: "Your team is ready. Place a bid in the auction house to sign your first rider.",
    relatedId: null,
    metadata: {
      titleCode: "notif.welcome.title",
      titleParams: {},
      messageCode: "notif.welcome.message",
      messageParams: {},
    },
  };
}

// ─── #3334 · Chefscout-skift-notifikation ─────────────────────────────────
//
// PROBLEM (#3334, @nosyara. Discord-sag 4/8): en spiller skiftede chefscout
// (fyrede + genansatte en anden), og næste gang hun åbnede en ungdomsrytters
// scoutingrapport var loft-båndet omskrevet — INGEN besked forklarede at det
// var scout-skiftet (præcisionen/gulvet, jf. scoutHalfWidth) der flyttede
// tallene, ikke rytteren selv. Hun troede rytteren var blevet dårligere og
// ændrede hans træning for at "rette" et fald der aldrig skete.
//
// Afsendes fra facilityService.hireStaff() NÅR role==='scouting' OG holdet
// har fyret en tidligere scouting-staff før (loadFiredStaffNames.size > 0) —
// dvs. dette er et SKIFTE, ikke holdets første nogensinde ansatte spejder
// (en helt ny scout har ingen eksisterende rapporter at genberegne).
export const SCOUT_CHANGED_TYPE = "scout_changed";

/**
 * #3334 · Byg payloaden for "din scout er skiftet, rapporter genberegnes"-
 * notifikationen. Eksplicit på det centrale punkt: rytternes FAKTISKE evner
 * er uændrede — kun præcisionen på det viste loft-bånd er anderledes.
 */
export function buildScoutChangedNotification({ scoutName, scoutTier }) {
  const name = scoutName || "Your new scout";
  return {
    type: SCOUT_CHANGED_TYPE,
    title: "New scout, reports recalculated",
    message: scoutTier != null
      ? `${name} (tier ${scoutTier}) is now assessing your riders. Existing scouting reports are recalculated to match their precision — your riders' actual abilities have not changed.`
      : `${name} is now assessing your riders. Existing scouting reports are recalculated to match their precision — your riders' actual abilities have not changed.`,
    relatedId: null,
    metadata: {
      scoutName: name,
      scoutTier: scoutTier ?? null,
      titleCode: "notif.scoutChanged.title",
      titleParams: {},
      messageCode: "notif.scoutChanged.message",
      messageParams: { scoutName: name, scoutTier: scoutTier ?? null },
    },
  };
}

/**
 * #3334 · Notificér holdejeren om et netop gennemført chefscout-SKIFTE (ikke
 * første-gangs-ansættelse). Kaldes EFTER team_staff-insert er bekræftet
 * (facilityService.hireStaff) — en notifikationsfejl må ALDRIG kunne vælte
 * selve ansættelsen (samme A2-isolerings-mønster som resten af filen, #2389).
 * `notify` injicérbar for test.
 */
export async function notifyScoutChanged({
  supabase, teamId, scoutName, scoutTier, notify = notifyTeamOwner, now = new Date(),
}) {
  if (!teamId) return { delivered: false, deduped: false, reason: "missing_team" };
  try {
    const payload = buildScoutChangedNotification({ scoutName, scoutTier });
    return await notify({ supabase, teamId, now, ...payload });
  } catch (err) {
    console.error(`  ❌ scout-changed-notifikation fejlede (hold ${teamId}):`, err?.message || err);
    captureException(err, { tags: { flow: "notifications", stage: "scout-changed" }, teamId });
    return { delivered: false, deduped: false, reason: "error" };
  }
}
