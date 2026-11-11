// #2176 auto-accept (PR 6 af byggeplanen): backend bag kontakten auto_accept_enabled.
//
// Saelger kan give en listing en auto-pris Y over listeprisen. Et bud paa Y eller
// derover bliver ikke et direkte tilbud: koeberen trykker paa en knap (PR 7),
// vaelger en laengde paa 30 min til 24 t AKTIV tid, og der starter en aaben
// auktion med hans bud som foerende bud. Direkte bud under Y forhandles som i dag.
//
// Kontrakten med databasen (database/2026-11-07-2176-m2-auto-accept.sql):
//   - set_listing_auto_accept_price: saelger saetter/aendrer/fjerner Y med den
//     pris, han saa (forskel = 409). Alle aendringer logges til fair-play.
//   - start_auto_accept_auction: tjek og skrivning i EEN transaktion under
//     holdlaase (penge, plads, rytterstatus, saelgers gulv), saa auktionen
//     aldrig kan startes uden penge eller plads, heller ikke ved samtidige klik.
//
// Slukket kontakt = bit-identisk: hver hjaelper herfra laeser kun kontakten og
// goer intet andet, naar den er slukket (bevist i autoAccept2176.test.js). De
// nye ruter svarer 404, som foer de fandtes.
//
// Sluttidspunktet regnes her med calculateAuctionEnd (aktiv tid, natten
// springes over). Flash-stien (vaegur) bruges aldrig.

import { evaluateFlagStage } from "./featureStage.js";
import { isAutoAcceptActorEnabled2176, isAutoAcceptPairEnabled2176, isMarketTransportEnabled2176, readMarketFlag2176, readMarketSpendIssue2176 } from "./marketBeta2176.ts";
import { calculateAuctionEnd, getAuctionSeasonBoundaryIssue } from "./auctionEngine.js";
import { getTeamMarketState, MIN_RIDERS_FOR_RACE, calculateRiderMarketValue } from "./marketUtils.js";
import { readTransferPriceBandConfig, getPriceBandViolation } from "./transferPriceBand.js";
import { buildAtRiskErrorParams, fetchAtRiskRiders } from "./squadRiskGuard.js";
import { assertSigningAllowed } from "./boardConsequences.js";
import { fetchSeasonTransitionBoundary } from "./seasonTransitionBoundary.js";
import { notifyNewAuction, notifyWatchlistRiderAuction } from "./discordNotifier.js";
import { applySeniorSquadFilter } from "./squads.js";
import { captureException } from "./sentry.js";
import { recordIdentityEvent } from "./identityTelemetry.js";
import { buildWatchlistAuctionNotification } from "./transferNotifications.js";

export const AUTO_ACCEPT_FLAG_KEY = "auto_accept_enabled";
export const AUTO_ACCEPT_MIN_MINUTES = 30;
export const AUTO_ACCEPT_MAX_MINUTES = 24 * 60;
// Auktionernes priser er heltal i databasen (integer).
const MAX_PRICE = 2147483647;

/** Kun "on" (eller true) taender. Ingen beta-stage: reglen skal gaelde ens for koeber og saelger. */
export async function isAutoAcceptEnabled(supabase, actor = {}) {
  return isAutoAcceptActorEnabled2176(supabase, actor);
}

const isWholePrice = (value) => Number.isInteger(value) && value > 0 && value <= MAX_PRICE;

/** Heltal 30-1440, ellers en fejlkode. */
export function getAutoAcceptDurationIssue(minutes) {
  const n = typeof minutes === "string" && minutes.trim() !== "" ? Number(minutes) : minutes;
  if (!Number.isInteger(n) || n < AUTO_ACCEPT_MIN_MINUTES || n > AUTO_ACCEPT_MAX_MINUTES) {
    return { code: "invalid_duration", minMinutes: AUTO_ACCEPT_MIN_MINUTES, maxMinutes: AUTO_ACCEPT_MAX_MINUTES };
  }
  return null;
}

/**
 * Sluttidspunkt for den valgte laengde i AKTIV tid, med samme funktion og
 * config som alle andre auktioner (ejer 7/11: praecist sluttidspunkt vises).
 */
export function autoAcceptAuctionEnd(now, cfg, minutes) {
  return calculateAuctionEnd(now, { ...cfg, duration_hours: minutes / 60 });
}

/** Ren regel: er et direkte bud paa eller over listingens auto-pris? */
export function getOfferAutoAcceptConflict(listing, offerAmount) {
  const autoPrice = Number(listing?.auto_accept_price);
  if (!listing?.auto_accept_price || !Number.isFinite(autoPrice)) return null;
  if (!["open", "negotiating"].includes(listing.status)) return null;
  const amount = Number(offerAmount);
  if (!Number.isFinite(amount) || amount < autoPrice) return null;
  return { listingId: listing.id, autoAcceptPrice: autoPrice };
}

