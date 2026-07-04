import { computeWorstCaseCommitment } from "./auctionRules.js";
import {
  closeTransferListingsForRiders,
  expectMaybeSingle,
  expectMutation,
  expectSingle,
  getActiveAuctionRiderIds,
  getIncomingSquadViolation,
  getOutgoingSquadViolation,
  getTeamMarketState,
} from "./marketUtils.js";
import { shouldDeferTeamChange } from "./stageRaceTransferDefer.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { contractOnAcquirePatch } from "./contractSeed.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { buildContractExpiringNotification } from "./notificationService.js";
import {
  buildSwapCancelledStaleNotification,
  buildSwapCompletedNotification,
  buildTransferOnAuctionCancelledNotification,
  buildTransferStaleCancelledNotification,
  buildTransferCompletedNotification,
} from "./transferNotifications.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

// #44: hent worst-case commitment fra teamets aktive auktioner. Bruges af
// transfer/swap-execution så et accepteret transfer ikke kan pushe køber i
// underbalance ift. allerede placerede bud.
async function fetchTeamAuctionCommitment(supabase, teamId) {
  if (!teamId) return 0;
  const [leadingRes, proxiesRes] = await Promise.all([
    supabase
      .from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", teamId),
    supabase
      .from("auction_proxy_bids")
      .select("auction_id, max_amount, auction:auction_id(status)")
      .eq("team_id", teamId),
  ]);

  const leadingAuctions = leadingRes.data || [];
  const allMyProxies = (proxiesRes.data || [])
    .filter((row) => ["active", "extended"].includes(row.auction?.status))
    .map((row) => ({ auction_id: row.auction_id, max_amount: row.max_amount }));
  return computeWorstCaseCommitment({ leadingAuctions, allMyProxies });
}

const NOOP = async () => {};
const ACTIVE_MARKET_STATUSES = ["pending", "countered", "awaiting_confirmation"];

// 07d Fase B / #240: Slå aktiv sæson op så transfer/swap-callsites kan stamp'e
// season_id eksplicit. DB-trigger fill_finance_tx_season() er en safety-net,
// men callsites skal være selv-dokumenterende.
async function fetchActiveSeasonId(supabase) {
  const { data } = await supabase
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// #1309 kontrakt-on-acquire: aktiv sæson-number til contract_end_season-beregning.
// Default 1 hvis ingen aktiv sæson er registreret (edge-case).
async function fetchActiveSeasonNumber(supabase) {
  const { data } = await supabase
    .from("seasons")
    .select("number")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.number ?? 1;
}

function success(payload) {
  return { ok: true, ...payload };
}

function failure(status, error, code, extra = {}) {
  return { ok: false, status, error, code, ...extra };
}

function getTransferPrice(offer) {
  return offer.counter_amount || offer.offer_amount;
}

function getSwapCash(swap) {
  return swap.counter_cash ?? swap.cash_adjustment;
}

// #44: buyerCommitment / proposingCommitment / receivingCommitment ekskluderer
// auktions-låste midler fra balance-checks. Default 0 = bagudkompat for ældre
// callere/tests der ikke skal håndhæve auction-låsning.
// #267: buyerSoftCapBuffer = ekstra ryttere over division-cap der tillades MIDT
// i et åbent transfervindue. Kalderen sætter typisk
// TRANSFER_WINDOW_SOFT_CAP_BUFFER (2) når endpoint har gated på open-vindue;
// 0 = hard-cap (closed-window-stil).
export function getTransferExecutionIssue({
  rider,
  sellerState,
  buyerState,
  price,
  buyerCommitment = 0,
  buyerSoftCapBuffer = 0,
}) {
  if (!rider || rider.team_id !== sellerState.id) {
    return { code: "seller_no_longer_owns_rider" };
  }

  const sellerViolation = getOutgoingSquadViolation(sellerState);
  if (sellerViolation) {
    return { code: "seller_squad_too_small", ...sellerViolation };
  }

  const buyerViolation = getIncomingSquadViolation(buyerState, {
    softCapBuffer: buyerSoftCapBuffer,
  });
  if (buyerViolation) {
    return { code: "buyer_squad_full", ...buyerViolation };
  }

  const buyerAvailable = Math.max(0, (buyerState.balance || 0) - (Number(buyerCommitment) || 0));
  if (buyerAvailable < price) {
    return { code: "buyer_insufficient_balance" };
  }

  return null;
}

export function getSwapExecutionIssue({
  swap,
  offered,
  requested,
  proposingState,
  receivingState,
  cash,
  proposingCommitment = 0,
  receivingCommitment = 0,
}) {
  if (!offered || offered.team_id !== swap.proposing_team_id) {
    return { code: "offered_rider_moved" };
  }

  if (!requested || requested.team_id !== swap.receiving_team_id) {
    return { code: "requested_rider_moved" };
  }

  const proposingAvailable = Math.max(0, (proposingState.balance || 0) - (Number(proposingCommitment) || 0));
  const receivingAvailable = Math.max(0, (receivingState.balance || 0) - (Number(receivingCommitment) || 0));

  if (cash > 0 && proposingAvailable < cash) {
    return { code: "proposing_insufficient_balance" };
  }

  if (cash < 0 && receivingAvailable < Math.abs(cash)) {
    return { code: "receiving_insufficient_balance" };
  }

  return null;
}

export function getTransferCancelIssue(offer) {
  if (offer?.status === "window_pending" || (offer?.buyer_confirmed && offer?.seller_confirmed)) {
    return { code: "deal_already_accepted" };
  }

  return null;
}

export function getSwapCancelIssue(swap) {
  if (swap?.status === "window_pending" || (swap?.proposing_confirmed && swap?.receiving_confirmed)) {
    return { code: "deal_already_accepted" };
  }

  return null;
}

// #156: en aktiv lejeaftale er en bindende kontrakt — manager kan ikke annullere
// ensidigt. Pending må stadig trækkes tilbage (lender har ikke accepteret endnu).
export function getLoanCancelIssue(loan) {
  if (loan?.status === "active") {
    return { code: "loan_already_active" };
  }

  return null;
}

// #270: ejeren må fjerne sin egen listing i både "open" og "negotiating" status.
// Aktive offers påvirkes ikke — køber kan stadig trække tilbage / sælger afvise via
// offers-flowet. not_found returneres bevidst (i stedet for at differentiere
// "ikke ejer") så routen ikke afslører om id'et eksisterer for ikke-ejere.
export function getListingCancelIssue(listing, { teamId } = {}) {
  if (!listing) return { code: "not_found" };
  if (listing.seller_team_id !== teamId) return { code: "not_owner" };
  if (listing.status !== "open" && listing.status !== "negotiating") {
    return { code: "already_closed" };
  }
  return null;
}

// #1185: inline pris-redigering på egen listing (PATCH /api/transfers/:id).
// Genbruger ejerskabs-/status-reglerne fra getListingCancelIssue (ejer + åben/
// negotiating) og validerer den nye pris: positivt heltal, matcher INTEGER
// NOT NULL-kolonnen og min=1-semantikken i salgs-formularen på Min trup.
export function getListingPriceUpdateIssue(listing, { teamId, askingPrice } = {}) {
  const cancelIssue = getListingCancelIssue(listing, { teamId });
  if (cancelIssue) return cancelIssue;
  if (!Number.isInteger(askingPrice) || askingPrice <= 0) {
    return { code: "invalid_price" };
  }
  return null;
}

async function withdrawTransferOffer(supabase, offerId) {
  await expectMutation(
    supabase.from("transfer_offers").update({ status: "withdrawn" }).eq("id", offerId)
  );
}

async function withdrawSwapOffer(supabase, swapId) {
  await expectMutation(
    supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swapId)
  );
}

