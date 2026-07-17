import { captureException } from "./sentry.js";

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
}) {
  const stats = { eligible: 0, delivered: 0, deduped: 0, failed: 0 };
  if (!race?.id) return stats;

  const userIds = await fetchParticipatingManagers({ supabase, raceId: race.id });
  const eligible = [...new Set((userIds || []).filter(Boolean))];
  stats.eligible = eligible.length;

  const raceName = race.name ?? "your race";
  for (const userId of eligible) {
    try {
      const res = await notify({
        supabase,
        userId,
        type: RACE_RESULT_TYPE,
        title: "Race result is in",
        message: `${raceName} has been run. View the result.`,
        relatedId: race.id,
        metadata: {
          raceId: race.id,
          titleCode: "notif.raceResult.title",
          titleParams: {},
          messageCode: "notif.raceResult.message",
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
  const { data, error } = await supabase
    .from("race_results")
    .select("rider:rider_id!inner(team:team_id!inner(user_id, is_ai, is_frozen))")
    .eq("race_id", raceId)
    .eq("rider.team.is_ai", false)
    .eq("rider.team.is_frozen", false);
  if (error) {
    throw new Error(`Could not load participating managers for race ${raceId}: ${error.message}`);
  }
  return (data || []).map((row) => row.rider?.team?.user_id ?? null);
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
  const { data: watchRows, error } = await supabase
    .from("rider_watchlist")
    .select("id, user_id, rider_id")
    .in("rider_id", riderIds);
  if (error) {
    throw new Error(`notifyAndClearWatchlistForRiders lookup: ${error.message}`);
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

  const { data: cleared, error: delErr } = await supabase
    .from("rider_watchlist")
    .delete()
    .in("rider_id", riderIds)
    .select("id");
  if (delErr) {
    throw new Error(`notifyAndClearWatchlistForRiders cleanup: ${delErr.message}`);
  }
  stats.cleared = (cleared ?? []).length;

  return stats;
}