/**
 * Gate for begge tilbudsruter (POST /transfers/offer og /transfers/:id/offer).
 * Et bud paa Y eller derover afvises og peger paa knappen, der starter auktionen.
 * Slukket kontakt: kun kontakten laeses, intet andet opslag.
 *
 * @returns {Promise<{status: number, body: {error: string, errorCode: string, errorParams: {autoAcceptPrice: number, listingId: string}}} | null>}
 */
export async function getOfferAutoAcceptIssue(supabase, { riderId, listing = null, offerAmount, buyerTeamId = null }) {
  const stage = await readMarketFlag2176(supabase, AUTO_ACCEPT_FLAG_KEY);
  if (stage !== "beta" && !evaluateFlagStage(stage)) return null;
  if (stage === "beta" && !buyerTeamId) return null;
  let row = listing;
  if (!row) {
    // schema-columns-ok: auto_accept_price kommer med database/2026-11-07-2176-m2-auto-accept.sql og laeses kun med kontakten taendt (efter apply).
    const { data, error } = await supabase
      .from("transfer_listings")
      .select("id, rider_id, seller_team_id, status, auto_accept_price")
      .eq("rider_id", riderId)
      .in("status", ["open", "negotiating"])
      .maybeSingle();
    if (error) throw error;
    row = data;
  }
  if (stage === "beta" && row && !(await isAutoAcceptPairEnabled2176(supabase, { sellerTeamId: row.seller_team_id, buyerTeamId }))) return null;
  const conflict = getOfferAutoAcceptConflict(row, offerAmount);
  if (!conflict) return null;
  const listingRiderId = row?.rider_id ?? riderId;
  if (!listingRiderId || !row?.seller_team_id) return null;
  const { data: currentRider, error: ownerError } = await supabase.from("riders")
    .select("team_id").eq("id", listingRiderId).maybeSingle();
  if (ownerError) throw ownerError;
  if (!currentRider || currentRider.team_id !== row.seller_team_id) return null;
  return {
    status: 409,
    body: {
      error: `The seller accepts ${conflict.autoAcceptPrice.toLocaleString("en-US")} CZ$ automatically. A bid at that price or above starts an open auction: use the auto-accept button on the listing.`,
      errorCode: "offer_at_auto_accept_price",
      errorParams: { autoAcceptPrice: conflict.autoAcceptPrice, listingId: conflict.listingId },
    },
  };
}

// Supabase mutations return errors instead of throwing. A rejected trigger
// must never be followed by success notifications or confirmation/payment.
export async function checkAutoAcceptMutation(query) {
  const { error } = await query;
  if (!error) return null;
  if (error.message !== "offer_at_auto_accept_price") throw error;
  let detail;
  try { detail = JSON.parse(error.details); } catch {
    // best-effort: optional database detail may be absent; preserve the authoritative boundary rejection below.
    detail = {};
  }
  return { status: 409, body: { error: error.message, errorCode: "offer_at_auto_accept_price",
    errorParams: { autoAcceptPrice: Number(detail.auto_accept_price), listingId: detail.listing_id } } };
}

/**
 * Saelgers ryttere paa en aktiv auktion med en anden byder taeller som
 * udgaaende i gulv-tjekket (#2176: ellers kan saelger handle sig under
 * loebsgulvet og faa auktionen annulleret ved slut). Slukket kontakt: 0 og
 * intet opslag ud over kontakten.
 *
 * @param {object} supabase
 * @param {string} teamId
 * @param {{skipRiderIds?: string[], atRiskSeasonNumber?: number|null}} [opts]
 *   skipRiderIds: ryttere der allerede er talt med (rytteren i denne handel og
 *   risiko-rytterne), saa ingen taelles to gange. atRiskSeasonNumber: kender
 *   kalderen kun antallet af risiko-ryttere, slaas de op her og springes over.
 * @returns {Promise<number>}
 */
export async function countSellerAuctionOutgoing(supabase, teamId, { skipRiderIds = [], atRiskSeasonNumber = null } = {}) {
  if (!teamId || !(await isAutoAcceptEnabled(supabase, { teamId }))) return 0;
  // pagination-safe: eet holds senior-trup, begraenset af trup-loftet.
  const { data: riders, error: riderError } = await applySeniorSquadFilter(
    supabase.from("riders").select("id").eq("team_id", teamId)
  ).eq("is_retired", false).is("pending_team_id", null);
  if (riderError) throw riderError;
  const atRisk = atRiskSeasonNumber == null ? [] : await fetchAtRiskRiders(supabase, teamId, atRiskSeasonNumber);
  const skip = new Set([...skipRiderIds, ...atRisk.map((r) => r.id)].filter(Boolean));
  const ids = (riders || []).map((r) => r.id).filter((id) => !skip.has(id));
  if (ids.length === 0) return 0;
  const { data: auctions, error } = await supabase
    .from("auctions")
    .select("rider_id, current_bidder_id")
    .in("rider_id", ids)
    .in("status", ["active", "extended"])
    .not("current_bidder_id", "is", null)
    .neq("current_bidder_id", teamId);
  if (error) throw error;
  return new Set((auctions || []).map((a) => a.rider_id)).size;
}