// #776/#822: closeTransferListingsForRiders bor nu i marketUtils.js (delt med
// auctionFinalization + squadEnforcement).

async function withdrawTransferOffersForRiders(supabase, riderIds, excludeOfferId = null) {
  let query = supabase
    .from("transfer_offers")
    .update({ status: "withdrawn" })
    .in("rider_id", riderIds)
    .in("status", ACTIVE_MARKET_STATUSES);

  if (excludeOfferId) {
    query = query.neq("id", excludeOfferId);
  }

  await expectMutation(query);
}

async function withdrawSwapOffersForRiders(supabase, riderIds, excludeSwapId = null) {
  const riderList = riderIds.join(",");
  let query = supabase
    .from("swap_offers")
    .update({ status: "withdrawn" })
    .in("status", ACTIVE_MARKET_STATUSES)
    .or(
      `offered_rider_id.in.(${riderList}),requested_rider_id.in.(${riderList})`
    );

  if (excludeSwapId) {
    query = query.neq("id", excludeSwapId);
  }

  await expectMutation(query);
}

// #2174 · describeTransferIssue/describeSwapIssue emitter nu EN-first `error` +
// notification-i18n-koder (notif.transfer.issue.*) så både API-svaret (#678
// errorCode-kontrakt) og indbakke-notifikationen følger brugerens sprog.
function describeTransferIssue(issue, { rider, buyerState, sellerState }) {
  const riderName = `${rider.firstname} ${rider.lastname}`;
  const cancelTitle = { notificationTitle: "Transfer cancelled", notificationTitleCode: "notif.transfer.issue.title" };

  if (issue.code === "seller_no_longer_owns_rider") {
    return {
      error: "The seller no longer owns the rider — the deal was cancelled",
      ...cancelTitle,
      notificationMessage: `${riderName} could not be completed because the rider is no longer on the seller's team.`,
      notificationMessageCode: "notif.transfer.issue.sellerNoLongerOwns",
      notificationParams: { riderName },
    };
  }

  if (issue.code === "seller_squad_too_small") {
    return {
      error: `The seller can't drop below ${issue.minRiders} riders in Division ${sellerState.division} — the deal was cancelled`,
      errorParams: { minRiders: issue.minRiders, division: sellerState.division },
      ...cancelTitle,
      notificationMessage: `${riderName} could not be sold because the seller would otherwise drop below ${issue.minRiders} riders in Division ${sellerState.division}.`,
      notificationMessageCode: "notif.transfer.issue.sellerSquadTooSmall",
      notificationParams: { riderName, minRiders: issue.minRiders, division: sellerState.division },
    };
  }

  if (issue.code === "buyer_squad_full") {
    return {
      error: `The buyer's team can hold at most ${issue.maxRiders} riders in Division ${buyerState.division} — the deal was cancelled`,
      errorParams: { maxRiders: issue.maxRiders, division: buyerState.division },
      ...cancelTitle,
      notificationMessage: `${riderName} could not be transferred because the buyer's team is already full.`,
      notificationMessageCode: "notif.transfer.issue.buyerSquadFull",
      notificationParams: { riderName },
    };
  }

  return {
    error: "The buyer can no longer afford it — the deal was cancelled",
    ...cancelTitle,
    notificationMessage: `The deal on ${riderName} could not be completed because the buyer lacks funds.`,
    notificationMessageCode: "notif.transfer.issue.buyerCannotAfford",
    notificationParams: { riderName },
  };
}

