// #8153: en frigivelse midt i et etapeloeb venter til loebets slut.
//
// Ejerens valg (14/11): frigivelsen bestilles, gebyret traekkes straks, rytteren
// koerer loebet faerdigt og taeller i truppen, og han forlader holdet foerst efter
// sidste etape. En bestilling er endelig. Design:
// docs/superpowers/specs/2026-11-14-8153-frigivelse-venter-design.md (rettelser i
// docs/drafts/spec-natboelge-2026-11-15.md, afsnit S6).
//
// Bag kontakten release_defer_8153 (binaer, kun "on" taender, "beta" er slukket,
// fordi det er penge). Slukket: ingen bestilling oprettes, og ruterne svarer som i
// dag. Udfoerelsen og saesonskifte-spaerren laeser tabellen uanset kontakten, saa en
// bestilling fra en taendt periode altid bliver udfoert.
//
// Pengene og ejerskabet sker i SQL (database/2026-11-15-8153-pending-rider-releases.sql):
// order_rider_release_8153 (bestilling + gebyr i een transaktion under holdlaasen) og
// execute_pending_rider_release_8153 (idempotent udfoerelse). En vagt paa riders
// afviser ethvert holdskifte for en rytter med en aktiv bestilling.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { loadWithdrawnPairs, withdrawalKey } from "./raceWithdrawal.js";
import { buildKeyedNotification } from "./notificationKeys.js";
import { SELLER_SQUAD_FLOOR, sellerFloorRiskIds } from "./marketUtils.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "./notificationService.js";

export const RELEASE_DEFER_FLAG_KEY = "release_defer_8153";
export const PENDING_RELEASES_TABLE = "pending_rider_releases";
// Beskedtypen for "rytteren forlader / har forladt holdet" (findes allerede i
// notifications_type_check og vises med samme ikon som kontraktudloeb).
export const PENDING_RELEASE_NOTIFICATION_TYPE = "contract_expired_release";

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

const errorMessage = (err) => (err instanceof Error ? err.message : String(err?.message ?? err));
export { errorMessage as pendingReleaseErrorMessage };
const isMissingTable = (error) => MISSING_TABLE_CODES.has(error?.code);
export { isMissingTable as isMissingPendingReleasesTable };
export const riderFullName = (rider) => `${rider?.firstname ?? ""} ${rider?.lastname ?? ""}`.trim();

/**
 * Kontakten. Kun "on" (eller true) taender.
 * @param {any} supabase
 * @param {{ fresh?: boolean }} [opts]
 */
export async function isReleaseDeferEnabled(supabase, { fresh = true } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RELEASE_DEFER_FLAG_KEY, { fresh }));
}

/**
 * Det aktive etapeloeb, rytteren koerer lige nu, eller null. Samme diskriminator
 * som getRidersInActiveStageRace (salg og auktion bruger den): race_type
 * stage_race, ikke completed, mindst een koert etape, og holdet er ikke afmeldt.
 * Koerer han (mod forventning, bindingen forhindrer det) to, vaelges det med
 * laveste id; udfoerelsen venter alligevel, til han ikke er i noget aktivt loeb.
 *
 * @param {any} supabase
 * @param {string} riderId
 * @returns {Promise<{ id: string, name: string|null } | null>}
 */
export async function findActiveStageRaceForRider(supabase, riderId) {
  if (!riderId) return null;
  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, name")
    .eq("race_type", "stage_race")
    .neq("status", "completed")
    .gt("stages_completed", 0);
  if (rErr) throw new Error(`findActiveStageRaceForRider: races lookup failed: ${rErr.message}`);
  if (!races?.length) return null;

  const { data: entries, error: eErr } = await supabase
    .from("race_entries")
    .select("race_id, team_id")
    .eq("rider_id", riderId)
    .in("race_id", races.map((r) => r.id));
  if (eErr) throw new Error(`findActiveStageRaceForRider: entries lookup failed: ${eErr.message}`);
  if (!entries?.length) return null;

  const withdrawn = await loadWithdrawnPairs({ supabase, raceIds: [...new Set(entries.map((e) => e.race_id))] });
  const live = [...new Set(entries.filter((e) => !withdrawn.has(withdrawalKey(e.race_id, e.team_id))).map((e) => e.race_id))].sort();
  if (!live.length) return null;
  const race = races.find((r) => r.id === live[0]);
  return { id: race.id, name: race.name ?? null };
}