// Ejer 10/11 ("Bekraeft igen"): koeberen binder penge mod det sluttidspunkt, dialogen viste.
// Regner serveren et andet minut (ur-forskel, minutskifte, aktiv tid der lukker), afvises
// buddet, og dialogen viser den nye tid. Intet bud og ingen reservation mod en uset sluttid.
const END_CHANGED = (calculatedEnd, serverNow) => ({
  status: 409,
  body: {
    error: "The auction end time changed. Check the new time and confirm again",
    errorCode: "auto_accept_end_changed",
    // serverNow lader dialogen rette sit ur, saa den viste tid foelger serverens (review 10/11).
    errorParams: { endsAt: calculatedEnd.toISOString(), serverNow: serverNow.toISOString() },
  },
});

/** PURE: samme minut som den viste sluttid? Dialogen viser minutter, ikke sekunder. */
export function autoAcceptEndMatches(expectedEndAt, calculatedEnd) {
  const expected = typeof expectedEndAt === "string" ? new Date(expectedEndAt) : null;
  if (!expected || !Number.isFinite(expected.getTime())) return false;
  return Math.floor(expected.getTime() / 60000) === Math.floor(calculatedEnd.getTime() / 60000);
}

const PRICE_CHANGED = (autoAcceptPrice) => ({
  status: 409,
  body: {
    error: "The auto-accept price has changed. Check the new price and try again.",
    errorCode: "auto_accept_price_changed",
    errorParams: { autoAcceptPrice: autoAcceptPrice == null ? null : Number(autoAcceptPrice) },
  },
});

const RIDER_UNAVAILABLE = {
  status: 409,
  body: { error: "This rider can't be bought through auto-accept right now", errorCode: "auto_accept_rider_unavailable" },
};

/** Oversaetter start_auto_accept_auction's status til et HTTP-svar. */
export function mapStartAutoAcceptResult(result) {
  switch (result?.status) {
    case "disabled": return { status: 404, body: DISABLED };
    case "started":
      return { status: 201, body: result };
    case "listing_not_found":
      return { status: 404, body: { error: "Listing not found", errorCode: "listing_not_found" } };
    case "own_listing":
      return { status: 400, body: { error: "You can't bid on your own listing", errorCode: "cannot_bid_own_listing" } };
    case "listing_closed":
      return { status: 409, body: { error: "This listing is already closed", errorCode: "listing_already_closed" } };
    case "no_auto_accept_price":
      return PRICE_CHANGED(null);
    case "price_changed":
      return PRICE_CHANGED(result.auto_accept_price);
    case "rider_on_auction":
      return { status: 409, body: { error: "This rider is on an active auction. Bid on the auction instead of making a transfer offer.", errorCode: "rider_on_auction_transfer" } };
    case "rider_not_with_seller":
    case "rider_state_changed":
    case "rider_retired":
    case "rider_is_academy":
    case "rider_pending_transfer":
    case "rider_in_open_swap":
      return RIDER_UNAVAILABLE;
    case "insufficient_funds":
      return { status: 400, body: { error: "The starting bid exceeds your available balance, including active auction leads", errorCode: "start_bid_exceeds_balance" } };
    case "squad_full":
      return { status: 409, body: { error: `Your squad has no free place (${result.max_riders} riders, counting the auctions you lead)`, errorCode: "auto_accept_squad_full", errorParams: { maxRiders: result.max_riders } } };
    case "seller_squad_floor":
      return { status: 409, body: { error: `The seller can't drop below ${result.min_riders} riders right now`, errorCode: "auto_accept_seller_squad_floor", errorParams: { minRiders: result.min_riders } } };
    default:
      throw new Error(`start_auto_accept_auction: unexpected status ${result?.status}`);
  }
}

/** Oversaetter set_listing_auto_accept_price's status til et HTTP-svar. */
export function mapSetAutoAcceptPriceResult(result) {
  switch (result?.status) {
    case "disabled": return { status: 404, body: DISABLED };
    case "updated":
    case "unchanged":
      return { status: 200, body: { listing_id: result.listing_id, auto_accept_price: result.auto_accept_price ?? null, status: result.status } };
    case "not_found":
      return { status: 404, body: { error: "Listing not found", errorCode: "listing_not_found" } };
    case "not_owner":
      return { status: 403, body: { error: "Not your listing", errorCode: "listing_not_owner" } };
    case "listing_closed":
      return { status: 400, body: { error: "This listing is already closed", errorCode: "listing_already_closed" } };
    case "price_changed":
      return PRICE_CHANGED(result.auto_accept_price);
    case "below_asking": // #2176 ejer 10/11: Y >= X; "not_above_asking" er den gamle SQL-status før migrationen
    case "not_above_asking":
      return { status: 400, body: { error: "The auto-accept price must be at least the asking price", errorCode: "auto_accept_below_asking", errorParams: { askingPrice: Number(result.asking_price) } } };
    case "price_too_high":
      return { status: 400, body: { error: "Invalid auto-accept price", errorCode: "auto_accept_invalid_price" } };
    case "rider_not_with_seller":
    case "rider_is_academy":
      return RIDER_UNAVAILABLE;
    default:
      throw new Error(`set_listing_auto_accept_price: unexpected status ${result?.status}`);
  }
}