function describeSwapIssue(issue, { offered, requested }) {
  const offeredName = `${offered.firstname} ${offered.lastname}`;
  const requestedName = `${requested.firstname} ${requested.lastname}`;
  const cancelTitle = { notificationTitle: "Swap cancelled", notificationTitleCode: "notif.transfer.issue.swapTitle" };

  if (issue.code === "offered_rider_moved") {
    return {
      error: "Your offered rider is no longer on your team — the swap was cancelled",
      ...cancelTitle,
      notificationMessage: `${offeredName} is no longer available for the swap.`,
      notificationMessageCode: "notif.transfer.issue.offeredMoved",
      notificationParams: { offeredName },
    };
  }

  if (issue.code === "requested_rider_moved") {
    return {
      error: "The requested rider no longer belongs to the counterparty — the swap was cancelled",
      ...cancelTitle,
      notificationMessage: `${requestedName} is no longer available for the swap.`,
      notificationMessageCode: "notif.transfer.issue.requestedMoved",
      notificationParams: { requestedName },
    };
  }

  if (issue.code === "proposing_insufficient_balance") {
    return {
      error: "The proposing team can no longer afford it — the swap was cancelled",
      ...cancelTitle,
      notificationMessage: `The swap ${offeredName} ↔ ${requestedName} could not be completed because the proposing team lacks funds.`,
      notificationMessageCode: "notif.transfer.issue.proposingCannotAfford",
      notificationParams: { offeredName, requestedName },
    };
  }

  return {
    error: "The receiving team can no longer afford it — the swap was cancelled",
    ...cancelTitle,
    notificationMessage: `The swap ${offeredName} ↔ ${requestedName} could not be completed because the receiving team lacks funds.`,
    notificationMessageCode: "notif.transfer.issue.receivingCannotAfford",
    notificationParams: { offeredName, requestedName },
  };
}

// #2174 · Byg notify-metadata fra en describe*-issue-payload.
function issueNotificationMetadata(message, riderId = null) {
  const meta = {
    titleCode: message.notificationTitleCode,
    titleParams: {},
    messageCode: message.notificationMessageCode,
    messageParams: message.notificationParams || {},
  };
  return riderId != null ? { riderId, ...meta } : meta;
}