/**
 * release-quote og release: null = kontakten er slukket, og ruten svarer som i dag.
 * Taendt: issue (409, frigivelsen er allerede bestilt) eller pendingRace (loebet,
 * frigivelsen venter paa, eller null = frigivelsen sker straks som i dag).
 *
 * @param {any} supabase
 * @param {string} riderId
 * @returns {Promise<null | { issue: null | { status: number, body: object }, pendingRace: { id: string, name: string|null } | null }>}
 */
export async function releaseDeferContext8153(supabase, riderId) {
  if (!(await isReleaseDeferEnabled(supabase))) return null;
  const pending = await getPendingReleaseForRider(supabase, riderId);
  if (pending) return { issue: pendingReleaseAlreadyOrderedIssue(pending.raceName), pendingRace: null };
  return { issue: null, pendingRace: await findActiveStageRaceForRider(supabase, riderId) };
}

/**
 * Rytterens aktive bestilling med loebets navn, eller null. Manglende tabel = null.
 * @param {any} supabase
 * @param {string} riderId
 * @returns {Promise<{ id: string, riderId: string, teamId: string, raceId: string, raceName: string|null } | null>}
 */
export async function getPendingReleaseForRider(supabase, riderId) {
  if (!riderId) return null;
  const { data, error } = await supabase
    .from(PENDING_RELEASES_TABLE)
    .select("id, rider_id, team_id, race_id")
    .eq("rider_id", riderId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`getPendingReleaseForRider: ${error.message}`);
  }
  if (!data) return null;
  const names = await loadRaceNames(supabase, [data.race_id]);
  return { id: data.id, riderId: data.rider_id, teamId: data.team_id, raceId: data.race_id, raceName: names.get(data.race_id) ?? null };
}

async function loadRaceNames(supabase, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("races").select("id, name, status").in("id", ids);
  if (error) throw new Error(`pendingRelease race lookup failed: ${error.message}`);
  return new Map((data || []).map((r) => [r.id, r.name ?? null]));
}

/** 409-svaret, naar en rytter med en aktiv bestilling forsoeges handlet. */
export function pendingReleaseTradeIssue(raceName) {
  return {
    status: 409,
    body: {
      error: `This rider is leaving your team after ${raceName ?? "the stage race"} and cannot be traded.`,
      errorCode: "rider_pending_release_trade",
      errorParams: { race: raceName ?? "" },
    },
  };
}

/** 409-svaret, naar frigivelsen allerede er bestilt. */
export function pendingReleaseAlreadyOrderedIssue(raceName) {
  return {
    status: 409,
    body: {
      error: `This rider's release is already ordered. He leaves your team after ${raceName ?? "the stage race"}.`,
      errorCode: "rider_release_already_pending",
      errorParams: { race: raceName ?? "" },
    },
  };
}

/**
 * Salg, bytte, auktion og transferliste: et delt praedikat ved siden af
 * getParkedRiderTradeIssue. Slukket kontakt: null uden opslag i tabellen (vagten paa
 * riders staar stadig imod, hvis en bestilling fra en taendt periode findes).
 * En laesefejl giver null: vagten i databasen er den haarde graense, dette er
 * forklaringen til spilleren.
 *
 * @param {any} supabase
 * @param {string|null|undefined} riderId
 * @returns {Promise<null | { status: number, body: object }>}
 */