async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

/**
 * Oversaetter auto_accept_release_rider's status til samme svar som
 * frigivelsesruten giver i dag. atRiskRiders er den liste, ruten selv har hentet
 * (samme som blev sendt til RPC'en), saa fejlens navne og tal passer sammen.
 */
export function mapReleaseUnderTeamLockResult(result, atRiskRiders = []) {
  switch (result?.status) {
    case "released":
      return { data: [{ id: result.rider_id }], ...(result.payment_handled === true ? { paymentHandled: true } : {}) };
    case "cannot_afford_release":
      return { error: { status: 400, body: { errorCode: "cannot_afford_release", errorParams: { fee: result.fee, balance: result.balance } } } };
    case "insufficient_available_balance":
      return { error: { status: 400, body: { errorCode: "insufficient_available_balance", errorParams: { fee: result.fee, available: result.available, locked: result.locked } } } };
    case "rider_state_changed":
      return { error: { status: 409, body: { error: "This rider is no longer on your team", errorCode: "rider_state_changed" } } };
    case "rider_on_auction":
      return {
        error: {
          status: 409,
          body: {
            error: "This rider is currently on auction and can't be released. Wait for the auction to end first",
            errorCode: "rider_on_auction_release",
          },
        },
      };
    case "squad_floor":
      return {
        error: {
          status: 409,
          body: {
            error: `You can't drop below ${result.min_riders} riders once contract expiry and retirement risk at the next season change are counted`,
            errorCode: "cannot_release_squad_risk",
            errorParams: buildAtRiskErrorParams({ minRiders: result.min_riders }, atRiskRiders),
          },
        },
      };
    default:
      throw new Error(`auto_accept_release_rider: unexpected status ${result?.status}`);
  }
}

/**
 * Frigivelse af en rytter under samme holdlaas som start_auto_accept_auction
 * (Codex P2 paa #7878): gulv-tjek og ejerskabsskift i een transaktion, saa en
 * samtidig auto-accept-start og en frigivelse ikke begge kan passere gulvet.
 *
 * Slukket kontakt: null efter kun at have laest kontakten; kalderen bruger sin
 * egen opdatering uaendret. Taendt: { data: [{ id }] } (frigivet) eller
 * { error: { status, body } }.
 */
export async function releaseRiderUnderTeamLock(supabase, { riderId, teamId, atRiskRiders = [], marketBeta = false, fee = 0, feePayload = null, academy = false }) {
  if (marketBeta) {
    try {
      const result = await rpc(supabase, "auto_accept_release_paid_2176", {
        p_rider_id: riderId, p_team_id: teamId, p_min_riders: MIN_RIDERS_FOR_RACE,
        p_at_risk_rider_ids: atRiskRiders.map(rider => rider.id), p_academy: academy, p_fee: fee, p_finance_payload: feePayload,
      });
      if (result?.status !== "legacy") return mapReleaseUnderTeamLockResult(result, atRiskRiders);
    } catch (error) {
      const issue = readMarketSpendIssue2176(error);
      if (issue) return { error: { status: 400, body: { errorCode: issue.error, errorParams: { fee, ...issue } } } };
      throw error;
    }
  }
  if (academy) return null; // Its existing on/off path has no senior roster floor.
  if (!(await isAutoAcceptEnabled(supabase))) return null;
  const result = await rpc(supabase, "auto_accept_release_rider", {
    p_rider_id: riderId,
    p_team_id: teamId,
    p_min_riders: MIN_RIDERS_FOR_RACE,
    p_at_risk_rider_ids: (atRiskRiders || []).map((r) => r.id),
  });
  return mapReleaseUnderTeamLockResult(result, atRiskRiders);
}