// Private: pay for + register/park a fully-agreed transfer offer.
//
// #19: "betal nu, registrér ved åbning". Pengene flyttes ved bekræftelse i begge
// modes. `deferRegistration=true` (vinduet lukket) parkerer rytteren på
// pending_team_id i stedet for at flytte team_id; den generiske pending-flush
// (api.js POST /admin/transfer-window/open) sætter team_id når vinduet åbner, og
// flushWindowPendingOffers finaliserer kun selve offer-recorden (ingen
// pengebevægelse — så ingen dobbeltbetaling). `deferRegistration=false` (vinduet
// åbent) flytter team_id med det samme som hidtil.
async function executeTransferOffer(supabase, offer, { logActivity = NOOP, notifyTeamOwner = NOOP, notifyDiscordHistory = NOOP, auditCtx = null, deferRegistration = false }) {
  const price = getTransferPrice(offer);
  // #1309: salary/base_value/prize_earnings_bonus med så contract-on-acquire kan
  // afgøre create-if-missing vs. inherit-if-present.
  const rider = await expectSingle(
    supabase
      .from("riders")
      // #1836: contract_end_season med så køb-trigger kan afgøre om kontrakten
      // udløber i indeværende sæson.
      .select("id, firstname, lastname, team_id, salary, base_value, prize_earnings_bonus, contract_end_season")
      .eq("id", offer.rider_id)
  );
  const [buyerState, sellerState, buyerCommitment] = await Promise.all([
    getTeamMarketState(supabase, offer.buyer_team_id),
    getTeamMarketState(supabase, offer.seller_team_id),
    fetchTeamAuctionCommitment(supabase, offer.buyer_team_id),
  ]);

  // #1748 (a) TOCTOU-guard: hvis rytteren er kommet på en aktiv auktion EFTER
  // tilbuddet blev oprettet (oprettelses-gaten i api.js fanger det ikke), må
  // handlen ikke gennemføres — ellers kan rytteren både vindes på auktionen OG
  // overdrages via transfer. Annullér tilbuddet med en klar besked (samme mønster
  // som seller_no_longer_owns_rider). Auktionen er den vindende kanal.
  const onAuction = await getActiveAuctionRiderIds(supabase, [rider.id]);
  if (onAuction.length > 0) {
    await withdrawTransferOffer(supabase, offer.id);
    const onAuctionPayload = buildTransferOnAuctionCancelledNotification({
      riderName: `${rider.firstname} ${rider.lastname}`, riderId: rider.id,
    });
    await notifyTeamOwner(offer.buyer_team_id, onAuctionPayload.type, onAuctionPayload.title, onAuctionPayload.message, offer.id, onAuctionPayload.metadata);
    await notifyTeamOwner(offer.seller_team_id, onAuctionPayload.type, onAuctionPayload.title, onAuctionPayload.message, offer.id, onAuctionPayload.metadata);
    return failure(409, "This rider is on an active auction — the transfer was cancelled. Bid on the auction instead.", "rider_on_auction_transfer");
  }

  // #16 altid-åben handel: intet transfervindue → ingen vindue-grace → hard cap (buffer 0)
  // ved selve handlen, samme paritet som auktions-finalization.
  const issue = getTransferExecutionIssue({
    rider,
    sellerState,
    buyerState,
    price,
    buyerCommitment,
    buyerSoftCapBuffer: 0,
  });

  if (issue) {
    const message = describeTransferIssue(issue, { rider, buyerState, sellerState });
    await withdrawTransferOffer(supabase, offer.id);
    const issueMeta = issueNotificationMetadata(message, rider.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, offer.id, issueMeta);
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, offer.id, issueMeta);
    return failure(400, message.error, issue.code, message.errorParams ? { errorParams: message.errorParams } : {});
  }

  // #1309 kontrakt-on-acquire: køber erhverver rytteren → opret standard-kontrakt
  // hvis kontraktløs (salary == null); ellers arves den uændret. Skrives både ved
  // parkering (lukket vindue) og direkte registrering (åbent vindue), fordi den
  // generiske pending-flush ved vindue-åbning kun flytter team_id.
  const activeSeasonNumber = await fetchActiveSeasonNumber(supabase);
  const transferContractPatch = contractOnAcquirePatch(rider, activeSeasonNumber);

  // #19: parkér = sæt pending_team_id (kræver at rytteren ikke allerede er
  // reserveret til en anden handel); registrér = flyt team_id direkte.
  const movedRider = deferRegistration
    ? await expectMaybeSingle(
        supabase
          .from("riders")
          .update({ pending_team_id: offer.buyer_team_id, ...transferContractPatch })
          .eq("id", rider.id)
          .eq("team_id", offer.seller_team_id)
          .is("pending_team_id", null)
          .select("id")
      )
    : await expectMaybeSingle(
        supabase
          .from("riders")
          .update({
            team_id: offer.buyer_team_id,
            pending_team_id: null,
            acquired_at: new Date().toISOString(),
            ...transferContractPatch,
          })
          .eq("id", rider.id)
          .eq("team_id", offer.seller_team_id)
          .select("id")
      );

  if (!movedRider) {
    await withdrawTransferOffer(supabase, offer.id);
    const stalePayload = buildTransferStaleCancelledNotification({
      riderName: `${rider.firstname} ${rider.lastname}`, riderId: rider.id,
    });
    await notifyTeamOwner(offer.buyer_team_id, stalePayload.type, stalePayload.title, stalePayload.message, offer.id, stalePayload.metadata);
    await notifyTeamOwner(offer.seller_team_id, stalePayload.type, stalePayload.title, stalePayload.message, offer.id, stalePayload.metadata);
    return failure(409, "The rider changed status during confirmation — the deal was cancelled", "stale_rider_state");
  }

  // #1906 defense-in-depth: når rytteren reelt skifter hold (team_id flyttet ved
  // direkte registrering), ryd hans fremtidige ghost-race_entries med det samme.
  // I deferRegistration-stien flyttes kun pending_team_id (team_id bliver hos
  // sælger), så ingen ghost dannes endnu — derfor kun her.
  if (!deferRegistration) {
    await clearFutureRaceEntriesSafe({ supabase, riderId: rider.id, label: "transfer" });
  }

  // Slice 07c: balance + finance_transactions atomic via RPC.
  // 07d Fase B / #240: actor flyder gennem auditCtx (api fra confirmTransferOffer,
  // cron fra flushWindowPendingOffers). season_id sættes eksplicit fra activeSeason.
  // #19: idempotency_key + allowDuplicate så betalingen aldrig bogføres to gange,
  // uanset hvor mange gange recorden behandles.
  const actorType = auditCtx?.actorType || FINANCE_ACTOR_TYPE.CRON;
  const actorId = auditCtx?.actorId || null;
  const transferSeasonId = await fetchActiveSeasonId(supabase);
  await incrementBalanceWithAudit(supabase, {
    teamId: offer.buyer_team_id,
    delta: -price,
    payload: {
      type: "transfer_out",
      amount: -price,
      description: `Købt ${rider.firstname} ${rider.lastname} via transfer`,
      metadata: {
        code: "tx.transferBuy",
        params: { riderName: `${rider.firstname} ${rider.lastname}` },
      },
      season_id: transferSeasonId,
      actor_type: actorType,
      actor_id: actorId,
      source_path: "transferExecution.executeTransferOffer.buyer",
      reason_code: FINANCE_REASON.TRANSFER_PURCHASE,
      related_entity_type: FINANCE_RELATED_ENTITY.TRANSFER,
      related_entity_id: offer.id,
      idempotency_key: `transfer_buyer:${offer.id}`,
    },
  }, { allowDuplicate: true });
  await incrementBalanceWithAudit(supabase, {
    teamId: offer.seller_team_id,
    delta: price,
    payload: {
      type: "transfer_in",
      amount: price,
      description: `Solgt ${rider.firstname} ${rider.lastname} via transfer`,
      metadata: {
        code: "tx.transferSell",
        params: { riderName: `${rider.firstname} ${rider.lastname}` },
      },
      season_id: transferSeasonId,
      actor_type: actorType,
      actor_id: actorId,
      source_path: "transferExecution.executeTransferOffer.seller",
      reason_code: FINANCE_REASON.TRANSFER_SALE,
      related_entity_type: FINANCE_RELATED_ENTITY.TRANSFER,
      related_entity_id: offer.id,
      idempotency_key: `transfer_seller:${offer.id}`,
    },
  }, { allowDuplicate: true });

  await closeTransferListingsForRiders(supabase, [rider.id], "sold");
  await withdrawTransferOffersForRiders(supabase, [rider.id], offer.id);
  await withdrawSwapOffersForRiders(supabase, [rider.id]);

  // #1995 Model B: handlen er fuldført (accepted) uanset defer — kun den fysiske
  // rytter-flytning er evt. parkeret på pending_team_id og flushes ved race-slut.
  await expectMutation(
    supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", offer.id)
  );

  await logActivity("transfer_accepted", {
    team_id: offer.seller_team_id,
    team_name: sellerState.name,
    rider_id: rider.id,
    rider_name: `${rider.firstname} ${rider.lastname}`,
    amount: price,
  });

  const completedPayload = buildTransferCompletedNotification({
    riderName: `${rider.firstname} ${rider.lastname}`, price, deferred: deferRegistration, riderId: rider.id,
  });
  await notifyTeamOwner(offer.buyer_team_id, completedPayload.type, completedPayload.title, completedPayload.message, offer.id, completedPayload.metadata);
  await notifyTeamOwner(offer.seller_team_id, completedPayload.type, completedPayload.title, completedPayload.message, offer.id, completedPayload.metadata);

  // #1836 · køb-trigger: hvis den købte rytters kontrakt udløber i NUVÆRENDE
  // sæson, advar køberen med det samme. contract_end_season kan netop være sat
  // af transferContractPatch (kontraktløs free agent → standard-kontrakt), så vi
  // læser den effektive værdi.
  const buyerContractEndSeason =
    transferContractPatch.contract_end_season ?? rider.contract_end_season;
  if (buyerContractEndSeason === activeSeasonNumber) {
    const expiring = buildContractExpiringNotification({
      riderName: `${rider.firstname} ${rider.lastname}`,
      riderId: rider.id,
      seasonNumber: activeSeasonNumber,
    });
    // #1872: ikke-fatal — et notifikations-throw må aldrig rulle en committet
    // transfer-execution tilbage. Samme klasse-fejl som auktion-finalize (#1872);
    // sluges + logges. Se .claude/learnings/2026-06-25-contract-expiring-*.
    try {
      await notifyTeamOwner(
        offer.buyer_team_id,
        expiring.type,
        expiring.title,
        expiring.message,
        expiring.relatedId,
        expiring.metadata
      );
    } catch (notifyErr) {
      console.error(
        `  ⚠️  Kontraktudløb-notifikation fejlede for transfer ${offer.id} (ikke-fatal):`,
        notifyErr.message
      );
    }
  }

  await notifyDiscordHistory({
    riderName: `${rider.firstname} ${rider.lastname}`,
    sellerName: sellerState.name,
    buyerName: buyerState.name,
    price,
  });

  return success({ action: deferRegistration ? "deferred_stage_race" : "accepted", price });
}