export async function getPendingReleaseTradeIssue(supabase, riderId) {
  if (!riderId) return null;
  try {
    if (!(await isReleaseDeferEnabled(supabase, { fresh: false }))) return null;
    const pending = await getPendingReleaseForRider(supabase, riderId);
    return pending ? pendingReleaseTradeIssue(pending.raceName) : null;
  } catch (err) {
    // best-effort-forklaring: vagten riders_pending_release_guard_8153 afviser stadig selve skiftet.
    console.error(`[pendingRelease8153] handels-vagten kunne ikke laese bestillingen (${riderId}): ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Antal aktive bestillinger for holdet (afgaaende i gulvtjekket ved bestilling).
 * @param {any} supabase
 * @param {string} teamId
 * @param {{ excludeRiderIds?: string[] }} [opts]
 */
export async function countPendingReleasesForTeam(supabase, teamId, { excludeRiderIds = [] } = {}) {
  if (!teamId) return 0;
  const { data, error } = await supabase
    .from(PENDING_RELEASES_TABLE)
    .select("rider_id")
    .eq("team_id", teamId)
    .eq("status", "pending");
  if (error) {
    if (isMissingTable(error)) return 0;
    throw new Error(`countPendingReleasesForTeam: ${error.message}`);
  }
  const skip = new Set(excludeRiderIds);
  return (data || []).filter((r) => !skip.has(r.rider_id)).length;
}

/**
 * GET /api/me/pending-releases: holdets ventende frigivelser til maerket og
 * bekraeftelsen. Laeses uanset kontakten (en bestilling fra en taendt periode vises).
 * @param {any} supabase
 * @param {string} teamId
 * @returns {Promise<Array<{ riderId: string, raceId: string, raceName: string|null }>>}
 */
export async function loadPendingReleasesForTeam(supabase, teamId) {
  if (!teamId) return [];
  const { data, error } = await supabase
    .from(PENDING_RELEASES_TABLE)
    .select("rider_id, race_id, ordered_at")
    .eq("team_id", teamId)
    .eq("status", "pending")
    .order("ordered_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`loadPendingReleasesForTeam: ${error.message}`);
  }
  const rows = data || [];
  if (!rows.length) return [];
  const names = await loadRaceNames(supabase, rows.map((r) => r.race_id));
  return rows.map((r) => ({ riderId: r.rider_id, raceId: r.race_id, raceName: names.get(r.race_id) ?? null }));
}

/**
 * Udtagelse: en rytter med en aktiv bestilling kan ikke udtages til et andet loeb
 * end det, han koerer faerdigt (rettelse 6 i S6). Bindingen holder ham allerede ude
 * af overlappende loeb, saa "et andet loeb" er praecis "et loeb efter det
 * igangvaerende". Slukket kontakt eller tom trup: null uden opslag i tabellen.
 *
 * @param {any} supabase
 * @param {{ race: { id: string }, riderIds: string[] }} args
 * @returns {Promise<null | { ok: false, status: number, error: string, leaving_rider_ids: string[] }>}
 */
export async function getPendingReleaseSelectionIssue(supabase, { race, riderIds }) {
  const ids = [...new Set((riderIds || []).filter(Boolean))];
  if (!ids.length || !race?.id) return null;
  if (!(await isReleaseDeferEnabled(supabase, { fresh: false }))) return null;
  const { data, error } = await supabase
    .from(PENDING_RELEASES_TABLE)
    .select("rider_id, race_id")
    .in("rider_id", ids)
    .eq("status", "pending");
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`getPendingReleaseSelectionIssue: ${error.message}`);
  }
  const leaving = (data || []).filter((r) => r.race_id !== race.id).map((r) => r.rider_id);
  if (!leaving.length) return null;
  return { ok: false, status: 409, error: "selection_rider_leaving", leaving_rider_ids: leaving.sort() };
}

/**
 * Antal aktive bestillinger i hele spillet (saesonskiftets readiness-gate).
 * Manglende tabel = 0; andre fejl kastes, som de oevrige tjek i gaten.
 * @param {any} supabase
 * @returns {Promise<number>}
 */
export async function countActivePendingReleases(supabase) {
  const { count, error } = await supabase
    .from(PENDING_RELEASES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) {
    if (isMissingTable(error)) return 0;
    throw new Error(`Could not count pending rider releases: ${error.message}`);
  }
  return Number(count) || 0;
}

export const PENDING_RELEASE_FORCE_BLOCKED_ERROR =
  "A season transition cannot be forced while rider releases are pending (pending_rider_releases, #8153). Let the stage race finish and the heal sweep execute them.";

/**
 * Saesonskiftets force-gren (rettelse 7, samme faste regel som laaste salg): antal
 * aktive bestillinger. Fail-closed: kan tabellen ikke laeses, svares 1, saa force afvises.
 * @param {any} supabase
 * @returns {Promise<number>}
 */
export async function countPendingReleasesForTransition(supabase) {
  try {
    return await countActivePendingReleases(supabase);
  } catch (err) {
    // best-effort-laesning, fail-closed: hellere et afvist skifte end loen og kontraktudloeb midt i en ventende frigivelse.
    console.error(`[pendingRelease8153] saesonskifte-spaerren fejlede, afviser: ${errorMessage(err)}`);
    return 1;
  }
}

/**
 * Bestil frigivelsen (POST /riders/:id/release med kontakten taendt og rytteren i
 * et aktivt etapeloeb). Gebyret traekkes i samme transaktion som raekken oprettes.
 *
 * @param {any} supabase
 * Truppens gulv regnes som i auto_accept_release_rider (SELLER_SQUAD_FLOOR og
 * risiko-rytterne); de ventende frigivelser taeller som afgaaende i SQL.
 *
 * @param {any} supabase
 * @param {{ riderId: string, teamId: string, race: { id: string, name: string|null }, fee: number,
 *   feePayload: object, orderedBy: string|null, now?: Date, atRiskRiders?: Array<{ id: string }>,
 *   riderName?: string, notifyTeamOwner?: Function }} args
 * @returns {Promise<{ data: { pending: true, race: { id: string, name: string|null }, fee: number } } | { error: { status: number, body: object } }>}
 */
export async function orderPendingRelease(supabase, {
  riderId, teamId, race, fee, feePayload, orderedBy = null, now = new Date(),
  atRiskRiders = [], riderName = "", notifyTeamOwner = null,
}) {
  const notify = notifyTeamOwner ?? ((tid, type, title, message, relatedId = null, metadata = null) =>
    notifyTeamOwnerShared({ supabase, teamId: tid, type, title, message, relatedId, metadata }));
  const { data: result, error } = await supabase.rpc("order_rider_release_8153", {
    p_rider_id: riderId,
    p_team_id: teamId,
    p_race_id: race.id,
    p_fee: fee,
    p_finance_payload: feePayload,
    p_ordered_by: orderedBy,
    p_now: now.toISOString(),
    p_min_riders: SELLER_SQUAD_FLOOR,
    p_at_risk_rider_ids: sellerFloorRiskIds(atRiskRiders),
  });
  if (error) {
    const issue = readMarketGateIssue(error);
    if (issue) return { error: { status: 400, body: { errorCode: "insufficient_available_balance", errorParams: { fee, ...issue } } } };
    throw new Error(`order_rider_release_8153: ${error.message}`);
  }
  switch (result?.status) {
    case "pending": {
      const notice = buildKeyedNotification({
        titleCode: "notif.riderReleasePending.title",
        messageCode: "notif.riderReleasePending.message",
        messageParams: { rider: riderName, race: race.name ?? "", fee },
        metadata: { riderId, raceId: race.id },
      });
      try {
        await notify(teamId, PENDING_RELEASE_NOTIFICATION_TYPE, notice.title, notice.message, riderId, notice.metadata);
      } catch (notifyErr) {
        // best-effort: bestillingen er gennemfoert og betalt; en fejlet besked maa ikke give spilleren en fejl.
        console.error(`[pendingRelease8153] beskeden ved bestilling fejlede (${riderId}): ${errorMessage(notifyErr)}`);
      }
      return { data: { pending: true, race: { id: race.id, name: race.name ?? null }, fee } };
    }
    case "already_pending": {
      const names = await loadRaceNames(supabase, [result.race_id]);
      return { error: pendingReleaseAlreadyOrderedIssue(names.get(result.race_id) ?? null) };
    }
    case "rider_state_changed":
      return { error: { status: 409, body: { error: "This rider is no longer on your team", errorCode: "rider_state_changed" } } };
    case "rider_on_auction":
      return { error: { status: 409, body: { error: "This rider is currently on auction and can't be released. Wait for the auction to end first", errorCode: "rider_on_auction_release" } } };
    case "cannot_afford_release":
      return { error: { status: 400, body: { error: "You can't afford the buyout fee for this rider", errorCode: "cannot_afford_release", errorParams: { fee: Number(result.fee), balance: Number(result.balance) } } } };
    case "insufficient_available_balance":
      return { error: { status: 400, body: { error: "Not enough available money: part of your balance is locked in auction bids.", errorCode: "insufficient_available_balance", errorParams: { fee: Number(result.fee), available: Number(result.available), locked: Number(result.locked) } } } };
    case "squad_floor":
      return { error: { status: 409, body: { error: `You can't drop below ${result.min_riders} riders once contract expiry and retirement risk at the next season change are counted`, errorCode: "cannot_release_squad_risk", errorParams: { minRiders: result.min_riders } } } };
    default:
      throw new Error(`order_rider_release_8153: unexpected status ${result?.status}`);
  }
}

// Den eksisterende pengevagt paa finance_transactions (market_discretionary_finance_guard_2176)
// kaster market_gate_6181:insufficient_available_balance med detaljer i DETAIL.
function readMarketGateIssue(error) {
  if (!String(error?.message ?? "").includes("insufficient_available_balance")) return null;
  try {
    const detail = typeof error.details === "string" ? JSON.parse(error.details) : (error.details ?? {});
    return { available: Number(detail.available) || 0, locked: Number(detail.locked) || 0 };
  } catch (parseErr) {
    // best-effort: detaljerne er kun til fejlteksten; afvisningen sker uanset.
    console.warn(`[pendingRelease8153] pengevagtens detaljer kunne ikke laeses: ${errorMessage(parseErr)}`);
    return { available: 0, locked: 0 };
  }
}