// Claim ownership/parking under the same team locks as an auto-accept start.
// With the money gate on, ownership and payment share one transaction (A7).
export async function claimTransferUnderTeamLock(supabase, {
  riderId, sellerTeamId, buyerTeamId, deferRegistration, now, acquirePatch,
  activeSeasonNumber, maxRiders, price, dealId, buyerPayload, sellerPayload, riderRestore, marketBeta = false,
}) {
  if (!marketBeta && !(await isAutoAcceptEnabled(supabase))) return null;
  const atRisk = await fetchAtRiskRiders(supabase, sellerTeamId, activeSeasonNumber, { excludeRiderIds: [riderId] });
  const result = await rpc(supabase, "auto_accept_claim_transfer_paid", {
    p_rider_id: riderId, p_seller_team_id: sellerTeamId, p_buyer_team_id: buyerTeamId,
    p_defer_registration: deferRegistration, p_now: now.toISOString(),
    p_acquire_patch: acquirePatch, p_min_seller_riders: MIN_RIDERS_FOR_RACE,
    p_seller_at_risk_rider_ids: atRisk.map(rider => rider.id), p_max_riders: maxRiders, p_price: price,
    p_deal_id: dealId, p_buyer_payload: buyerPayload, p_seller_payload: sellerPayload,
    p_rider_restore: riderRestore,
  });
  switch (result?.status) {
    case "claimed": return { data: { id: result.rider_id }, paymentHandled: result.payment_handled === true };
    case "seller_squad_floor": return { issue: { code: "seller_squad_risk_too_small", minRiders: result.min_riders } };
    case "squad_full": return { issue: { code: "buyer_squad_full", maxRiders: result.max_riders } };
    case "buyer_insufficient_balance": return { issue: { code: "buyer_insufficient_balance" } }; // #6181: pengetjek under holdlåsen
    case "offer_at_auto_accept_price": return { boundary: { status: 409, body: { errorCode: "offer_at_auto_accept_price", errorParams: { autoAcceptPrice: Number(result.auto_accept_price), listingId: result.listing_id } } } };
    case "rider_state_changed":
    case "rider_on_auction": return { data: null };
    default: throw new Error(`auto_accept_claim_transfer: unexpected status ${result?.status}`);
  }
}

// Begge ben af et bytte under samme holdlaase og auktionstjek som transfer og
// frigivelse. Betalingen foelger bagefter i det eksisterende flow.
// Slukket kontakt: null efter kun at have laest kontakten.
export async function claimSwapUnderTeamLock(supabase, {
  offeredRiderId, requestedRiderId, proposingTeamId, receivingTeamId,
  deferRegistration, now, offeredPatch, requestedPatch, marketBeta = false, dealId = null, cash = 0,
  payment = /** @type {import('./marketBeta2176.ts').MarketSwapPayment2176 | null} */ (null),
}) {
  if (marketBeta) {
    try {
      const result = await rpc(supabase, "auto_accept_claim_swap_paid", {
        p_offered_rider_id: offeredRiderId, p_requested_rider_id: requestedRiderId,
        p_proposing_team_id: proposingTeamId, p_receiving_team_id: receivingTeamId,
        p_defer_registration: deferRegistration, p_now: now, p_offered_patch: offeredPatch, p_requested_patch: requestedPatch,
        p_deal_id: dealId, p_cash: cash, p_payment: payment,
      });
      if (result?.status === "claimed") return { data: { id: result.offered_rider_id }, paymentHandled: result.payment_handled === true };
      if (["rider_state_changed", "rider_on_auction"].includes(result?.status)) return { data: null };
      if (result?.status === "payer_insufficient_balance") return { issue: { code: result.payer_team_id === proposingTeamId ? "proposing_insufficient_balance" : "receiving_insufficient_balance" } };
      if (result?.status === "swap_squad_full") return { issue: { code: "buyer_squad_full", teamId: result.team_id, maxRiders: result.max_riders } };
      if (result?.status !== "legacy") throw new Error(`auto_accept_claim_swap_paid: unexpected status ${result?.status}`);
    } catch (error) {
      if (readMarketSpendIssue2176(error)) return { issue: { code: cash > 0 ? "proposing_insufficient_balance" : "receiving_insufficient_balance" } };
      throw error;
    }
  }
  if (!(await isAutoAcceptEnabled(supabase))) return null;
  const result = await rpc(supabase, "auto_accept_claim_swap", {
    p_offered_rider_id: offeredRiderId, p_requested_rider_id: requestedRiderId,
    p_proposing_team_id: proposingTeamId, p_receiving_team_id: receivingTeamId,
    p_defer_registration: deferRegistration, p_now: now,
    p_offered_patch: offeredPatch, p_requested_patch: requestedPatch,
  });
  switch (result?.status) {
    case "claimed": return { data: { id: result.offered_rider_id } };
    case "rider_state_changed":
    case "rider_on_auction": return { data: null };
    default: throw new Error(`auto_accept_claim_swap: unexpected status ${result?.status}`);
  }
}

/**
 * PATCH /transfers/:id: en CHECK-fejl kan have flere aarsager. Paa en aeldre
 * listing er det typisk identitetsvagten (rytteren har forladt saelger), ikke
 * auto-prisen, saa svaret skal naevne den faktiske aarsag. null = ikke en af de
 * kendte aarsager, og ruten svarer som ved enhver anden fejl.
 */
export function getListingPriceUpdateErrorResponse(error) {
  if (error?.code !== "23514") return null;
  const message = String(error.message || "");
  if (message.includes("transfer_listings_auto_accept_price_check")) {
    return { status: 400, body: { error: "The asking price can't be above the auto-accept price", errorCode: "asking_price_above_auto_accept" } };
  }
  if (message.includes("listing_owner_mismatch")) {
    return { status: 409, body: { error: "This rider is no longer on your team", errorCode: "rider_state_changed" } };
  }
  return null;
}