// Private: pay for + register/park a fully-agreed swap offer.
//
// #19: samme "betal nu, registrér ved åbning"-model som executeTransferOffer.
// `deferRegistration=true` (vinduet lukket) parkerer begge ryttere på
// pending_team_id; den generiske pending-flush registrerer dem ved vindue-åbning.
async function executeSwapOffer(supabase, swap, { notifyTeamOwner = NOOP, notifyDiscordHistory = NOOP, auditCtx = null, deferRegistration = false }) {
  const cash = getSwapCash(swap);
  // #1309: salary/base_value/prize_earnings_bonus med så contract-on-acquire kan
  // afgøre create-if-missing vs. inherit-if-present for BEGGE ryttere.
  const [offered, requested] = await Promise.all([
    expectSingle(
      supabase.from("riders").select("id, firstname, lastname, team_id, salary, base_value, prize_earnings_bonus").eq("id", swap.offered_rider_id)
    ),
    expectSingle(
      supabase.from("riders").select("id, firstname, lastname, team_id, salary, base_value, prize_earnings_bonus").eq("id", swap.requested_rider_id)
    ),
  ]);
  const [proposingState, receivingState, proposingCommitment, receivingCommitment] = await Promise.all([
    getTeamMarketState(supabase, swap.proposing_team_id),
    getTeamMarketState(supabase, swap.receiving_team_id),
    fetchTeamAuctionCommitment(supabase, swap.proposing_team_id),
    fetchTeamAuctionCommitment(supabase, swap.receiving_team_id),
  ]);

  const issue = getSwapExecutionIssue({
    swap,
    offered,
    requested,
    proposingState,
    receivingState,
    cash,
    proposingCommitment,
    receivingCommitment,
  });

  if (issue) {
    const message = describeSwapIssue(issue, { offered, requested });
    await withdrawSwapOffer(supabase, swap.id);
    const swapIssueMeta = issueNotificationMetadata(message);
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, swap.id, swapIssueMeta);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, swap.id, swapIssueMeta);
    return failure(400, message.error, issue.code);
  }

  const swapTimestamp = new Date().toISOString();
  // #1309 kontrakt-on-acquire: hver rytter erhverves af modparten → opret
  // standard-kontrakt hvis kontraktløs; ellers arves den uændret. Ejede swap-
  // ryttere har normalt allerede en kontrakt (→ {}), men patchen er korrekt og
  // sikker for et evt. kontraktløst tilfælde. Skrives både ved parkering og
  // direkte registrering (pending-flush flytter kun team_id).
  const swapSeasonNumber = await fetchActiveSeasonNumber(supabase);
  const offeredContractPatch = contractOnAcquirePatch(offered, swapSeasonNumber);
  const requestedContractPatch = contractOnAcquirePatch(requested, swapSeasonNumber);

  // #19: parkér = sæt pending_team_id på begge ryttere (kræver at ingen af dem
  // allerede er reserveret til en anden handel); registrér = flyt team_id direkte.
  const movedOffered = deferRegistration
    ? await expectMaybeSingle(
        supabase
          .from("riders")
          .update({ pending_team_id: swap.receiving_team_id, ...offeredContractPatch })
          .eq("id", offered.id)
          .eq("team_id", swap.proposing_team_id)
          .is("pending_team_id", null)
          .select("id")
      )
    : await expectMaybeSingle(
        supabase
          .from("riders")
          .update({ team_id: swap.receiving_team_id, pending_team_id: null, acquired_at: swapTimestamp, ...offeredContractPatch })
          .eq("id", offered.id)
          .eq("team_id", swap.proposing_team_id)
          .select("id")
      );

  if (!movedOffered) {
    await withdrawSwapOffer(supabase, swap.id);
    const offeredStalePayload = buildSwapCancelledStaleNotification({ riderName: `${offered.firstname} ${offered.lastname}` });
    await notifyTeamOwner(swap.proposing_team_id, offeredStalePayload.type, offeredStalePayload.title, offeredStalePayload.message, swap.id, offeredStalePayload.metadata);
    await notifyTeamOwner(swap.receiving_team_id, offeredStalePayload.type, offeredStalePayload.title, offeredStalePayload.message, swap.id, offeredStalePayload.metadata);
    return failure(409, "The offered rider changed status during confirmation — the swap was cancelled", "stale_offered_rider_state");
  }

  const movedRequested = deferRegistration
    ? await expectMaybeSingle(
        supabase
          .from("riders")
          .update({ pending_team_id: swap.proposing_team_id, ...requestedContractPatch })
          .eq("id", requested.id)
          .eq("team_id", swap.receiving_team_id)
          .is("pending_team_id", null)
          .select("id")
      )
    : await expectMaybeSingle(
        supabase
          .from("riders")
          .update({ team_id: swap.proposing_team_id, pending_team_id: null, acquired_at: swapTimestamp, ...requestedContractPatch })
          .eq("id", requested.id)
          .eq("team_id", swap.receiving_team_id)
          .select("id")
      );

  if (!movedRequested) {
    // Rul den første ben tilbage så vi ikke efterlader en halv byttehandel.
    if (deferRegistration) {
      await expectMutation(
        supabase.from("riders").update({ pending_team_id: null }).eq("id", offered.id)
      );
    } else {
      await expectMutation(
        supabase.from("riders").update({ team_id: swap.proposing_team_id, acquired_at: swapTimestamp }).eq("id", offered.id)
      );
    }
    await withdrawSwapOffer(supabase, swap.id);
    const requestedStalePayload = buildSwapCancelledStaleNotification({ riderName: `${requested.firstname} ${requested.lastname}` });
    await notifyTeamOwner(swap.proposing_team_id, requestedStalePayload.type, requestedStalePayload.title, requestedStalePayload.message, swap.id, requestedStalePayload.metadata);
    await notifyTeamOwner(swap.receiving_team_id, requestedStalePayload.type, requestedStalePayload.title, requestedStalePayload.message, swap.id, requestedStalePayload.metadata);
    return failure(409, "The requested rider changed status during confirmation — the swap was cancelled", "stale_requested_rider_state");
  }

  // #1906 defense-in-depth: begge byttede ryttere skifter hold ved direkte
  // registrering (team_id flyttet) → ryd hver deres fremtidige ghost-race_entries.
  // I deferRegistration-stien flyttes kun pending_team_id, så ingen ghost dannes endnu.
  if (!deferRegistration) {
    await clearFutureRaceEntriesSafe({ supabase, riderId: offered.id, label: "swap" });
    await clearFutureRaceEntriesSafe({ supabase, riderId: requested.id, label: "swap" });
  }

  if (cash !== 0) {
    // Slice 07c: balance + finance_transactions atomic via RPC.
    // 07d Fase B / #240: actor via auditCtx (api/cron afhængigt af caller),
    // season_id eksplicit fra activeSeason.
    const swapDescription = `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`;
    const swapMetadata = {
      code: "tx.swapCash",
      params: {
        offeredName: `${offered.firstname} ${offered.lastname}`,
        requestedName: `${requested.firstname} ${requested.lastname}`,
      },
    };
    const payerId = cash > 0 ? swap.proposing_team_id : swap.receiving_team_id;
    const receiverId = cash > 0 ? swap.receiving_team_id : swap.proposing_team_id;
    const absCash = Math.abs(cash);
    const swapActorType = auditCtx?.actorType || FINANCE_ACTOR_TYPE.CRON;
    const swapActorId = auditCtx?.actorId || null;
    const swapSeasonId = await fetchActiveSeasonId(supabase);

    await incrementBalanceWithAudit(supabase, {
      teamId: payerId,
      delta: -absCash,
      payload: {
        type: "transfer_out",
        amount: -absCash,
        description: swapDescription,
        metadata: swapMetadata,
        season_id: swapSeasonId,
        actor_type: swapActorType,
        actor_id: swapActorId,
        source_path: "transferExecution.executeSwapOffer.payer",
        reason_code: FINANCE_REASON.SWAP_CASH_DELTA,
        related_entity_type: FINANCE_RELATED_ENTITY.SWAP,
        related_entity_id: swap.id,
        idempotency_key: `swap_payer:${swap.id}`,
      },
    }, { allowDuplicate: true });
    await incrementBalanceWithAudit(supabase, {
      teamId: receiverId,
      delta: absCash,
      payload: {
        type: "transfer_in",
        amount: absCash,
        description: swapDescription,
        metadata: swapMetadata,
        season_id: swapSeasonId,
        actor_type: swapActorType,
        actor_id: swapActorId,
        source_path: "transferExecution.executeSwapOffer.receiver",
        reason_code: FINANCE_REASON.SWAP_CASH_DELTA,
        related_entity_type: FINANCE_RELATED_ENTITY.SWAP,
        related_entity_id: swap.id,
        idempotency_key: `swap_receiver:${swap.id}`,
      },
    }, { allowDuplicate: true });
  }

  await closeTransferListingsForRiders(
    supabase,
    [swap.offered_rider_id, swap.requested_rider_id],
    "withdrawn"
  );
  await withdrawTransferOffersForRiders(supabase, [swap.offered_rider_id, swap.requested_rider_id]);
  await withdrawSwapOffersForRiders(supabase, [swap.offered_rider_id, swap.requested_rider_id], swap.id);

  // #1995 Model B: byttehandlen er fuldført (accepted) uanset defer — kun de
  // fysiske rytter-flytninger er evt. parkeret på pending_team_id (race-flush).
  await expectMutation(
    supabase.from("swap_offers").update({ status: "accepted" }).eq("id", swap.id)
  );

  const swapCompletedPayload = buildSwapCompletedNotification({
    offeredName: `${offered.firstname} ${offered.lastname}`,
    requestedName: `${requested.firstname} ${requested.lastname}`,
    deferred: deferRegistration,
  });
  await notifyTeamOwner(swap.proposing_team_id, swapCompletedPayload.type, swapCompletedPayload.title, swapCompletedPayload.message, swap.id, swapCompletedPayload.metadata);
  await notifyTeamOwner(swap.receiving_team_id, swapCompletedPayload.type, swapCompletedPayload.title, swapCompletedPayload.message, swap.id, swapCompletedPayload.metadata);

  await notifyDiscordHistory({
    offeredName: `${offered.firstname} ${offered.lastname}`,
    requestedName: `${requested.firstname} ${requested.lastname}`,
    proposingName: proposingState.name,
    receivingName: receivingState.name,
    cash: cash !== 0 ? cash : null,
  });

  return success({ action: deferRegistration ? "deferred_stage_race" : "accepted" });
}