// null eller et positivt heltal; undefined (feltet mangler) er en fejl, saa
// klienten altid skal sende den pris, den saa.
function parseOptionalPrice(value) {
  if (value === null) return { ok: true, value: null };
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return isWholePrice(n) ? { ok: true, value: n } : { ok: false };
}

const DISABLED = { error: "Not found", errorCode: "auto_accept_disabled" };
const INVALID_PRICE = { error: "Invalid auto-accept price", errorCode: "auto_accept_invalid_price" };

/**
 * PUT /api/transfers/:id/auto-accept-price
 * body: { auto_accept_price: number|null, expected_auto_accept_price: number|null }
 */
export function makeSetAutoAcceptPriceHandler({ supabase }) {
  return async (req, res) => {
    if (!(await isAutoAcceptEnabled(supabase, { teamId: req.team?.id, userId: req.user?.id }))) return res.status(404).json(DISABLED);
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const price = parseOptionalPrice(req.body?.auto_accept_price);
    const expected = parseOptionalPrice(req.body?.expected_auto_accept_price);
    if (!price.ok || !expected.ok) return res.status(400).json(INVALID_PRICE);
    const result = await rpc(supabase, "set_listing_auto_accept_price", {
      p_listing_id: req.params.id,
      p_seller_team_id: req.team.id,
      p_price: price.value,
      p_expected_price: expected.value,
      p_actor_user_id: req.user?.id ?? null,
    });
    const mapped = mapSetAutoAcceptPriceResult(result);
    return res.status(mapped.status).json(mapped.body);
  };
}

/**
 * POST /api/transfers/:id/auto-accept
 * body: { expected_rider_id: string, expected_price: number, duration_minutes: number,
 *         expected_end_at: string (ISO; sluttiden dialogen viste) }
 *
 * deps fra api.js: getAuctionConfig, getActiveSeasonNumber, logActivity. De
 * resterende (opslag i andre moduler) kan erstattes i tests.
 */