export async function confirmTransferOffer({
  supabase,
  offerId,
  confirmingTeamId,
  notifyTeamOwner,
  logActivity = NOOP,
  notifyDiscordHistory = NOOP,
  auditCtx = null,
}) {
  const offer = await expectMaybeSingle(
    supabase
      .from("transfer_offers")
      .select(
        "id, rider_id, seller_team_id, buyer_team_id, offer_amount, counter_amount, status, buyer_confirmed, seller_confirmed, rider:rider_id(id, firstname, lastname, team_id)"
      )
      .eq("id", offerId)
  );

  if (!offer) {
    return failure(404, "Tilbud ikke fundet", "offer_missing");
  }

  const isSeller = offer.seller_team_id === confirmingTeamId;
  const isBuyer = offer.buyer_team_id === confirmingTeamId;

  if (!isSeller && !isBuyer) {
    return failure(403, "Ikke involveret i dette tilbud", "not_involved");
  }

  if (offer.status !== "awaiting_confirmation") {
    return failure(400, "Ugyldig handling", "not_awaiting_confirmation");
  }

  if ((isSeller && offer.seller_confirmed) || (isBuyer && offer.buyer_confirmed)) {
    return failure(400, "Du har allerede bekræftet", "already_confirmed");
  }

  const updatedFields = isSeller
    ? { seller_confirmed: true }
    : { buyer_confirmed: true };

  await expectMutation(
    supabase.from("transfer_offers").update(updatedFields).eq("id", offer.id)
  );

  const confirmedOffer = { ...offer, ...updatedFields };
  const nowSellerConfirmed = Boolean(confirmedOffer.seller_confirmed);
  const nowBuyerConfirmed = Boolean(confirmedOffer.buyer_confirmed);
  const otherTeamId = isSeller ? offer.buyer_team_id : offer.seller_team_id;

  if (!nowSellerConfirmed || !nowBuyerConfirmed) {
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_accepted",
      "Handlen afventer din bekræftelse",
      `${isSeller ? "Sælger" : "Køber"} har bekræftet handlen på ${offer.rider.firstname} ${offer.rider.lastname}. Bekræft for at gennemføre.`,
      offer.id,
      { riderId: offer.rider.id }
    );

    return success({ action: "confirmed_partial" });
  }

  // #1995: betal + registrér straks — medmindre rytteren er i et AKTIVT
  // fleretape-løb; så parkeres selve holdskiftet på pending_team_id og flushes
  // når løbet finaliseres (attribution: hele det aktive løb tilhører sælgeren).
  const deferRegistration = await shouldDeferTeamChange(supabase, [offer.rider_id]);
  return executeTransferOffer(supabase, confirmedOffer, {
    logActivity,
    notifyTeamOwner,
    notifyDiscordHistory,
    auditCtx,
    deferRegistration,
  });
}