export function makeStartAutoAcceptHandler({
  supabase, getAuctionConfig, getActiveSeasonNumber, logActivity, now = () => new Date(),
  marketState = getTeamMarketState, atRiskRiders = fetchAtRiskRiders,
  signingAllowed = assertSigningAllowed, seasonBoundary = fetchSeasonTransitionBoundary,
  priceBandConfig = readTransferPriceBandConfig, buildPriceBandErrorBody,
  announce = announceAutoAcceptAuction, notifyBuilt = null, watchlistDm = notifyWatchlistRiderAuction,
  recordIdentity = recordIdentityEvent,
}) {
  return async (req, res) => {
    if (!(await isAutoAcceptEnabled(supabase, { teamId: req.team?.id, userId: req.user?.id }))) return res.status(404).json(DISABLED);
    // Uden pengelaasen tager almindelige bud ikke holdlaasen, og et samtidigt bud
    // kan bruge de samme penge eller den samme plads som starten. Kontakterne
    // skal derfor ikke kunne staa forkert i forhold til hinanden.
    if (!(await isMarketTransportEnabled2176(supabase))) return res.status(404).json(DISABLED);
    if (!req.team) return res.status(400).json({ error: "No team found" });

    const durationIssue = getAutoAcceptDurationIssue(req.body?.duration_minutes);
    if (durationIssue) {
      return res.status(400).json({
        error: `Choose between ${durationIssue.minMinutes} minutes and ${durationIssue.maxMinutes / 60} hours of active time`,
        errorCode: "auto_accept_invalid_duration",
        errorParams: { minMinutes: durationIssue.minMinutes, maxHours: durationIssue.maxMinutes / 60 },
      });
    }
    const minutes = Number(req.body.duration_minutes);
    const expected = parseOptionalPrice(req.body?.expected_price);
    if (!expected.ok || expected.value === null) return res.status(400).json(INVALID_PRICE);
    const bid = req.body?.bid_amount === undefined ? expected : parseOptionalPrice(req.body.bid_amount);
    if (!bid.ok || bid.value === null || bid.value < expected.value) return res.status(400).json(INVALID_PRICE);

    // schema-columns-ok: auto_accept_price is added by database/2026-11-07-2176-m2-auto-accept.sql; this read is behind the enabled gate after apply.
    const { data: listing, error: listingError } = await supabase
      .from("transfer_listings")
      .select("id, rider_id, seller_team_id, status, auto_accept_price")
      .eq("id", req.params.id)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: "Listing not found", errorCode: "listing_not_found" });
    if (!(await isAutoAcceptPairEnabled2176(supabase, { sellerTeamId: listing.seller_team_id, buyerTeamId: req.team.id }))) return res.status(404).json(DISABLED);
    if (listing.seller_team_id === req.team.id) {
      return res.status(400).json({ error: "You can't bid on your own listing", errorCode: "cannot_bid_own_listing" });
    }
    const expectedRiderId = req.body?.expected_rider_id;
    if (typeof expectedRiderId !== "string" || !expectedRiderId.trim()) {
      return res.status(400).json(RIDER_UNAVAILABLE.body);
    }
    if (expectedRiderId !== listing.rider_id) return res.status(409).json(RIDER_UNAVAILABLE.body);
    if (Number(listing.auto_accept_price) !== expected.value) {
      const changed = PRICE_CHANGED(listing.auto_accept_price);
      return res.status(changed.status).json(changed.body);
    }
    const { data: rider, error: riderError } = await supabase.from("riders")
      .select("id, team_id, market_value, base_value, prize_earnings_bonus")
      .eq("id", listing.rider_id).maybeSingle();
    if (riderError) throw riderError;
    if (!rider || rider.team_id !== listing.seller_team_id) return res.status(409).json(RIDER_UNAVAILABLE.body);
    const band = await priceBandConfig(supabase);
    const bandIssue = getPriceBandViolation({ price: bid.value,
      marketValue: Math.max(calculateRiderMarketValue(rider), 1), ...band });
    if (bandIssue) return res.status(400).json(buildPriceBandErrorBody(bandIssue,
      { codePrefix: "auction_start", label: "auction starting price" }));

    // Samme loftsregel som board-konsekvenserne paa alle andre koeb.
    const signingBlock = await signingAllowed({
      supabase, buyerTeamId: req.team.id, riderId: listing.rider_id, purchasePrice: bid.value,
    });
    if (signingBlock) {
      return res.status(403).json({ error: signingBlock.reason, code: signingBlock.code, layer: signingBlock.layer });
    }

    const startedAt = now();
    const [cfg, boundary, buyerState, seasonNumber] = await Promise.all([
      getAuctionConfig(),
      seasonBoundary(supabase),
      marketState(supabase, req.team.id),
      getActiveSeasonNumber(),
    ]);
    const calculatedEnd = autoAcceptAuctionEnd(startedAt, cfg, minutes);
    if (!autoAcceptEndMatches(req.body?.expected_end_at, calculatedEnd)) {
      const changed = END_CHANGED(calculatedEnd, startedAt);
      return res.status(changed.status).json(changed.body);
    }
    const boundaryIssue = getAuctionSeasonBoundaryIssue(calculatedEnd, boundary);
    if (boundaryIssue) {
      const boundaryText = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Copenhagen", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(boundaryIssue.boundary)).replace(",", "");
      return res.status(400).json({
        error: `Auctions can't end after the season change (${boundaryText})`,
        errorCode: "auction_end_crosses_season_transition",
        errorParams: { boundaryAt: boundaryText },
      });
    }
    const atRisk = await atRiskRiders(supabase, listing.seller_team_id, seasonNumber, {
      excludeRiderIds: [listing.rider_id],
    });

    const result = await rpc(supabase, "start_auto_accept_auction_bid", {
      p_listing_id: listing.id,
      p_buyer_team_id: req.team.id,
      p_expected_rider_id: expectedRiderId,
      p_expected_seller_team_id: listing.seller_team_id,
      p_expected_rider_value: { market_value: rider.market_value ?? null,
        base_value: rider.base_value ?? null, prize_earnings_bonus: rider.prize_earnings_bonus ?? null },
      p_expected_price: expected.value,
      p_bid_amount: bid.value,
      p_duration_minutes: minutes,
      p_calculated_end: calculatedEnd.toISOString(),
      p_max_riders: buyerState.squad_limits.max,
      p_min_seller_riders: MIN_RIDERS_FOR_RACE,
      p_seller_at_risk_rider_ids: atRisk.map((r) => r.id),
      p_now: startedAt.toISOString(),
    });
    const mapped = mapStartAutoAcceptResult(result);
    if (result.status === "started") {
      // Startbuddet er et bud med vaerdi: samme haendelsestype som POST /auctions/:id/bid,
      // saa fair play-laeserne faar det med. Fail-open og uden await (#3132).
      recordIdentity(supabase, {
        userId: req.user?.id,
        teamId: req.team.id,
        eventType: "auction_bid",
        entityId: result.auction_id,
        req,
        metadata: { origin: "auto_accept", listing_id: listing.id, rider_id: result.rider_id,
          seller_team_id: result.seller_team_id, price: Number(result.price), duration_minutes: minutes },
      });
      await announce({ supabase, logActivity, result, calculatedEnd, notifyBuilt, watchlistDm, actorUserId: req.user?.id ?? null });
    }
    return res.status(mapped.status).json(mapped.body);
  };
}

/**
 * Foelgere af rytteren faar samme besked og Discord-DM som ved POST /auctions.
 * Den der starter auktionen faar ingen. Kaster ved en laesefejl; kalderen
 * sender det til Sentry, saa auktionen aldrig afhaenger af beskederne.
 */