export async function confirmSwapOffer({
  supabase,
  swapId,
  confirmingTeamId,
  notifyTeamOwner,
  notifyDiscordHistory = NOOP,
  auditCtx = null,
}) {
  const swap = await expectMaybeSingle(
    supabase
      .from("swap_offers")
      .select(
        "id, offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, cash_adjustment, counter_cash, status, proposing_confirmed, receiving_confirmed, offered:offered_rider_id(id, firstname, lastname, team_id), requested:requested_rider_id(id, firstname, lastname, team_id)"
      )
      .eq("id", swapId)
  );

  if (!swap) {
    return failure(404, "Byttehandel ikke fundet", "swap_missing");
  }

  const isProposing = swap.proposing_team_id === confirmingTeamId;
  const isReceiving = swap.receiving_team_id === confirmingTeamId;

  if (!isProposing && !isReceiving) {
    return failure(403, "Ikke involveret i denne byttehandel", "not_involved");
  }

  if (swap.status !== "awaiting_confirmation") {
    return failure(400, "Ugyldig handling", "not_awaiting_confirmation");
  }

  if ((isProposing && swap.proposing_confirmed) || (isReceiving && swap.receiving_confirmed)) {
    return failure(400, "Du har allerede bekræftet", "already_confirmed");
  }

  const updatedFields = isProposing
    ? { proposing_confirmed: true }
    : { receiving_confirmed: true };

  await expectMutation(
    supabase.from("swap_offers").update(updatedFields).eq("id", swap.id)
  );

  const confirmedSwap = { ...swap, ...updatedFields };
  const nowProposing = Boolean(confirmedSwap.proposing_confirmed);
  const nowReceiving = Boolean(confirmedSwap.receiving_confirmed);
  const otherTeamId = isProposing ? swap.receiving_team_id : swap.proposing_team_id;

  if (!nowProposing || !nowReceiving) {
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_accepted",
      "Byttehandel afventer din bekræftelse",
      `${isProposing ? "Det foreslående hold" : "Det modtagende hold"} har bekræftet byttehandlen. Bekræft for at gennemføre.`,
      swap.id
    );

    return success({ action: "confirmed_partial" });
  }

  // #1995: parkér HELE byttehandlen hvis bare én af rytterne er i et aktivt
  // fleretape-løb (en swap er atomisk).
  const deferRegistration = await shouldDeferTeamChange(supabase, [
    swap.offered_rider_id,
    swap.requested_rider_id,
  ]);
  return executeSwapOffer(supabase, confirmedSwap, {
    notifyTeamOwner,
    notifyDiscordHistory,
    auditCtx,
    deferRegistration,
  });
}