export async function notifyAutoAcceptWatchers({ supabase, notifyBuilt, watchlistDm, result, riderName, calculatedEnd, actorUserId }) {
  // pagination-safe: een rytters foelgere, hoejst een raekke pr. manager.
  const { data: watchers, error } = await supabase
    .from("rider_watchlist").select("user_id").eq("rider_id", result.rider_id);
  if (error) throw error;
  const report = (step) => (err) => captureException(err, { tags: { route: "POST /transfers/:id/auto-accept", step } });
  await Promise.all((watchers || []).filter((w) => w.user_id !== actorUserId).map((w) => Promise.all([
    notifyBuilt(w.user_id, buildWatchlistAuctionNotification({
      riderName, startPrice: Number(result.price), riderId: result.rider_id,
    }), result.auction_id).catch(report("watchlist-notify")),
    watchlistDm({ userId: w.user_id, riderName, endsAt: calculatedEnd.toISOString() }).catch(report("watchlist-dm")),
  ])));
}

// Best-effort, som ved POST /auctions: auktionen er startet, uanset om
// meddelelserne lykkes.
async function announceAutoAcceptAuction({ supabase, logActivity, result, calculatedEnd, notifyBuilt, watchlistDm, actorUserId }) {
  try {
    const [{ data: rider }, { data: seller }] = await Promise.all([
      supabase.from("riders").select("id, firstname, lastname, market_value").eq("id", result.rider_id).maybeSingle(),
      supabase.from("teams").select("id, name").eq("id", result.seller_team_id).maybeSingle(),
    ]);
    const riderName = rider ? `${rider.firstname} ${rider.lastname}` : null;
    await logActivity("auction_started", {
      team_id: result.seller_team_id,
      team_name: seller?.name ?? null,
      rider_id: result.rider_id,
      rider_name: riderName,
      amount: Number(result.price),
      meta: { origin: "auto_accept", auction_id: result.auction_id },
    });
    notifyNewAuction({
      riderName,
      riderValue: rider?.market_value,
      sellerName: seller?.name,
      startPrice: Number(result.price),
      endsAt: calculatedEnd.toISOString(),
    }).catch((err) => {
      captureException(err, { tags: { route: "POST /transfers/:id/auto-accept", step: "notify" } });
    });
    notifyAutoAcceptWatchers({ supabase, notifyBuilt, watchlistDm, result, riderName, calculatedEnd, actorUserId }).catch((err) => {
      captureException(err, { tags: { route: "POST /transfers/:id/auto-accept", step: "watchlist" } });
    });
  } catch (err) {
    captureException(err, { tags: { route: "POST /transfers/:id/auto-accept", step: "announce" } });
  }
}

/**
 * Registrerer de to ruter. Kaldes een gang fra api.js (minimal kobling).
 * deps: { supabase, requireAuth, marketWriteLimiter, assertMarketOpen,
 *         assertTeamNotTransferFrozen, getAuctionConfig, getActiveSeasonNumber, logActivity, notifyBuilt }
 */
export function registerAutoAcceptRoutes(router, deps) {
  const { supabase, requireAuth, marketWriteLimiter, assertMarketOpen, assertTeamNotTransferFrozen } = deps;
  router.get("/market/auto-accept-config", autoAcceptRouteGate(supabase), requireAuth, async (req, res) => {
    if (!(await isAutoAcceptEnabled(supabase, { teamId: req.team?.id, userId: req.user?.id }))) return res.status(404).json(DISABLED);
    if (!(await isMarketTransportEnabled2176(supabase))) return res.status(404).json(DISABLED);
    const { data, error } = await supabase.from("auction_timing_config")
      .select("weekday_open_hour,weekday_close_hour,weekend_open_hour,weekend_close_hour").eq("id", 1).single();
    if (error) throw error;
    if (!data) return res.status(503).json({ errorCode: "auto_accept_rider_unavailable" });
    res.set("Cache-Control", "no-store");
    return res.json(data);
  });
  const start = makeStartAutoAcceptHandler(deps);
  const setPrice = makeSetAutoAcceptPriceHandler(deps);
  router.post("/transfers/:id/auto-accept", autoAcceptRouteGate(supabase), requireAuth, marketWriteLimiter, async (req, res) => {
    if (!(await assertMarketOpen(req, res, "auction"))) return;
    if (!assertTeamNotTransferFrozen(req, res)) return;
    return start(req, res);
  });
  router.put("/transfers/:id/auto-accept-price", autoAcceptRouteGate(supabase), requireAuth, marketWriteLimiter, async (req, res) => {
    if (!(await assertMarketOpen(req, res, "market"))) return;
    return setPrice(req, res);
  });
}

/**
 * Slukket kontakt: ruten springes helt over (next("route")), saa svaret er det
 * samme som foer ruten fandtes, ogsaa uden login og under markedspause.
 */
export function autoAcceptRouteGate(supabase) {
  return async (req, res, next) => {
    const value = await readMarketFlag2176(supabase, AUTO_ACCEPT_FLAG_KEY);
    // Resolve a beta actor after requireAuth; never trust client-side claims.
    if (value === "beta" || evaluateFlagStage(value)) return next();
    return next("route");
  };
}