// Finaliserer alle window_pending offers/swaps — kaldes når transfervinduet åbner.
//
// #19: REN ikke-finansiel record-finalisering. Pengene blev allerede flyttet ved
// bekræftelsen (executeTransfer/SwapOffer med deferRegistration), og selve
// rytter-registreringen (pending_team_id → team_id) håndteres af den generiske
// pending-rytter-flush i POST /admin/transfer-window/open FØR denne funktion kaldes.
// Her sætter vi kun offer-recorden til "accepted" og sender den offentlige
// "gennemført"-besked + Discord-historik. INGEN balance-bevægelse → ingen
// dobbeltbetaling, uanset hvor mange gange flushen kører.
export async function flushWindowPendingOffers(supabase, {
  logActivity = NOOP,
  notifyTeamOwner = NOOP,
  notifyTransferCompleted = NOOP,
  notifySwapCompleted = NOOP,
}) {
  const [pendingTransfers, pendingSwaps] = await Promise.all([
    supabase
      .from("transfer_offers")
      .select(
        "id, rider_id, seller_team_id, buyer_team_id, offer_amount, counter_amount, rider:rider_id(firstname, lastname), seller:seller_team_id(name), buyer:buyer_team_id(name)"
      )
      .eq("status", "window_pending"),
    supabase
      .from("swap_offers")
      .select(
        "id, offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, cash_adjustment, counter_cash, offered:offered_rider_id(firstname, lastname), requested:requested_rider_id(firstname, lastname), proposing:proposing_team_id(name), receiving:receiving_team_id(name)"
      )
      .eq("status", "window_pending"),
  ]);

  let transfersProcessed = 0;
  for (const offer of (pendingTransfers.data || [])) {
    const price = getTransferPrice(offer);
    const riderName = `${offer.rider?.firstname ?? ""} ${offer.rider?.lastname ?? ""}`.trim();
    await expectMutation(
      supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", offer.id)
    );
    await logActivity("transfer_accepted", {
      team_id: offer.seller_team_id,
      team_name: offer.seller?.name,
      rider_id: offer.rider_id,
      rider_name: riderName,
      amount: price,
    });
    const flushTransferPayload = buildTransferCompletedNotification({ riderName, price, deferred: false, riderId: offer.rider_id });
    await notifyTeamOwner(offer.buyer_team_id, flushTransferPayload.type, flushTransferPayload.title, flushTransferPayload.message, offer.id, flushTransferPayload.metadata);
    await notifyTeamOwner(offer.seller_team_id, flushTransferPayload.type, flushTransferPayload.title, flushTransferPayload.message, offer.id, flushTransferPayload.metadata);
    await notifyTransferCompleted({
      riderName,
      sellerName: offer.seller?.name,
      buyerName: offer.buyer?.name,
      price,
    });
    transfersProcessed++;
  }

  let swapsProcessed = 0;
  for (const swap of (pendingSwaps.data || [])) {
    const cash = getSwapCash(swap);
    const offeredName = `${swap.offered?.firstname ?? ""} ${swap.offered?.lastname ?? ""}`.trim();
    const requestedName = `${swap.requested?.firstname ?? ""} ${swap.requested?.lastname ?? ""}`.trim();
    await expectMutation(
      supabase.from("swap_offers").update({ status: "accepted" }).eq("id", swap.id)
    );
    const flushSwapPayload = buildSwapCompletedNotification({ offeredName, requestedName, deferred: false });
    await notifyTeamOwner(swap.proposing_team_id, flushSwapPayload.type, flushSwapPayload.title, flushSwapPayload.message, swap.id, flushSwapPayload.metadata);
    await notifyTeamOwner(swap.receiving_team_id, flushSwapPayload.type, flushSwapPayload.title, flushSwapPayload.message, swap.id, flushSwapPayload.metadata);
    await notifySwapCompleted({
      offeredName,
      requestedName,
      proposingName: swap.proposing?.name,
      receivingName: swap.receiving?.name,
      cash: cash !== 0 ? cash : null,
    });
    swapsProcessed++;
  }

  return { transfersProcessed, swapsProcessed };
}
